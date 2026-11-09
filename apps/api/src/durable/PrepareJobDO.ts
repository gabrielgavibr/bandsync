import { DurableObject } from "cloudflare:workers";
import {
  isRunningJob,
  JOB_COST_BUDGET,
  type JobStepRecord,
  nextStep,
  retryDelayMs,
  statusForStep,
} from "@bandsync/shared";
import { musicBrainz } from "../autoarrange/clients";
import { PermanentStepError, STEP_RUNNERS } from "../autoarrange/pipeline";
import { getJobRow, updateJob } from "../db/autoarrange";
import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import { log } from "../lib/logger";
import { nowIso } from "../lib/time";

/**
 * Runs one preparation job, one step per alarm.
 *
 * Why a Durable Object: requests return immediately, steps survive restarts, a failed step is
 * retried with back-off up to the job's attempt limit, and every step updates the job row so the
 * UI can show progress. D1 holds the job (source of truth for listing and review); this object
 * only remembers which job it drives. Heavy audio work must not run here: a future engine step
 * will hand the file to an external worker and wait for its result the same way.
 */
export class PrepareJobDO extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/start") {
      const { jobId } = (await request.json()) as { jobId: string };
      await this.ctx.storage.put("jobId", jobId);
      await this.ctx.storage.setAlarm(Date.now());
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/stop") {
      await this.ctx.storage.deleteAlarm();
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }

  override async alarm(): Promise<void> {
    const jobId = await this.ctx.storage.get<string>("jobId");
    if (!jobId) return;
    const db = this.env.DB;
    const job = await getJobRow(db, jobId);
    // Cancelled, finished or already waiting for a person: nothing to run.
    if (!job || !isRunningJob(job.status)) return;

    let steps: JobStepRecord[] = [];
    try {
      steps = JSON.parse(job.steps) as JobStepRecord[];
    } catch {
      steps = [];
    }
    const step = nextStep(steps);
    if (!step) {
      await updateJob(db, job.id, { status: "awaiting_review", finishedAt: nowIso() });
      return;
    }

    const startedAt = nowIso();
    await updateJob(db, job.id, {
      status: statusForStep(step),
      startedAt: job.started_at ?? startedAt,
    });
    let cost = job.cost_units;
    const spend = () => {
      if (cost >= JOB_COST_BUDGET) throw new PermanentStepError("budget_exceeded");
      cost += 1;
    };

    try {
      const result = await STEP_RUNNERS[step]({
        env: this.env,
        db,
        job,
        mb: musicBrainz(this.env),
        spend,
      });
      // A cancellation may have arrived while the step ran; do not overwrite it.
      const current = await getJobRow(db, job.id);
      if (!current || !isRunningJob(current.status)) return;
      const done = [
        ...steps.filter((s) => !(s.step === step && s.outcome === "failed")),
        {
          step,
          outcome: result.outcome,
          reason: result.reason,
          detail: result.detail,
          startedAt,
          finishedAt: nowIso(),
        },
      ];
      const upcoming = nextStep(done);
      await updateJob(db, job.id, {
        steps: done,
        costUnits: cost,
        attempts: 0,
        errorCode: null,
        errorMessage: null,
        status: statusForStep(upcoming),
        ...(upcoming ? {} : { finishedAt: nowIso() }),
      });
      if (upcoming) await this.ctx.storage.setAlarm(Date.now());
    } catch (err) {
      const attempts = job.attempts + 1;
      const permanent = err instanceof PermanentStepError;
      const code = permanent ? err.code : err instanceof ApiError ? err.code : "step_failed";
      const message = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
      log("warn", "autoarrange.step_failed", { jobId: job.id, step, attempts, code, permanent });
      const failed: JobStepRecord[] = [
        ...steps.filter((s) => !(s.step === step && s.outcome === "failed")),
        { step, outcome: "failed", reason: code, detail: {}, startedAt, finishedAt: nowIso() },
      ];
      if (permanent || attempts >= job.max_attempts) {
        await updateJob(db, job.id, {
          status: "failed",
          steps: failed,
          attempts,
          costUnits: cost,
          errorCode: code,
          errorMessage: message,
          finishedAt: nowIso(),
        });
        return;
      }
      await updateJob(db, job.id, {
        steps: failed,
        attempts,
        costUnits: cost,
        errorCode: code,
        errorMessage: message,
      });
      await this.ctx.storage.setAlarm(Date.now() + retryDelayMs(attempts));
    }
  }
}

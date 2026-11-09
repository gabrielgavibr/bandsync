import { JOB_STEPS, type JobStatus, type JobStep, type JobStepRecord } from "./types";

/** Statuses in which a job is still doing (or waiting for) work. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
  "pending",
  "searching_references",
  "analyzing_audio",
  "detecting_structure",
  "preparing_materials",
  "awaiting_review",
];

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["completed", "failed", "cancelled"];

export const isActiveJob = (s: JobStatus) => ACTIVE_JOB_STATUSES.includes(s);
/** Running means the pipeline itself still has steps to execute (review is a human step). */
export const isRunningJob = (s: JobStatus) => isActiveJob(s) && s !== "awaiting_review";

/** The step to execute next, given the steps already recorded; null when all are done. */
export function nextStep(done: JobStepRecord[]): JobStep | null {
  const finished = new Set(done.filter((d) => d.outcome !== "failed").map((d) => d.step));
  return JOB_STEPS.find((s) => !finished.has(s)) ?? null;
}

/** Status shown while a step runs, and after the last one. */
export function statusForStep(step: JobStep | null): JobStatus {
  return step ?? "awaiting_review";
}

export function jobProgress(status: JobStatus, done: JobStepRecord[]): number {
  if (status === "completed" || status === "awaiting_review") return 100;
  const finished = new Set(done.filter((d) => d.outcome !== "failed").map((d) => d.step)).size;
  return Math.round((finished / JOB_STEPS.length) * 100);
}

/**
 * Identifies "the same work": one song, one recording, one audio file, one pipeline version.
 * Only one active job may exist per key, so pressing "Prepare" twice does not run it twice.
 */
export function jobDedupeKey(input: {
  songId: string;
  recordingId: string | null;
  audioAssetId: string | null;
  pipelineVersion: string;
}): string {
  return [
    input.songId,
    input.recordingId ?? "-",
    input.audioAssetId ?? "-",
    input.pipelineVersion,
  ].join("|");
}

/** Delay before retry number `attempt` (1-based) of a failed step. */
export function retryDelayMs(attempt: number): number {
  return Math.min(60_000, 2_000 * 2 ** (attempt - 1));
}

export const PIPELINE_VERSION = "prepare-v1";
export const JOB_MAX_ATTEMPTS = 3;
/** External requests a single job may make (MusicBrainz, YouTube). A hard stop against runaway cost. */
export const JOB_COST_BUDGET = 12;
/** Jobs a band may start per day. */
export const BAND_DAILY_JOB_LIMIT = 40;

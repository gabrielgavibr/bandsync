import {
  type AnalysisJobDto,
  type AnalysisResultDto,
  COMMON_TIME_SIGNATURES,
  isRunningJob,
  JOB_STEPS,
  type JobStep,
  LIMITS,
  type ReviewStatus,
  type SongDto,
} from "@bandsync/shared";
import { Check, CircleDashed, ExternalLink, Loader2, MinusCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, useToast } from "../../components/ui";
import { cn } from "../../lib/cn";
import { errorText } from "../../lib/errors";
import { formatDateTime, formatDuration } from "../../lib/format";
import { type Confirmation, type SongAnalysisOverview, useJobAction, useReview } from "./queries";

/* ------------------------------------------------------------------ */

type StepView = "done" | "skipped" | "failed" | "running" | "waiting";

function stepView(job: AnalysisJobDto, step: JobStep): StepView {
  const record = [...job.steps].reverse().find((s) => s.step === step);
  if (record && record.outcome !== "failed") return record.outcome;
  if (job.status === step) return "running";
  if (record?.outcome === "failed") return "failed";
  return "waiting";
}

const STEP_ICON: Record<StepView, typeof Check> = {
  done: Check,
  skipped: MinusCircle,
  failed: XCircle,
  running: Loader2,
  waiting: CircleDashed,
};

/** The four steps of a preparation with what each one did, or why it did not run. */
export function JobProgress({ bandId, job }: { bandId: string; job: AnalysisJobDto }) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const action = useJobAction(bandId, job.songId);
  const { toast } = useToast();
  const run = (a: "cancel" | "retry") =>
    action.mutate(
      { jobId: job.id, action: a },
      { onError: (err) => toast(errorText(err), "error") },
    );
  const tone =
    job.status === "failed"
      ? "danger"
      : job.status === "awaiting_review"
        ? "warn"
        : job.status === "completed"
          ? "ok"
          : "accent";
  return (
    <div data-testid="job-progress" data-status={job.status}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={job.status === "cancelled" ? "neutral" : tone}>
          {t(`autoarrange:job.status.${job.status}`)}
        </Badge>
        <div
          className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-sunken"
          role="progressbar"
          aria-valuenow={job.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-accent-500 transition-[width]"
            style={{ width: `${job.progress}%` }}
          />
        </div>
        <span className="text-sm tabular-nums text-muted">{job.progress}%</span>
      </div>
      <ol className="flex flex-col gap-2">
        {JOB_STEPS.map((step) => {
          const view = stepView(job, step);
          const record = [...job.steps].reverse().find((s) => s.step === step);
          const Icon = STEP_ICON[view];
          const detail = record?.detail ?? {};
          const facts: string[] = [];
          if (typeof detail.fieldsFilled === "number" && detail.fieldsFilled > 0)
            facts.push(t("autoarrange:job.fieldsFilled", { count: detail.fieldsFilled }));
          if (typeof detail.slotsCreated === "number" && detail.slotsCreated > 0)
            facts.push(t("autoarrange:job.slotsCreated", { count: detail.slotsCreated }));
          return (
            <li
              key={step}
              className="flex items-start gap-3 rounded-xl bg-sunken px-3 py-2.5"
              data-step={step}
              data-outcome={view}
            >
              <Icon
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  view === "done" && "text-ok-500",
                  view === "failed" && "text-danger-500",
                  view === "running" && "animate-spin text-accent-500",
                  (view === "skipped" || view === "waiting") && "text-muted",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {t(`autoarrange:steps.${step}`)}
                  <span className="text-xs font-normal text-muted">
                    {t(`autoarrange:outcome.${view}`)}
                  </span>
                </p>
                {view === "skipped" && record?.reason ? (
                  <p className="text-sm text-muted">
                    {t(`autoarrange:skip.${record.reason}`, { defaultValue: record.reason })}
                  </p>
                ) : null}
                {view === "done" && record?.reason ? (
                  <p className="text-sm text-muted">
                    {t(`autoarrange:skip.${record.reason}`, { defaultValue: record.reason })}
                  </p>
                ) : null}
                {facts.length > 0 ? (
                  <p className="text-sm text-muted">{facts.join(" · ")}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {job.errorCode ? (
        <p
          className="mt-3 rounded-xl border border-danger-500/40 bg-danger-500/5 p-3 text-sm"
          role="alert"
        >
          {t(`autoarrange:job.error.${job.errorCode}`, {
            defaultValue: t("autoarrange:job.error.step_failed"),
          })}{" "}
          {job.status === "failed"
            ? t("autoarrange:job.failedBody")
            : t("autoarrange:job.attempt", { n: job.attempts, max: job.maxAttempts })}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {isRunningJob(job.status) ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => run("cancel")}
            loading={action.isPending}
          >
            {t("autoarrange:job.cancel")}
          </Button>
        ) : null}
        {job.status === "failed" || job.status === "cancelled" ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => run("retry")}
            loading={action.isPending}
          >
            {t("autoarrange:job.retry")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function reviewTone(s: ReviewStatus): "ok" | "warn" | "danger" | "neutral" {
  return s === "confirmed" || s === "edited"
    ? "ok"
    : s === "needs_review"
      ? "warn"
      : s === "rejected"
        ? "danger"
        : "neutral";
}

function formatValue(r: AnalysisResultDto): string {
  const v = r.value;
  switch (r.kind) {
    case "duration":
      return typeof v.seconds === "number" ? formatDuration(Math.round(v.seconds)) : "—";
    case "composer":
      return Array.isArray(v.names) ? (v.names as string[]).join(", ") : "—";
    case "bpm":
      return typeof v.bpm === "number" ? String(v.bpm) : "—";
    case "tempo_ambiguity":
      return Array.isArray(v.alternatives) ? (v.alternatives as number[]).join(" / ") : "—";
    case "tempo_stability":
      return typeof v.cv === "number" ? `±${Math.round(v.cv * 1000) / 10}%` : "—";
    case "beats":
      return typeof v.count === "number" ? String(v.count) : "—";
    case "key":
      return typeof v.key === "string" ? v.key : "—";
    case "time_signature":
      return `${v.beatsPerBar ?? "?"}/${v.beatUnit ?? "?"}`;
    default:
      return JSON.stringify(v).slice(0, 80);
  }
}

const ANALYSED_KINDS = ["bpm", "key", "time_signature", "chords", "sections"];

/** Every automatically obtained fact with its method, origin, confidence, review state and date. */
export function ResultsList({ results }: { results: AnalysisResultDto[] }) {
  const { t, i18n } = useTranslation("autoarrange");
  const analysed = results.some((r) => ANALYSED_KINDS.includes(r.kind));
  return (
    <div>
      {results.length === 0 ? <p className="text-sm text-muted">{t("results.none")}</p> : null}
      <ul className="flex flex-col gap-2">
        {results.map((r) => (
          <li key={r.id} className="rounded-xl bg-sunken px-3 py-2.5 text-sm" data-kind={r.kind}>
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-muted">
                {t(`results.kind.${r.kind}`, { defaultValue: r.kind })}
              </span>
              <span className="font-semibold">{formatValue(r)}</span>
              <Badge>{t(`results.origin.${r.origin}`, { defaultValue: r.origin })}</Badge>
              <Badge tone={reviewTone(r.reviewStatus)}>
                {t(`results.review.${r.reviewStatus}`)}
              </Badge>
            </p>
            <p className="mt-1 text-xs text-muted">
              {t("results.method", { method: r.method })} ·{" "}
              {r.confidence !== null && r.confidenceCalibrated
                ? t("results.confidence", { value: Math.round(r.confidence * 100) })
                : t("results.confidenceNone")}{" "}
              · {t("results.obtainedAt", { date: formatDateTime(r.createdAt, i18n.language) })}
              {r.sourceUrl ? (
                <>
                  {" · "}
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-accent-600 underline dark:text-accent-300"
                  >
                    {t("results.source")} <ExternalLink className="size-3" />
                  </a>
                </>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
      {!analysed ? (
        <p
          className="mt-3 rounded-xl border border-dashed border-warn-500/60 bg-warn-500/5 p-3 text-sm"
          role="note"
        >
          {t("results.notAnalysed")}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ConfirmationLine({ c }: { c: Confirmation | null }) {
  const { t, i18n } = useTranslation("autoarrange");
  return (
    <p
      className={cn(
        "text-xs",
        !c ? "text-muted" : c.beforeReferenceChange ? "text-warn-500" : "text-ok-500",
      )}
      data-stale={c?.beforeReferenceChange ? "true" : undefined}
    >
      {c
        ? t("review.confirmedBy", {
            name: c.userName ?? "—",
            date: formatDateTime(c.at, i18n.language),
          })
        : t("review.notConfirmed")}
      {/* Nothing was changed by the new reference; the band is only told to listen again. */}
      {c?.beforeReferenceChange ? ` · ${t("review.beforeReferenceChange")}` : ""}
    </p>
  );
}

/** Values the analysis estimated, offered to fill a field. Nothing is saved until "Confirm". */
function Suggestions({
  values,
  unit,
  onPick,
  testId,
}: {
  values: string[];
  unit?: string;
  onPick: (v: string) => void;
  testId: string;
}) {
  const { t } = useTranslation("autoarrange");
  if (values.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs" data-testid={testId}>
      <span className="text-muted">{t("review.estimate")}</span>
      {values.map((v, i) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          className="rounded-full border border-warn-500/50 bg-warn-500/10 px-2.5 py-1 font-medium hover:bg-warn-500/20"
        >
          {i > 0 ? `${t("review.or")} ` : ""}
          {v}
          {unit ? ` ${unit}` : ""}
        </button>
      ))}
      <span className="text-muted">· {t("results.review.needs_review")}</span>
    </div>
  );
}

/** The band confirms its own tempo, key and meter. These values feed the live rehearsal. */
export function ReviewForm({
  bandId,
  song,
  overview,
}: {
  bandId: string;
  song: SongDto;
  overview: SongAnalysisOverview;
}) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const review = useReview(bandId, song.id);
  const { toast } = useToast();
  const [bpm, setBpm] = useState(song.version.bpm ? String(song.version.bpm) : "");
  const [key, setKey] = useState(song.version.key ?? "");
  const [meter, setMeter] = useState(`${song.version.beatsPerBar}/${song.version.beatUnit}`);
  useEffect(() => {
    setBpm(song.version.bpm ? String(song.version.bpm) : "");
    setKey(song.version.key ?? "");
    setMeter(`${song.version.beatsPerBar}/${song.version.beatUnit}`);
  }, [song.version.bpm, song.version.key, song.version.beatsPerBar, song.version.beatUnit]);

  const send = (input: Parameters<typeof review.mutate>[0]) =>
    review.mutate(input, {
      onSuccess: () => toast(t("autoarrange:review.saved"), "success"),
      onError: (err) => toast(errorText(err), "error"),
    });
  // The latest estimate of each kind for the current reference recording, if any.
  const reference = overview.recordings.find((r) => r.isReference) ?? null;
  const estimate = (kind: string) =>
    overview.results.find(
      (r) =>
        r.kind === kind &&
        r.origin === "audio_analysis" &&
        (!reference || r.recordingId === reference.id),
    ) ?? null;
  const bpmEst = estimate("bpm");
  const keyEst = estimate("key");
  const meterEst = estimate("time_signature");
  const bpmChoices = bpmEst
    ? [
        Number(bpmEst.value.bpm),
        ...((bpmEst.value.candidates as { bpm: number; score: number }[] | undefined) ?? [])
          .filter((c) => c.score >= 0.7 && Math.abs(c.bpm - Number(bpmEst.value.bpm)) > 1)
          .map((c) => c.bpm),
      ].map((b) => Math.round(b))
    : [];
  const keyChoices = keyEst
    ? (
        (keyEst.value.candidates as { key: string }[] | undefined) ?? [
          { key: String(keyEst.value.key) },
        ]
      )
        .slice(0, 2)
        .map((c) => c.key)
    : [];
  const meterChoice = meterEst ? `${meterEst.value.beatsPerBar}/${meterEst.value.beatUnit}` : null;
  /** The estimate a confirmation refers to: confirmed as is, or corrected (the server tells). */
  const resultFor = (r: AnalysisResultDto | null) => (r ? r.id : null);
  const bpmNumber = Number(bpm);
  const bpmValid = bpm !== "" && bpmNumber >= LIMITS.bpmMin && bpmNumber <= LIMITS.bpmMax;
  const control =
    "h-11 w-full rounded-xl border border-line bg-elev px-3 text-fg focus:border-accent-500 focus:outline-none";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("autoarrange:review.hint")}</p>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("autoarrange:review.bpm")}
          <input
            type="number"
            inputMode="decimal"
            min={LIMITS.bpmMin}
            max={LIMITS.bpmMax}
            step="0.1"
            value={bpm}
            onChange={(e) => setBpm(e.target.value)}
            className={control}
          />
        </label>
        <Button
          onClick={() => send({ target: "band_bpm", bpm: bpmNumber, resultId: resultFor(bpmEst) })}
          disabled={!bpmValid}
          loading={review.isPending}
          aria-label={`${t("autoarrange:review.confirm")} ${t("autoarrange:review.bpm")}`}
        >
          {t("autoarrange:review.confirm")}
        </Button>
        <div className="col-span-2 -mt-1">
          <ConfirmationLine c={overview.confirmations.band_bpm} />
          <Suggestions
            testId="suggest-bpm"
            values={bpmChoices.map(String)}
            unit="BPM"
            onPick={(v) => setBpm(v)}
          />
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("autoarrange:review.key")}
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            maxLength={12}
            placeholder="C, Am, Bb…"
            className={control}
          />
        </label>
        <Button
          onClick={() => send({ target: "band_key", key: key.trim(), resultId: resultFor(keyEst) })}
          disabled={key.trim() === ""}
          loading={review.isPending}
          aria-label={`${t("autoarrange:review.confirm")} ${t("autoarrange:review.key")}`}
        >
          {t("autoarrange:review.confirm")}
        </Button>
        <div className="col-span-2 -mt-1">
          <ConfirmationLine c={overview.confirmations.band_key} />
          <Suggestions testId="suggest-key" values={keyChoices} onPick={(v) => setKey(v)} />
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("autoarrange:review.meter")}
          <select value={meter} onChange={(e) => setMeter(e.target.value)} className={control}>
            {COMMON_TIME_SIGNATURES.map((ts) => {
              const v = `${ts.beatsPerBar}/${ts.beatUnit}`;
              return (
                <option key={v} value={v}>
                  {v}
                </option>
              );
            })}
          </select>
        </label>
        <Button
          onClick={() => {
            const [a, b] = meter.split("/").map(Number);
            send({
              target: "band_meter",
              beatsPerBar: a!,
              beatUnit: b!,
              resultId: resultFor(meterEst),
            });
          }}
          loading={review.isPending}
          aria-label={`${t("autoarrange:review.confirm")} ${t("autoarrange:review.meter")}`}
        >
          {t("autoarrange:review.confirm")}
        </Button>
        <div className="col-span-2 -mt-1">
          <ConfirmationLine c={overview.confirmations.band_meter} />
          <Suggestions
            testId="suggest-meter"
            values={meterChoice ? [meterChoice] : []}
            onPick={(v) => setMeter(v)}
          />
        </div>
      </div>
    </div>
  );
}

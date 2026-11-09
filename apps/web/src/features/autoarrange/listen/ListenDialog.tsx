import type { AnalysisReport, SongReferenceSummary } from "@bandsync/shared";
import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Dialog } from "../../../components/ui";
import { errorText } from "../../../lib/errors";
import { useSubmitAnalysis } from "../queries";
import { ReferencePlayer } from "../reference";
import { analyse, decodeFile, ListenError, type MicCapture, startMicCapture } from "./audio";

const MAX_SECONDS = 60;
const MIN_SECONDS = 15;

type Phase =
  | { step: "intro" }
  | { step: "listening" }
  | { step: "analysing" }
  | { step: "done"; report: AnalysisReport }
  | { step: "error"; code: string };

const fmt = (n: number, lng: string) =>
  new Intl.NumberFormat(lng, { maximumFractionDigits: 1 }).format(n);

/** What the analysis found, worded as estimates. */
export function ReportSummary({ report }: { report: AnalysisReport }) {
  const { t, i18n } = useTranslation("autoarrange");
  const alt = report.bpm?.candidates.filter(
    (c) => c.score >= 0.7 && Math.abs(c.bpm - report.bpm!.value) > 1,
  );
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm" data-testid="listen-report">
      <dt className="text-muted">{t("results.kind.bpm")}</dt>
      <dd data-kind="bpm">
        <span className="font-semibold">
          {report.bpm ? fmt(report.bpm.value, i18n.language) : t("listen.notFound")}
        </span>
        {alt && alt.length > 0
          ? ` ${t("listen.or", { values: alt.map((a) => fmt(a.bpm, i18n.language)).join(", ") })}`
          : ""}
      </dd>
      <dt className="text-muted">{t("results.kind.key")}</dt>
      <dd data-kind="key">
        <span className="font-semibold">{report.key?.key ?? t("listen.notFound")}</span>
        {report.key?.candidates[1]
          ? ` ${t("listen.or", { values: report.key.candidates[1].key })}`
          : ""}
      </dd>
      <dt className="text-muted">{t("results.kind.time_signature")}</dt>
      <dd data-kind="time_signature" className="font-semibold">
        {report.meter
          ? `${report.meter.beatsPerBar}/${report.meter.beatUnit}`
          : t("listen.notFound")}
      </dd>
      <dt className="text-muted">{t("results.kind.beats")}</dt>
      <dd>
        {t("listen.beats", {
          count: report.beats.length,
          seconds: Math.round(report.analysedSeconds),
        })}
      </dd>
      <dd className="col-span-2 mt-1">
        <Badge tone="warn">{t("results.review.needs_review")}</Badge>{" "}
        <span className="text-xs text-muted">{t("listen.reviewHint")}</span>
      </dd>
    </dl>
  );
}

/**
 * "Ouvir pelo microfone": the member plays the reference recording and the device listens for up
 * to a minute. The audio is analysed on the device and discarded; only the results are saved.
 */
export function ListenDialog({
  open,
  onClose,
  bandId,
  songId,
  reference,
}: {
  open: boolean;
  onClose: () => void;
  bandId: string;
  songId: string;
  reference: SongReferenceSummary | null;
}) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const submit = useSubmitAnalysis(bandId, songId);
  const [phase, setPhase] = useState<Phase>({ step: "intro" });
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [playHere, setPlayHere] = useState(false);
  const capture = useRef<MicCapture | null>(null);

  const finish = async () => {
    const cap = capture.current;
    capture.current = null;
    if (!cap) return;
    const pcm = cap.stop();
    setPhase({ step: "analysing" });
    try {
      const report = await analyse(pcm);
      await submit.mutateAsync({ ...report, input: "microphone" });
      setPhase({ step: "done", report });
    } catch (err) {
      setPhase({ step: "error", code: err instanceof ListenError ? err.code : errorText(err) });
    }
  };

  // Progress while listening; stops by itself at the limit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: finish only reads refs and setters
  useEffect(() => {
    if (phase.step !== "listening") return;
    const id = window.setInterval(() => {
      const cap = capture.current;
      if (!cap) return;
      const s = cap.seconds();
      setSeconds(s);
      setLevel(cap.level());
      if (s >= MAX_SECONDS) void finish();
    }, 200);
    return () => window.clearInterval(id);
  }, [phase.step]);

  // Closing the dialog always releases the microphone.
  useEffect(() => {
    if (!open) {
      capture.current?.cancel();
      capture.current = null;
      setPhase({ step: "intro" });
      setSeconds(0);
      setPlayHere(false);
    }
  }, [open]);

  const start = async () => {
    try {
      capture.current = await startMicCapture(MAX_SECONDS);
      setSeconds(0);
      setPhase({ step: "listening" });
    } catch (err) {
      setPhase({ step: "error", code: err instanceof ListenError ? err.code : "mic_unavailable" });
    }
  };

  const errorMessage = (code: string) =>
    t(`autoarrange:listen.error.${code}`, { defaultValue: code });

  return (
    <Dialog open={open} onClose={onClose} title={t("autoarrange:listen.title")}>
      <div
        className="flex flex-col gap-4 text-sm"
        data-testid="listen-dialog"
        data-step={phase.step}
      >
        {phase.step === "intro" ? (
          <>
            <p>{t("autoarrange:listen.intro")}</p>
            <ul className="list-disc pl-5 text-muted">
              <li>{t("autoarrange:listen.tip1")}</li>
              <li>{t("autoarrange:listen.tip2")}</li>
              <li>{t("autoarrange:listen.tip3")}</li>
            </ul>
            {reference?.platform && reference.externalId && reference.embeddable !== false ? (
              <div>
                <Button size="sm" variant="ghost" onClick={() => setPlayHere((v) => !v)}>
                  {playHere
                    ? t("autoarrange:reference.hidePlayer")
                    : t("autoarrange:listen.playHere")}
                </Button>
                {playHere ? (
                  <div className="mt-2">
                    <ReferencePlayer
                      platform={reference.platform}
                      externalId={reference.externalId}
                      title={reference.title}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="text-xs text-muted">{t("autoarrange:listen.privacy")}</p>
            <Button size="lg" icon={<Mic className="size-5" />} onClick={start}>
              {t("autoarrange:listen.start")}
            </Button>
          </>
        ) : null}

        {phase.step === "listening" ? (
          <>
            <p className="font-medium">{t("autoarrange:listen.listening")}</p>
            <div
              className="h-3 overflow-hidden rounded-full bg-sunken"
              role="meter"
              aria-label={t("autoarrange:listen.level")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level * 100)}
            >
              <div
                className="h-full bg-accent-500 transition-[width]"
                style={{ width: `${level * 100}%` }}
              />
            </div>
            <p className="tabular-nums text-muted" data-testid="listen-seconds">
              {t("autoarrange:listen.progress", { seconds: Math.floor(seconds), max: MAX_SECONDS })}
            </p>
            {level < 0.02 && seconds > 3 ? (
              <p className="text-warn-500">{t("autoarrange:listen.quiet")}</p>
            ) : null}
            <Button
              size="lg"
              icon={<Square className="size-5" />}
              onClick={() => void finish()}
              disabled={seconds < MIN_SECONDS}
            >
              {seconds < MIN_SECONDS
                ? t("autoarrange:listen.keepGoing", { seconds: Math.ceil(MIN_SECONDS - seconds) })
                : t("autoarrange:listen.stop")}
            </Button>
          </>
        ) : null}

        {phase.step === "analysing" ? (
          <p className="font-medium" role="status">
            {t("autoarrange:listen.analysing")}
          </p>
        ) : null}

        {phase.step === "done" ? (
          <>
            <p className="font-medium text-ok-500" role="status">
              {t("autoarrange:listen.saved")}
            </p>
            <ReportSummary report={phase.report} />
            {phase.report.signal.tooQuiet ? (
              <p className="text-warn-500">{t("autoarrange:listen.wasQuiet")}</p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setPhase({ step: "intro" })}>
                {t("autoarrange:listen.again")}
              </Button>
              <Button onClick={onClose}>{t("autoarrange:listen.review")}</Button>
            </div>
          </>
        ) : null}

        {phase.step === "error" ? (
          <>
            <p className="rounded-xl border border-danger-500/40 bg-danger-500/5 p-3" role="alert">
              {errorMessage(phase.code)}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                {t("common:actions.close")}
              </Button>
              <Button onClick={() => setPhase({ step: "intro" })}>
                {t("autoarrange:listen.again")}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Analyses an authorised audio file on this device and saves the results. */
export function useAnalyseFile(bandId: string, songId: string) {
  const submit = useSubmitAnalysis(bandId, songId);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (audioAssetId: string, source: Blob | { fileId: string }) => {
    setBusy(audioAssetId);
    try {
      const blob =
        source instanceof Blob
          ? source
          : await fetch(`/api/bands/${bandId}/files/${source.fileId}`, {
              credentials: "same-origin",
            }).then((r) => {
              if (!r.ok) throw new ListenError("decode_failed");
              return r.blob();
            });
      const report = await analyse(await decodeFile(blob));
      await submit.mutateAsync({ ...report, input: "audio_file", audioAssetId });
      return report;
    } finally {
      setBusy(null);
    }
  };
  return { run, busy };
}

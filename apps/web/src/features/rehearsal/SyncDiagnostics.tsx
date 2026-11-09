import type { ClockEstimate } from "@bandsync/shared";
import { useTranslation } from "react-i18next";
import { Badge, Button } from "../../components/ui";
import { audioEngine } from "../../lib/audio/AudioEngine";
import { formatNumber } from "../../lib/format";

export function qualityTone(q: ClockEstimate["quality"]): "ok" | "warn" | "danger" | "neutral" {
  return q === "good" ? "ok" : q === "fair" ? "warn" : q === "poor" ? "danger" : "neutral";
}

export function SyncDiagnostics({
  clock,
  onResync,
}: {
  clock: ClockEstimate;
  onResync: () => void;
}) {
  const { t, i18n } = useTranslation("rehearsal");
  const fmt = (n: number) => formatNumber(n, i18n.language, { maximumFractionDigits: 1 });
  const latencyMs = Math.round(audioEngine.outputLatency() * 1000);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t("sync.title")}</h3>
        <Badge tone={qualityTone(clock.quality)}>{t(`sync.quality.${clock.quality}`)}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm sm:grid-cols-4">
        <dt className="text-muted">{t("sync.offset")}</dt>
        <dd>{fmt(clock.offsetMs)} ms</dd>
        <dt className="text-muted">{t("sync.rtt")}</dt>
        <dd>
          {fmt(clock.minRttMs)} / {fmt(clock.medianRttMs)} ms
        </dd>
        <dt className="text-muted">{t("sync.jitter")}</dt>
        <dd>{fmt(clock.jitterMs)} ms</dd>
        <dt className="text-muted">{t("sync.samples")}</dt>
        <dd>{clock.sampleCount}</dd>
      </dl>
      {latencyMs > 0 ? (
        <p className="text-xs text-muted">{t("audio.latency", { ms: latencyMs })}</p>
      ) : null}
      <p className="text-xs text-muted">{t("sync.help")}</p>
      <Button variant="secondary" size="sm" onClick={onResync} className="self-start">
        {t("sync.resync")}
      </Button>
    </div>
  );
}

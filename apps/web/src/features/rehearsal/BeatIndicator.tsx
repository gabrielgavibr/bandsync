import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import type { BeatDisplay } from "./useMetronome";

export function BeatIndicator({
  beat,
  beatsPerBar,
  running,
  compact,
}: {
  beat: BeatDisplay | null;
  beatsPerBar: number;
  running: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation("rehearsal");
  const dots = Array.from({ length: Math.min(beatsPerBar, 16) }, (_, i) => i + 1);
  return (
    <div className={cn("flex flex-col items-center gap-2", compact ? "" : "py-2")} aria-live="off">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {dots.map((n) => {
          const active = running && beat?.beatInBar === n;
          return (
            <span
              key={n}
              className={cn(
                "relative rounded-full transition-colors duration-75",
                compact ? "size-3" : "size-5 sm:size-6",
                active
                  ? beat?.isCountIn
                    ? "bg-warn-500"
                    : n === 1
                      ? "bg-accent-400"
                      : "bg-fg"
                  : "bg-sunken border border-line",
              )}
            >
              {active ? (
                <span
                  key={beat?.pulse}
                  className={cn(
                    "beat-pulse absolute inset-0 rounded-full",
                    beat?.isCountIn ? "bg-warn-500" : "bg-accent-400",
                  )}
                />
              ) : null}
            </span>
          );
        })}
      </div>
      {!compact ? (
        <p className="h-6 font-mono text-sm text-muted">
          {running && beat
            ? beat.isCountIn
              ? `${t("beat.countIn")} · ${beat.beatInBar}`
              : t("beat.bar", { bar: beat.bar })
            : " "}
        </p>
      ) : null}
    </div>
  );
}

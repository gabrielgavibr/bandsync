import type { PreSectionInput } from "@bandsync/shared";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { formatDuration } from "../../lib/format";

/** A steady colour per repetition letter, so the same passage looks the same each time. */
export function letterColor(label: string | null | undefined): string {
  const i = label ? label.charCodeAt(0) - 65 : 25;
  return `hsl(${(i * 47 + 170) % 360} 55% 45%)`;
}

const clock = (s: number) => formatDuration(Math.max(0, Math.round(s)));

/** "Seção B" unless the analysis had reasonable evidence for a function ("Refrão (provável)"). */
export function useSectionTitle() {
  const { t } = useTranslation("autoarrange");
  return (s: Pick<PreSectionInput, "label" | "kind" | "kindConfidence">) =>
    s.kind !== "unknown" && s.kindConfidence === "medium"
      ? t("pre.kindLikely", { kind: t(`pre.kind.${s.kind}`) })
      : t("pre.letter", { label: s.label });
}

/**
 * The whole recording as a strip of sections. Tapping a section plays it from its start in the
 * official player; the line shows where playback is.
 */
export function RecordingTimeline({
  sections,
  durationSec,
  time,
  onSeek,
  marks,
  activeIndex,
}: {
  sections: PreSectionInput[];
  durationSec: number;
  time: number;
  onSeek?: (seconds: number) => void;
  /** Moments marked by a member (marking mode). */
  marks?: number[];
  activeIndex?: number | null;
}) {
  const { t } = useTranslation("autoarrange");
  const title = useSectionTitle();
  const total = Math.max(
    durationSec,
    sections.length ? sections[sections.length - 1]!.endSec : 0,
    1,
  );
  const pct = (s: number) => `${Math.min(100, Math.max(0, (s / total) * 100))}%`;
  const step = total > 360 ? 60 : 30;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);

  return (
    <div className="flex flex-col gap-1" data-testid="recording-timeline">
      <div className="relative h-16 w-full overflow-hidden rounded-xl bg-sunken">
        {sections.map((s, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: sections have no id; order is stable
            key={i}
            type="button"
            data-label={s.label}
            onClick={() => onSeek?.(s.startSec)}
            disabled={!onSeek}
            aria-label={`${title(s)}: ${clock(s.startSec)}–${clock(s.endSec)}`}
            title={`${title(s)} · ${clock(s.startSec)}–${clock(s.endSec)} · ${t("pre.barsCount", { count: s.bars })}`}
            className={cn(
              "absolute inset-y-0 flex items-start overflow-hidden border-r-2 border-[var(--color-bg)] px-1.5 py-1 text-left text-xs font-semibold text-white",
              activeIndex === i && "ring-2 ring-inset ring-white",
            )}
            style={{
              left: pct(s.startSec),
              width: pct(s.endSec - s.startSec),
              background: letterColor(s.label),
            }}
          >
            {s.label}
          </button>
        ))}
        {marks?.map((m) => (
          <span
            key={m}
            aria-hidden="true"
            className="absolute inset-y-0 w-0.5 bg-accent-400"
            style={{ left: pct(m) }}
          />
        ))}
        <span
          aria-hidden="true"
          data-testid="playhead"
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-fg"
          style={{ left: pct(time) }}
        />
      </div>
      <div className="relative h-4 text-[10px] text-muted" aria-hidden="true">
        {ticks.map((s) => (
          <span key={s} className="absolute -translate-x-1/2" style={{ left: pct(s) }}>
            {clock(s)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Where a position falls in the list of sections. */
export const sectionAt = (sections: PreSectionInput[], seconds: number) =>
  sections.findIndex((s) => seconds >= s.startSec && seconds < s.endSec);

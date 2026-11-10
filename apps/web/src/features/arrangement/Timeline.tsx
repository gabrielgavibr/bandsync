import type { PreSectionInput } from "@bandsync/shared";
import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { formatDuration } from "../../lib/format";
import type { EditableSection } from "./model";
import { clockTenths } from "./PlayerBar";

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

function Ruler({ total }: { total: number }) {
  const step = total > 360 ? 60 : total > 90 ? 30 : 15;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  return (
    <div className="relative h-4 text-[10px] text-muted" aria-hidden="true">
      {ticks.map((s) => (
        <span
          key={s}
          className="absolute -translate-x-1/2"
          style={{ left: `${(s / total) * 100}%` }}
        >
          {clock(s)}
        </span>
      ))}
    </div>
  );
}

/** Seconds at a horizontal position of the track. */
function secondsAt(track: HTMLElement, clientX: number, total: number): number {
  const r = track.getBoundingClientRect();
  return Math.max(0, Math.min(total, ((clientX - r.left) / Math.max(1, r.width)) * total));
}

/**
 * The recording as the analysis (or a member's marks) mapped it. Sections are blocks, coloured
 * by what they contain, so a part that returns looks the same; events inside a section are
 * small ticks; a possible division is a dashed line. Tapping a block plays that section; the
 * strip under it goes to any moment.
 */
export function RecordingTimeline({
  sections,
  durationSec,
  time,
  onSeek,
  onPlaySection,
  marks,
  activeIndex,
}: {
  sections: PreSectionInput[];
  durationSec: number;
  time: number;
  onSeek?: (seconds: number) => void;
  onPlaySection?: (index: number) => void;
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

  return (
    <div className="flex flex-col gap-1" data-testid="recording-timeline">
      <div className="relative h-16 w-full overflow-hidden rounded-xl bg-sunken">
        {sections.map((s, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: sections have no id; order is stable
            key={i}
            type="button"
            data-label={s.label}
            onClick={() => (onPlaySection ? onPlaySection(i) : onSeek?.(s.startSec))}
            disabled={!onSeek && !onPlaySection}
            aria-label={`${title(s)}: ${clock(s.startSec)}–${clock(s.endSec)}`}
            aria-current={activeIndex === i ? "true" : undefined}
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
        {sections.flatMap((s) =>
          s.cues.map((c) => {
            const at = s.startSec + (c.bar / Math.max(1, s.bars)) * (s.endSec - s.startSec);
            if (c.bar === 0) return null;
            return (
              <span
                key={`${s.startSec}:${c.bar}:${c.type}`}
                aria-hidden="true"
                data-event={c.type}
                title={t(`pre.cue.${c.type}`)}
                className={cn(
                  "pointer-events-none absolute",
                  c.type === "maybe"
                    ? "inset-y-0 border-l-2 border-dashed border-white/80"
                    : "bottom-0 h-3 w-1 rounded-t bg-white/90",
                )}
                style={{ left: pct(at) }}
              />
            );
          }),
        )}
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
      {onSeek ? (
        <button
          type="button"
          data-testid="timeline-seek"
          aria-label={t("player.seekStrip")}
          className="relative h-3 w-full cursor-pointer rounded bg-sunken"
          onClick={(e) => onSeek(secondsAt(e.currentTarget, e.clientX, total))}
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 rounded bg-accent-500/50"
            style={{ width: pct(time) }}
          />
        </button>
      ) : null}
      <Ruler total={total} />
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
        <span>{t("timeline.legendSame")}</span>
        <span>
          <span aria-hidden="true" className="mr-1 inline-block h-2 w-1 rounded-t bg-fg/70" />
          {t("timeline.legendEvent")}
        </span>
        <span>
          <span
            aria-hidden="true"
            className="mr-1 inline-block h-3 border-l-2 border-dashed border-fg/70 align-middle"
          />
          {t("timeline.legendMaybe")}
        </span>
      </p>
    </div>
  );
}

/** Where a position falls in the list of sections. */
export const sectionAt = (sections: PreSectionInput[], seconds: number) =>
  sections.findIndex((s) => seconds >= s.startSec && seconds < s.endSec);

/**
 * The band's arrangement laid over the recording: each section where it is heard. The limit
 * between two neighbours can be dragged (or moved with the arrow keys), and the change shows at
 * once. Sections without a place in the recording (added by hand) are not drawn here.
 */
export function BandTimeline({
  sections,
  durationSec,
  time,
  currentKey,
  onPlay,
  onMoveBoundary,
  onSeek,
}: {
  sections: EditableSection[];
  durationSec: number;
  time: number;
  currentKey: string | null;
  onPlay?: (index: number) => void;
  /** Moves the limit after section `index` to `ms` (undefined: read only). */
  onMoveBoundary?: (index: number, ms: number) => void;
  onSeek?: (seconds: number) => void;
}) {
  const { t } = useTranslation("autoarrange");
  const track = useRef<HTMLDivElement>(null);
  const timed = sections
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s.startMs !== null && x.s.endMs !== null);
  if (timed.length === 0) return null;
  const total = Math.max(durationSec, ...timed.map((x) => x.s.endMs! / 1000), 1);
  const pct = (sec: number) => `${Math.min(100, Math.max(0, (sec / total) * 100))}%`;

  const drag = (index: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (!onMoveBoundary || !track.current || !e.currentTarget.hasPointerCapture(e.pointerId))
      return;
    onMoveBoundary(index, Math.round(secondsAt(track.current, e.clientX, total) * 10) * 100);
  };
  const nudge = (index: number, at: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!onMoveBoundary) return;
    const step = e.shiftKey ? 1000 : 100;
    if (e.key === "ArrowLeft") onMoveBoundary(index, at - step);
    else if (e.key === "ArrowRight") onMoveBoundary(index, at + step);
    else return;
    e.preventDefault();
  };

  return (
    <div className="flex flex-col gap-1" data-testid="band-timeline">
      <div ref={track} className="relative h-14 w-full rounded-xl bg-sunken">
        {timed.map(({ s, i }) => (
          <button
            key={s.key}
            type="button"
            data-name={s.name}
            aria-current={currentKey === s.key ? "true" : undefined}
            onClick={() => onPlay?.(i)}
            title={`${s.name} · ${clockTenths(s.startMs! / 1000)}–${clockTenths(s.endMs! / 1000)}`}
            className={cn(
              "absolute inset-y-0 overflow-hidden whitespace-nowrap border-r border-[var(--color-bg)] px-1.5 py-1 text-left text-xs font-semibold text-white first:rounded-l-xl",
              currentKey === s.key && "ring-2 ring-inset ring-white",
            )}
            style={{
              left: pct(s.startMs! / 1000),
              width: pct((s.endMs! - s.startMs!) / 1000),
              background: letterColor(s.label),
            }}
          >
            {s.name}
          </button>
        ))}
        {onMoveBoundary
          ? timed.map(({ s, i }, k) => {
              const next = timed[k + 1];
              // A handle only where two sections meet: it moves the end of one and the start of the other.
              if (!next || next.i !== i + 1 || Math.abs(next.s.startMs! - s.endMs!) > 60)
                return null;
              return (
                <button
                  key={`h:${s.key}`}
                  type="button"
                  role="slider"
                  data-testid="boundary-handle"
                  aria-label={t("timeline.boundary", { before: s.name, after: next.s.name })}
                  aria-valuemin={Math.round(s.startMs! / 100) / 10}
                  aria-valuemax={Math.round(next.s.endMs! / 100) / 10}
                  aria-valuenow={Math.round(s.endMs! / 100) / 10}
                  aria-valuetext={clockTenths(s.endMs! / 1000)}
                  onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                  onPointerMove={drag(i)}
                  onKeyDown={nudge(i, s.endMs!)}
                  className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize touch-none"
                  style={{ left: pct(s.endMs! / 1000) }}
                >
                  <span
                    aria-hidden="true"
                    className="mx-auto block h-full w-1.5 rounded bg-white shadow ring-1 ring-black/40"
                  />
                </button>
              );
            })
          : null}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-fg"
          style={{ left: pct(time) }}
        />
      </div>
      {onSeek ? (
        <button
          type="button"
          aria-label={t("player.seekStrip")}
          className="relative h-3 w-full cursor-pointer rounded bg-sunken"
          onClick={(e) => onSeek(secondsAt(e.currentTarget, e.clientX, total))}
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 rounded bg-accent-500/50"
            style={{ width: pct(time) }}
          />
        </button>
      ) : null}
      <Ruler total={total} />
    </div>
  );
}

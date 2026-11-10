import {
  Pause,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import type { SectionPlayback, Transport } from "./transport";

const JUMP_SECONDS = 5;

/** m:ss.d — tenths matter when a boundary is being placed by ear. */
export function clockTenths(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

/**
 * Transport controls for the recording being reviewed. Stays at the bottom of the screen while
 * the page scrolls, so a section can be heard and corrected without going back up.
 */
export function PlayerBar({
  transport,
  playback,
  currentName,
  sourceName,
}: {
  transport: Transport;
  playback: SectionPlayback;
  /** Name of the section sounding now. */
  currentName: string | null;
  /** What is playing: the uploaded file's name, or the platform. */
  sourceName: string;
}) {
  const { t } = useTranslation("autoarrange");
  const disabled = !transport.ready;
  const btn =
    "inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-fg hover:bg-elev disabled:opacity-40";
  const jump = (by: number) => transport.seek(transport.now() + by);

  return (
    <section
      aria-label={t("player.label")}
      data-testid="player-bar"
      data-kind={transport.kind}
      data-playing={transport.playing}
      data-passage={playback.active?.id ?? ""}
      className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur sm:bottom-4"
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold" data-testid="player-section">
            {currentName ?? t("player.noSection")}
          </span>
          <span className="text-muted"> · {sourceName}</span>
        </span>
        <span className="shrink-0 font-mono tabular-nums" data-testid="player-time">
          {clockTenths(transport.time)} / {clockTenths(transport.duration)}
        </span>
      </div>

      <input
        type="range"
        aria-label={t("player.position")}
        min={0}
        max={Math.max(1, transport.duration)}
        step={0.1}
        value={Math.min(transport.time, Math.max(1, transport.duration))}
        disabled={disabled}
        onChange={(e) => {
          playback.release();
          transport.seek(Number(e.target.value));
        }}
        className="mt-1 w-full accent-[var(--color-accent-500)]"
      />

      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex items-center">
          <button
            type="button"
            className={btn}
            disabled={disabled}
            onClick={() => playback.step(-1)}
            aria-label={t("player.previous")}
            title={t("player.previous")}
          >
            <SkipBack className="size-5" />
          </button>
          <button
            type="button"
            className={btn}
            disabled={disabled}
            onClick={() => jump(-JUMP_SECONDS)}
            aria-label={t("player.back", { seconds: JUMP_SECONDS })}
            title={t("player.back", { seconds: JUMP_SECONDS })}
          >
            <RotateCcw className="size-5" />
          </button>
          <button
            type="button"
            className={cn(btn, "bg-accent-500 text-[#04221f] hover:bg-accent-400")}
            disabled={disabled}
            onClick={() => (transport.playing ? transport.pause() : transport.play())}
            aria-label={transport.playing ? t("player.pause") : t("player.play")}
            data-testid="player-toggle"
          >
            {transport.playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          </button>
          <button
            type="button"
            className={btn}
            disabled={disabled}
            onClick={() => jump(JUMP_SECONDS)}
            aria-label={t("player.forward", { seconds: JUMP_SECONDS })}
            title={t("player.forward", { seconds: JUMP_SECONDS })}
          >
            <RotateCw className="size-5" />
          </button>
          <button
            type="button"
            className={btn}
            disabled={disabled}
            onClick={() => playback.step(1)}
            aria-label={t("player.next")}
            title={t("player.next")}
          >
            <SkipForward className="size-5" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-pressed={playback.loop}
            onClick={() => playback.setLoop(!playback.loop)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium",
              playback.loop
                ? "bg-accent-500/20 text-accent-600 dark:text-accent-300"
                : "text-muted hover:bg-elev",
            )}
          >
            <Repeat className="size-4" /> {t("player.loop")}
          </button>
          <button
            type="button"
            aria-pressed={playback.carryOn}
            onClick={() => playback.setCarryOn(!playback.carryOn)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium",
              playback.carryOn
                ? "bg-accent-500/20 text-accent-600 dark:text-accent-300"
                : "text-muted hover:bg-elev",
            )}
          >
            {t("player.carryOn")}
          </button>
          {transport.volume !== null ? (
            <label className="hidden items-center gap-1.5 text-muted sm:flex">
              <Volume2 className="size-4" aria-hidden="true" />
              <input
                type="range"
                aria-label={t("player.volume")}
                min={0}
                max={1}
                step={0.05}
                value={transport.volume}
                onChange={(e) => transport.setVolume(Number(e.target.value))}
                className="w-20 accent-[var(--color-accent-500)]"
              />
            </label>
          ) : null}
        </div>
      </div>
      {transport.failed ? <p className="mt-1 text-xs text-warn-500">{t("player.failed")}</p> : null}
    </section>
  );
}

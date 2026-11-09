import { type ClickEvent, clicksBetween, type MeterSpec, type TempoAnchor } from "@bandsync/shared";
import type { AudioEngine } from "./AudioEngine";

/**
 * Lookahead scheduler (Chris Wilson's "tale of two clocks" pattern).
 *
 * A coarse JS timer wakes every `tickMs`; on each wake we enumerate every click whose
 * *server* time falls inside [cursor, now + lookaheadMs) and hand them to the Web Audio
 * clock with sample-accurate `start(when)`. The JS timer never produces sound itself, so
 * timer jitter does not reach the ear. Click times are computed from the shared anchor,
 * so a thousand bars in, beat N is still exactly where the server said it would be.
 *
 * Time domains:
 *   server ms  --(- offset)-->  client wall ms (Date.now())  --(perf mapping)-->  AudioContext s
 */
export interface SchedulerDeps {
  engine: AudioEngine;
  /** Current estimate of (serverTime - clientTime), ms. */
  getOffsetMs: () => number;
  /** Called when a click is scheduled; used for visual beat indication. */
  onClick?: (ev: ClickEvent, audioTime: number, clientMs: number) => void;
}

export interface SchedulerState {
  anchor: TempoAnchor;
  meter: MeterSpec;
  audible: boolean;
}

export class MetronomeScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private cursorServerMs = 0;
  private state: SchedulerState | null = null;
  /** Latest wall-clock/perf relation, refreshed on each tick. */
  private perfMinusDate = performance.now() - Date.now();
  readonly lookaheadMs: number;
  readonly tickMs: number;
  /** Clicks scheduled later than this far in the past are dropped (e.g. after a long tab freeze). */
  private readonly maxCatchUpMs = 50;

  constructor(
    private readonly deps: SchedulerDeps,
    opts: { lookaheadMs?: number; tickMs?: number } = {},
  ) {
    this.lookaheadMs = opts.lookaheadMs ?? 120;
    this.tickMs = opts.tickMs ?? 25;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Start (or re-plan) from a timeline. Safe to call while running: future clicks follow the new anchor. */
  start(state: SchedulerState): void {
    const wasRunning = this.running;
    this.state = state;
    const nowServer = Date.now() + this.deps.getOffsetMs();
    if (!wasRunning) {
      // Begin slightly in the past so a start instant that is "now" is not skipped.
      this.cursorServerMs = Math.max(
        nowServer - this.maxCatchUpMs,
        Math.min(nowServer, state.anchor.serverMs),
      );
      this.timer = setInterval(() => this.tick(), this.tickMs);
      this.tick();
    } else if (state.anchor.serverMs > this.cursorServerMs) {
      // Anchor change on a future bar boundary: clicks already scheduled before it stay valid,
      // and we only need to re-plan from the boundary on. Clicks between cursor and boundary keep the
      // old anchor; they were produced with it already because cursor >= now + lookahead typically.
      // To stay safe, pull the cursor back to the boundary if we had scheduled past it.
      if (this.cursorServerMs > state.anchor.serverMs) this.cursorServerMs = state.anchor.serverMs;
    }
  }

  update(partial: Partial<SchedulerState>): void {
    if (!this.state) return;
    this.start({ ...this.state, ...partial });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state = null;
  }

  private tick(): void {
    const st = this.state;
    if (!st) return;
    const offset = this.deps.getOffsetMs();
    const nowClient = Date.now();
    const nowServer = nowClient + offset;
    this.perfMinusDate = performance.now() - nowClient;
    const windowEnd = nowServer + this.lookaheadMs;
    if (windowEnd <= this.cursorServerMs) return;
    // After a long freeze (tab hidden) skip ahead instead of firing a burst of stale clicks.
    if (this.cursorServerMs < nowServer - this.maxCatchUpMs)
      this.cursorServerMs = nowServer - this.maxCatchUpMs;
    const clicks = clicksBetween(st.anchor, st.meter, this.cursorServerMs, windowEnd);
    for (const c of clicks) {
      const clientMs = c.serverMs - offset;
      const perfMs = clientMs + this.perfMinusDate;
      const audioTime = this.deps.engine.perfToAudioTime(perfMs);
      if (st.audible)
        this.deps.engine.scheduleClick(audioTime, c.info.accent && c.sub === 0, c.sub !== 0);
      this.deps.onClick?.(c, audioTime, clientMs);
    }
    this.cursorServerMs = windowEnd;
  }
}

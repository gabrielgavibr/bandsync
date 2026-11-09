import { startAnchor } from "@bandsync/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioEngine } from "../src/lib/audio/AudioEngine";
import { MetronomeScheduler } from "../src/lib/audio/MetronomeScheduler";

/** Fake engine: audio time == performance.now()/1000 so scheduled times are easy to assert. */
function fakeEngine() {
  const scheduled: { at: number; accent: boolean; sub: boolean }[] = [];
  const engine = {
    perfToAudioTime: (perfMs: number) => perfMs / 1000,
    scheduleClick: (at: number, accent: boolean, sub: boolean) =>
      scheduled.push({ at, accent, sub }),
    outputLatency: () => 0,
  } as unknown as AudioEngine;
  return { engine, scheduled };
}

describe("MetronomeScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("schedules clicks ahead of time at exact anchor-derived instants", () => {
    const { engine, scheduled } = fakeEngine();
    const offset = 250; // server is 250ms ahead of this client
    const s = new MetronomeScheduler(
      { engine, getOffsetMs: () => offset },
      { lookaheadMs: 120, tickMs: 25 },
    );
    const startAtServer = Date.now() + offset + 1000; // start in 1s
    s.start({
      anchor: startAnchor(startAtServer, 120, { beatsPerBar: 4, countInBars: 0, subdivision: 1 }),
      meter: { beatsPerBar: 4, countInBars: 0, subdivision: 1 },
      audible: true,
    });
    vi.advanceTimersByTime(2000);
    // Beats every 500ms starting at client time 101_000 → audio times 101.0, 101.5, 102.0
    const ats = scheduled.map((c) => Number(c.at.toFixed(3)));
    expect(ats.slice(0, 3)).toEqual([101.0, 101.5, 102.0]);
    expect(scheduled[0]!.accent).toBe(true);
    expect(scheduled[1]!.accent).toBe(false);
    // No duplicates
    expect(new Set(ats).size).toBe(ats.length);
    s.stop();
  });

  it("uses the clock offset: a changed offset shifts future clicks", () => {
    const { engine, scheduled } = fakeEngine();
    let offset = 0;
    const s = new MetronomeScheduler(
      { engine, getOffsetMs: () => offset },
      { lookaheadMs: 100, tickMs: 25 },
    );
    s.start({
      anchor: startAnchor(Date.now() + 500, 60, { beatsPerBar: 4, countInBars: 0, subdivision: 1 }),
      meter: { beatsPerBar: 4, countInBars: 0, subdivision: 1 },
      audible: true,
    });
    vi.advanceTimersByTime(600);
    const first = scheduled[0]!.at;
    expect(first).toBeCloseTo(100.5, 3);
    offset = 100; // server is now believed to be 100ms ahead → clicks happen 100ms earlier locally
    vi.advanceTimersByTime(1000);
    const second = scheduled[1]!.at;
    expect(second).toBeCloseTo(101.4, 3);
    s.stop();
  });

  it("drops clicks after a long freeze instead of bursting", () => {
    const { engine, scheduled } = fakeEngine();
    const s = new MetronomeScheduler(
      { engine, getOffsetMs: () => 0 },
      { lookaheadMs: 100, tickMs: 25 },
    );
    s.start({
      anchor: startAnchor(Date.now(), 240, { beatsPerBar: 4, countInBars: 0, subdivision: 1 }),
      meter: { beatsPerBar: 4, countInBars: 0, subdivision: 1 },
      audible: true,
    });
    vi.advanceTimersByTime(200);
    const before = scheduled.length;
    // Simulate the tab being frozen for 3 seconds: the timer does not fire, then one tick happens.
    vi.setSystemTime(Date.now() + 3000);
    vi.advanceTimersByTime(25);
    const burst = scheduled.length - before;
    // 3s at 240bpm would be 12 clicks; we expect only the ones inside the catch-up + lookahead window.
    expect(burst).toBeLessThanOrEqual(2);
    s.stop();
  });

  it("can run silently (visual only) and switch audibility live", () => {
    const { engine, scheduled } = fakeEngine();
    const clicks: number[] = [];
    const s = new MetronomeScheduler(
      { engine, getOffsetMs: () => 0, onClick: (ev) => clicks.push(ev.beatIndex) },
      { lookaheadMs: 100, tickMs: 25 },
    );
    s.start({
      anchor: startAnchor(Date.now(), 120, { beatsPerBar: 4, countInBars: 1, subdivision: 1 }),
      meter: { beatsPerBar: 4, countInBars: 1, subdivision: 1 },
      audible: false,
    });
    vi.advanceTimersByTime(1100);
    expect(scheduled.length).toBe(0);
    expect(clicks[0]).toBe(-4); // count-in starts at -4
    s.update({ audible: true });
    vi.advanceTimersByTime(1000);
    expect(scheduled.length).toBeGreaterThan(0);
    s.stop();
    expect(s.running).toBe(false);
  });
});

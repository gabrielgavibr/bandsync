import { describe, expect, it } from "vitest";
import {
  beatIndexAt,
  beatTimeMs,
  clicksBetween,
  describeBeat,
  retimeAtNextBar,
  startAnchor,
} from "../src/sync/metronome";

describe("metronome timeline", () => {
  const meter = { beatsPerBar: 4, countInBars: 1, subdivision: 1 as const };

  it("places the count-in before beat zero", () => {
    const a = startAnchor(10_000, 120, meter);
    expect(a.beatIndex).toBe(-4);
    expect(beatTimeMs(a, -4)).toBe(10_000);
    expect(beatTimeMs(a, 0)).toBe(12_000);
    expect(beatIndexAt(a, 11_000)).toBeCloseTo(-2);
  });

  it("describes beats with bars and accents", () => {
    expect(describeBeat(-4, 4)).toMatchObject({
      isCountIn: true,
      bar: -1,
      beatInBar: 1,
      accent: true,
    });
    expect(describeBeat(-1, 4)).toMatchObject({
      isCountIn: true,
      bar: -1,
      beatInBar: 4,
      accent: false,
    });
    expect(describeBeat(0, 4)).toMatchObject({
      isCountIn: false,
      bar: 1,
      beatInBar: 1,
      accent: true,
    });
    expect(describeBeat(5, 4)).toMatchObject({ bar: 2, beatInBar: 2, accent: false });
  });

  it("enumerates clicks in a window without duplicates or gaps", () => {
    const a = startAnchor(0, 120, meter); // 500ms per beat, count-in from -4 at t=0
    const first = clicksBetween(a, meter, 0, 1000);
    expect(first.map((c) => c.serverMs)).toEqual([0, 500]);
    const second = clicksBetween(a, meter, 1000, 2600);
    expect(second.map((c) => c.beatIndex)).toEqual([-2, -1, 0, 1]);
    expect(second[2]!.info.accent).toBe(true);
    // Nothing before the count-in starts.
    expect(clicksBetween(a, meter, -2000, 0)).toEqual([]);
  });

  it("supports subdivisions", () => {
    const a = startAnchor(0, 120, { ...meter, subdivision: 2 });
    const clicks = clicksBetween(a, { ...meter, subdivision: 2 }, 0, 1000);
    expect(clicks.map((c) => [c.beatIndex, c.sub, c.serverMs])).toEqual([
      [-4, 0, 0],
      [-4, 1, 250],
      [-3, 0, 500],
      [-3, 1, 750],
    ]);
  });

  it("changes tempo only on a future bar boundary", () => {
    const a = startAnchor(0, 120, meter); // beat 0 at 2000ms, bar 2 at 4000ms
    const next = retimeAtNextBar(a, 4, 90, 2100);
    expect(next.beatIndex).toBe(4);
    expect(next.serverMs).toBe(4000);
    expect(next.bpm).toBe(90);
    // The beat after the boundary follows the new tempo.
    expect(beatTimeMs(next, 5)).toBeCloseTo(4000 + 60000 / 90);
    // During the count-in the change lands on beat 0.
    expect(retimeAtNextBar(a, 4, 100, 500)).toMatchObject({ beatIndex: 0, serverMs: 2000 });
  });
});

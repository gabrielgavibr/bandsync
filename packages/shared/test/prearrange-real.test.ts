import { describe, expect, it } from "vitest";
import { analyzeAudio } from "../src/analysis/analyze";
import { prearrange } from "../src/analysis/prearrange";
import { concat, decodeFixture, SR } from "./real-audio";

/**
 * Real recordings (see fixtures/audio/ATTRIBUTION.md). These are not synthetic metronomes: real
 * instruments, real rooms, real performances.
 */
const near = (a: number, b: number, tol: number) => Math.abs(a / b - 1) <= tol;
/** Same tempo, or the same up to half/double time (which BandSync then offers as an alternative). */
const sameTempo = (r: ReturnType<typeof analyzeAudio>, ref: number) =>
  near(r.bpm!.value, ref, 0.05) ||
  r.bpm!.candidates.some((c) => c.score >= 0.7 && near(c.bpm, ref, 0.05));

describe("real recordings: tempo and key", () => {
  it("Hungarian Dance no. 5 (orchestra): G minor, tempo agreeing with an independent analysis", () => {
    const r = analyzeAudio([decodeFixture("hungarian-dance-5.ogg")], SR);
    expect(r.key!.key).toBe("Gm");
    expect(sameTempo(r, 152), JSON.stringify(r.bpm)).toBe(true);
  });

  it("Vibe Ace (jazz): E, swing tempo read at half or full speed", () => {
    const r = analyzeAudio([decodeFixture("vibe-ace.ogg")], SR);
    expect(r.key!.key).toBe("E");
    // librosa reads 129.2; BandSync reads the half-time pulse. Both are offered to the band.
    expect(near(r.bpm!.value, 129.2, 0.05) || near(r.bpm!.value * 2, 129.2, 0.05)).toBe(true);
  });

  it("Sugar Plum Fairy: tempo agrees; the key is a known miss (dominant B instead of E minor)", () => {
    const r = analyzeAudio([decodeFixture("sugar-plum-fairy.ogg")], SR);
    expect(sameTempo(r, 107.7), JSON.stringify(r.bpm)).toBe(true);
    // Documented limitation: the piece dwells on B; the key estimate needs the band's review.
    expect(["Em", "B", "Bm"]).toContain(r.key!.key);
  });
});

describe("real audio with a known structure", () => {
  // Passages of three different real recordings, arranged A B A C A (18 s each): the right
  // boundaries (18, 36, 54, 72 s) and labels are known by construction.
  const A = decodeFixture("hungarian-dance-5.ogg", 2, 18);
  const B = decodeFixture("sugar-plum-fairy.ogg", 40, 18);
  const C = decodeFixture("vibe-ace.ogg", 9, 18);
  const r = prearrange([concat(A, B, A, C, A)], SR);
  const at = (t: number) => r.sections.find((s) => s.startSec <= t && s.endSec > t)!.label;

  it("finds at least 3 of the 4 boundaries within one bar (measured: 3 of 4)", () => {
    // Mixing recordings at different tempos forces one compromise beat grid; the 18 s change
    // (orchestra -> celesta, mid-bar) is the one currently missed.
    const starts = r.sections.slice(1).map((s) => s.startSec);
    const hits = [18, 36, 54, 72].filter(
      (t) => Math.min(...starts.map((s) => Math.abs(s - t))) <= r.barSeconds,
    );
    expect(hits.length, `found ${starts.map((s) => s.toFixed(1))}`).toBeGreaterThanOrEqual(3);
  });

  it("gives the returning passage the same letter and the new one another", () => {
    const labels = [45, 63, 81].map(at);
    expect(labels[0]).toBe(labels[2]);
    expect(labels[1]).not.toBe(labels[0]);
  });

  it("baseline inside one recording: at least half of the boundaries within one bar (to improve)", () => {
    // Two contrasting passages of Vibe Ace, X Y X Y X (20 s each). Measured: 2 of 4 within one
    // bar. This is the current limit for sections that share instruments and sound alike.
    const X = decodeFixture("vibe-ace.ogg", 9, 20);
    const Y = decodeFixture("vibe-ace.ogg", 30, 20);
    const one = prearrange([concat(X, Y, X, Y, X)], SR);
    const starts = one.sections.slice(1).map((s) => s.startSec);
    const hits = [20, 40, 60, 80].filter(
      (t) => Math.min(...starts.map((s) => Math.abs(s - t))) <= one.barSeconds,
    ).length;
    expect(hits).toBeGreaterThanOrEqual(2);
  });
});

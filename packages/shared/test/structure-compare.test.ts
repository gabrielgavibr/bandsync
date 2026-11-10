import { describe, expect, it } from "vitest";
import { toAnalysisRate } from "../src/analysis/analyze";
import { type PreArrangement, prearrangeMono, prearrangeMonoV1 } from "../src/analysis/prearrange";
import { CHORDS, synthSong } from "../src/analysis/synth";
import { concat, decodeFixture, SR } from "./real-audio";
import { row, type Score, score, type Truth } from "./structure-eval";

/**
 * The previous structure analysis (v1) against the current one (v2) on the same audio, with a
 * known answer. v2 has to find at least as many true boundaries, with fewer false ones, and
 * recognise repeated material at least as well.
 */
const { C, F, G, Am, Dm, E, Gm, Eb, Bb } = CHORDS;
const LOOP = [Gm, Gm, Dm, Dm, Eb, Eb, Bb, F];

interface Case {
  name: string;
  x: Float32Array;
  truth: Truth;
}

function fromSynth(name: string, song: ReturnType<typeof synthSong>): Case {
  const end = song.samples.length / song.sampleRate;
  return {
    name,
    x: toAnalysisRate(song.samples, song.sampleRate),
    truth: {
      starts: song.truth.map((t, i) => (i === 0 ? 0 : t.startSec)),
      end,
      labels: song.truth.map((t) => t.name),
    },
  };
}

/** One harmonic loop from start to end: only the arrangement changes (who plays, how loud). */
const loopSong = fromSynth(
  "one 8-bar loop, 14 times",
  synthSong({
    bpm: 132,
    beatsPerBar: 4,
    parts: [
      { name: "intro", bars: 8, chords: LOOP, energy: 0.25 },
      { name: "main", bars: 32, chords: LOOP, energy: 0.7, fillEvery: 8 },
      { name: "lead", bars: 8, chords: LOOP, energy: 0.7, lead: true },
      { name: "main", bars: 32, chords: LOOP, energy: 0.7, fillEvery: 8 },
      { name: "break", bars: 8, chords: LOOP, energy: 0.2 },
      { name: "main", bars: 24, chords: LOOP, energy: 0.7, fillEvery: 8 },
    ],
  }),
);

/** The same loop with nothing else changing: there is one section. */
const flatSong = fromSynth(
  "one loop, nothing changes",
  synthSong({
    bpm: 132,
    beatsPerBar: 4,
    parts: [{ name: "main", bars: 64, chords: LOOP, energy: 0.7, fillEvery: 8 }],
  }),
);

const popSong = fromSynth(
  "verse / chorus / bridge",
  synthSong({
    bpm: 96,
    beatsPerBar: 4,
    parts: [
      { name: "intro", bars: 4, chords: [Am, F], energy: 0.25 },
      { name: "verse", bars: 8, chords: [Am, F, C, G], energy: 0.5 },
      { name: "chorus", bars: 8, chords: [F, G, C, C], energy: 1, lead: true },
      { name: "verse", bars: 8, chords: [Am, F, C, G], energy: 0.5 },
      { name: "chorus", bars: 8, chords: [F, G, C, C], energy: 1, lead: true },
      { name: "bridge", bars: 8, chords: [Dm, E, Dm, E], energy: 0.7 },
      { name: "chorus", bars: 8, chords: [F, G, C, C], energy: 1, lead: true },
      { name: "outro", bars: 4, chords: [Am], energy: 0.2 },
    ],
  }),
);

function montage(name: string, parts: Float32Array[], labels: string[]): Case {
  const starts: number[] = [];
  let t = 0;
  for (const p of parts) {
    starts.push(t);
    t += p.length / SR;
  }
  return { name, x: toAnalysisRate(concat(...parts), SR), truth: { starts, end: t, labels } };
}
const A = decodeFixture("hungarian-dance-5.ogg", 2, 18);
const B = decodeFixture("sugar-plum-fairy.ogg", 40, 18);
const Cc = decodeFixture("vibe-ace.ogg", 9, 18);
const X = decodeFixture("vibe-ace.ogg", 9, 20);
const Y = decodeFixture("vibe-ace.ogg", 30, 20);
const realMontage = montage(
  "real: three recordings A B A C A",
  [A, B, A, Cc, A],
  ["A", "B", "A", "C", "A"],
);
const realInside = montage(
  "real: one recording X Y X Y X",
  [X, Y, X, Y, X],
  ["X", "Y", "X", "Y", "X"],
);

const cases = [loopSong, flatSong, popSong, realMontage, realInside];
const results = new Map<string, { v1: Score; v2: Score; r2: PreArrangement }>();
for (const c of cases) {
  const r1 = prearrangeMonoV1(c.x);
  const r2 = prearrangeMono(c.x);
  results.set(c.name, { v1: score(r1, c.truth), v2: score(r2, c.truth), r2 });
}

describe("structure analysis: v1 against v2 on audio with a known answer", () => {
  it("prints the comparison", () => {
    const lines: string[] = [];
    for (const [name, r] of results) lines.push(row(name, "v1", r.v1), row(name, "v2", r.v2));
    console.log(`\n${lines.join("\n")}\n`);
  });

  it("the first engine over-segments a song built on one loop (the diagnosed defect)", () => {
    const { v1 } = results.get(loopSong.name)!;
    expect(v1.sections).toBeGreaterThanOrEqual(2 * v1.truthSections);
    expect(results.get(flatSong.name)!.v1.sections).toBeGreaterThan(4);
  });

  it("v2 maps the loop song as its six parts, on the loop grid, and knows what returns", () => {
    const { v2, r2 } = results.get(loopSong.name)!;
    expect(r2.loopBars).toBe(8);
    expect(v2.hits).toBe(5);
    expect(v2.extra).toBe(0);
    expect(r2.sections.map((s) => s.bars)).toEqual([8, 32, 8, 32, 8, 24]);
    const l = r2.sections.map((s) => s.label);
    expect(l[1]).toBe(l[3]);
    expect(l[1]).toBe(l[5]);
    expect(new Set([l[0], l[1], l[2]]).size).toBe(3);
    // Drum fills every eight bars are not sections.
    expect(v2.labelF).toBeGreaterThanOrEqual(0.9);
  });

  it("v2 leaves a song where nothing changes as one section", () => {
    const { v2, r2 } = results.get(flatSong.name)!;
    expect(v2.sections).toBe(1);
    expect(r2.sections[0]!.kind).toBe("unknown");
  });

  it("v2 is at least as good as v1 on every case, and never trades true boundaries for fewer sections", () => {
    for (const [name, r] of results) {
      expect(r.v2.hits, name).toBeGreaterThanOrEqual(r.v1.hits);
      expect(r.v2.extra, name).toBeLessThanOrEqual(r.v1.extra);
      expect(r.v2.boundaryF, name).toBeGreaterThanOrEqual(r.v1.boundaryF - 1e-9);
      expect(r.v2.labelF, name).toBeGreaterThanOrEqual(r.v1.labelF - 0.02);
    }
  });
});
void E;
void Dm;

import { describe, expect, it } from "vitest";
import { estimatePitch } from "../src/lib/audio/pitch";
import {
  SENSITIVITY_PRESETS,
  TUNER_WINDOW,
  TunerEngine,
  type TunerFrame,
  thresholds,
} from "../src/lib/audio/tuner";

/**
 * The tuner on signals with a known answer. Notes are modelled as a plucked string: harmonics
 * that decay at different rates, slightly sharp upper partials, a noisy attack. Levels are in
 * dBFS, so "weak" here means what a phone hears from an instrument across a room.
 */
const SR = 48_000;
const HOP = 1920; // 40 ms between analyses, as in the app

let seed = 7;
const rnd = () => {
  seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
  return seed / 2 ** 32 - 0.5;
};
const fromDb = (db: number) => 10 ** (db / 20);

function noise(seconds: number, levelDb: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  // Uniform noise in ±0.5 has an RMS of 0.289.
  const g = fromDb(levelDb) / 0.289;
  for (let i = 0; i < out.length; i += 1) out[i] = rnd() * g;
  return out;
}

function pluck(
  freq: number,
  seconds: number,
  levelDb: number,
  o: { partials?: number[]; decay?: number } = {},
): Float32Array {
  const partials = o.partials ?? [1, 0.6, 0.35, 0.2, 0.12, 0.08];
  const decay = o.decay ?? 1.2;
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    let v = 0;
    partials.forEach((a, k) => {
      const n = k + 1;
      const f = freq * n * Math.sqrt(1 + 0.0002 * n * n); // stiff-string inharmonicity
      v += a * Math.exp(-t * decay * (1 + 0.4 * k)) * Math.sin(2 * Math.PI * f * t);
    });
    if (t < 0.012) v += rnd() * 2 * (1 - t / 0.012); // the pick
    out[i] = v;
  }
  // Scale so the first 200 ms have the level asked for.
  let s = 0;
  const m = Math.min(out.length, Math.round(0.2 * SR));
  for (let i = 0; i < m; i += 1) s += out[i]! ** 2;
  const g = fromDb(levelDb) / Math.sqrt(s / m);
  for (let i = 0; i < out.length; i += 1) out[i]! *= g;
  return out;
}

function mix(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(Math.max(...parts.map((p) => p.length)));
  for (const p of parts) for (let i = 0; i < p.length; i += 1) out[i]! += p[i]!;
  return out;
}
function seq(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Runs the engine over a signal the way the app does: the latest window every 40 ms. */
function run(signal: Float32Array, sensitivity: number, a4 = 440): TunerFrame[] {
  const engine = new TunerEngine({ sensitivity, a4 });
  const frames: TunerFrame[] = [];
  const buf = new Float32Array(TUNER_WINDOW);
  for (let end = HOP; end <= signal.length; end += HOP) {
    buf.fill(0);
    const start = Math.max(0, end - TUNER_WINDOW);
    buf.set(signal.subarray(start, end), TUNER_WINDOW - (end - start));
    frames.push(engine.process(buf, SR, (end / SR) * 1000));
  }
  return frames;
}
const notes = (frames: TunerFrame[]) =>
  frames.filter((f) => f.reading).map((f) => `${f.reading!.note}${f.reading!.octave}`);
const changes = (list: string[]) => list.filter((n, i) => i > 0 && n !== list[i - 1]).length;

const ROOM = -72; // a quiet room through a phone microphone
const settle = () => noise(1.5, ROOM);

describe("pitch estimate (YIN)", () => {
  it("is accurate to a couple of cents from the low B of a 5-string bass to high notes", () => {
    for (const f of [30.87, 41.2, 55, 82.41, 110, 146.83, 196, 246.94, 329.63, 440, 880, 1318.5]) {
      const x = pluck(f, 0.5, -20, { partials: [1, 0.5, 0.3], decay: 0.3 });
      const e = estimatePitch(x.subarray(2000, 2000 + TUNER_WINDOW), SR)!;
      expect(e, `${f} Hz`).not.toBeNull();
      expect(Math.abs(1200 * Math.log2(e.freq / f)), `${f} Hz read as ${e.freq}`).toBeLessThan(3);
      expect(e.clarity).toBeGreaterThan(0.9);
    }
  });

  it("does not depend on loudness: the same note 50 dB quieter reads the same", () => {
    const loud = estimatePitch(pluck(110, 0.4, -10, { decay: 0.2 }).subarray(1000, 9192), SR)!;
    const quiet = estimatePitch(pluck(110, 0.4, -60, { decay: 0.2 }).subarray(1000, 9192), SR)!;
    expect(Math.abs(loud.freq - quiet.freq)).toBeLessThan(0.05);
  });

  it("finds the fundamental when the second harmonic is stronger (a bass through a small mic)", () => {
    const x = pluck(41.2, 0.5, -20, { partials: [0.4, 1, 0.6, 0.3], decay: 0.3 });
    const e = estimatePitch(x.subarray(2000, 2000 + TUNER_WINDOW), SR)!;
    expect(Math.abs(1200 * Math.log2(e.freq / 41.2))).toBeLessThan(5);
  });

  it("gives noise a low clarity", () => {
    const e = estimatePitch(noise(0.3, -20).subarray(0, TUNER_WINDOW), SR);
    expect(e === null || e.clarity < 0.5).toBe(true);
  });
});

describe("tuner: weak, adequate and saturated input", () => {
  it("reads a weak note (-58 dBFS, well under the old fixed cut-off of -40) at normal sensitivity", () => {
    const frames = run(seq(settle(), mix(pluck(110, 2, -58), noise(2, ROOM))), 50);
    const n = notes(frames);
    expect(n.length).toBeGreaterThan(15);
    expect(new Set(n)).toEqual(new Set(["A2"]));
    const cents = frames.filter((f) => f.reading).map((f) => Math.abs(f.reading!.cents));
    expect(Math.max(...cents)).toBeLessThanOrEqual(4);
  });

  it("low sensitivity ignores that weak note and says the signal is weak; high sensitivity reads it", () => {
    const signal = seq(settle(), mix(pluck(110, 2, -58), noise(2, ROOM)));
    const low = run(signal, SENSITIVITY_PRESETS.low);
    expect(notes(low)).toEqual([]);
    expect(low.some((f) => f.state === "weak")).toBe(true);
    const high = run(signal, SENSITIVITY_PRESETS.high);
    expect(new Set(notes(high))).toEqual(new Set(["A2"]));
    // The control moves real thresholds.
    expect(thresholds(80).marginDb).toBeLessThan(thresholds(20).marginDb);
    expect(thresholds(80).floorDb).toBeLessThan(thresholds(20).floorDb);
    expect(thresholds(80).confirm).toBeGreaterThan(thresholds(20).confirm);
  });

  it("reads a note that is already sounding when the tuner is switched on", () => {
    const frames = run(mix(pluck(110, 2, -30, { decay: 0.3 }), noise(2, ROOM)), 50);
    expect(new Set(notes(frames))).toEqual(new Set(["A2"]));
    expect(frames.findIndex((f) => f.reading)).toBeLessThan(12);
  });

  it("reads an adequate signal and reports its level", () => {
    const frames = run(seq(settle(), mix(pluck(196, 1.5, -25), noise(1.5, ROOM))), 50);
    const withNote = frames.filter((f) => f.state === "note");
    expect(withNote.length).toBeGreaterThan(20);
    expect(new Set(notes(frames))).toEqual(new Set(["G3"]));
    expect(Math.max(...frames.map((f) => f.levelDb))).toBeGreaterThan(-30);
    expect(withNote.every((f) => f.levelDb >= f.gateDb - 12)).toBe(true);
  });

  it("flags a saturated input", () => {
    const hot = pluck(196, 1, 0, { decay: 0.2 });
    for (let i = 0; i < hot.length; i += 1) hot[i] = Math.max(-1, Math.min(1, hot[i]! * 6));
    const frames = run(seq(settle(), hot), 50);
    expect(frames.some((f) => f.state === "clipping")).toBe(true);
  });
});

describe("tuner: noise is not a note", () => {
  it("shows nothing for room noise alone, at any sensitivity, even when the room gets louder", () => {
    const room = seq(noise(2, ROOM), noise(2, -50), noise(2, -38));
    for (const s of [20, 50, 80, 100]) expect(notes(run(room, s)), `sensitivity ${s}`).toEqual([]);
  });

  it("tracks the room: a louder room raises the level a note must reach", () => {
    const quiet = run(noise(3, -72), 50);
    const loud = run(noise(3, -45), 50);
    expect(loud.at(-1)!.gateDb).toBeGreaterThan(quiet.at(-1)!.gateDb + 15);
    expect(loud.at(-1)!.noisyRoom || loud.at(-1)!.noiseDb > -50).toBe(true);
    expect(quiet.at(-1)!.noisyRoom).toBe(false);
  });

  it("still reads a note that stands 12 dB above a noisy room", () => {
    const frames = run(
      seq(noise(2, -50), mix(pluck(146.83, 2, -38, { decay: 0.6 }), noise(2, -50))),
      50,
    );
    expect(new Set(notes(frames))).toEqual(new Set(["D3"]));
  });

  it("a handclap or a knock does not flash a note", () => {
    const knock = new Float32Array(Math.round(0.03 * SR)).map(() => rnd() * 1.2);
    const frames = run(seq(settle(), knock, noise(1, ROOM), knock, noise(1, ROOM)), 80);
    expect(notes(frames)).toEqual([]);
  });
});

describe("tuner: low register and stability", () => {
  it("reads the open strings of a bass (E1 41 Hz, A1, D2, G2) and of a guitar", () => {
    const strings: [number, string][] = [
      [41.2, "E1"],
      [55, "A1"],
      [73.42, "D2"],
      [98, "G2"],
      [82.41, "E2"],
      [110, "A2"],
      [146.83, "D3"],
      [196, "G3"],
      [246.94, "B3"],
      [329.63, "E4"],
    ];
    for (const [f, name] of strings) {
      const frames = run(seq(settle(), mix(pluck(f, 2.5, -40), noise(2.5, ROOM))), 50);
      const n = notes(frames);
      expect(n.length, `${name}: frames with a note`).toBeGreaterThan(20);
      expect(new Set(n), name).toEqual(new Set([name]));
    }
  });

  it("holds one note steady while it rings out (no flicker between notes or octaves)", () => {
    // A bass note whose second harmonic dominates as it decays: the classic octave flip.
    const tone = pluck(55, 4, -35, { partials: [0.5, 1, 0.5, 0.3, 0.2], decay: 0.9 });
    const frames = run(seq(settle(), mix(tone, noise(4, ROOM))), 80);
    const n = notes(frames);
    expect(n.length).toBeGreaterThan(40);
    expect(changes(n)).toBe(0);
    expect(n[0]).toBe("A1");
  });

  it("follows a real change of note, once, and promptly", () => {
    const a = mix(pluck(110, 1.2, -35), noise(1.2, ROOM));
    const b = mix(pluck(123.47, 1.5, -35), noise(1.5, ROOM));
    const frames = run(seq(settle(), a, b), 50);
    const n = notes(frames);
    expect([...new Set(n)]).toEqual(["A2", "B2"]);
    expect(changes(n)).toBe(1);
    // B is shown within a quarter of a second of being played.
    const tB = (1.5 + 1.2) * 1000;
    const first = frames.findIndex((f) => f.reading?.note === "B");
    expect((first + 1) * 40 - tB).toBeLessThan(400);
  });

  it("keeps the reading through a short dip, then lets go when the note is gone", () => {
    const frames = run(
      seq(settle(), mix(pluck(196, 1, -35, { decay: 3 }), noise(1, ROOM)), noise(2, ROOM)),
      50,
    );
    const lastNote = frames.map((f) => !!f.reading).lastIndexOf(true);
    expect(lastNote).toBeGreaterThan(0);
    expect(frames.at(-1)!.reading).toBeNull();
    expect(frames.at(-1)!.state).toBe("listening");
  });

  it("uses the reference pitch: the same tone is in tune at A4 = 442 and flat at 446", () => {
    const tone = seq(settle(), mix(pluck(442, 1.5, -30, { decay: 0.4 }), noise(1.5, ROOM)));
    const at442 = run(tone, 50, 442).filter((f) => f.reading);
    const at446 = run(tone, 50, 446).filter((f) => f.reading);
    expect(Math.abs(at442.at(-1)!.reading!.cents)).toBeLessThanOrEqual(2);
    expect(at446.at(-1)!.reading!.cents).toBeLessThan(-10);
    expect(at442.at(-1)!.reading!.note).toBe("A");
  });
});

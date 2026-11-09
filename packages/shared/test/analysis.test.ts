import { describe, expect, it } from "vitest";
import { AnalysisError, analyzeAudio, keyName } from "../src/analysis/analyze";
import { CHORDS, encodeWav, synthTrack } from "../src/analysis/synth";

const { C, Dm, E, F, G, Am, D, Bm, A, Em, Fsm, B } = CHORDS;
const analyse = (o: Parameters<typeof synthTrack>[0]) => {
  const { samples, sampleRate } = synthTrack(o);
  return analyzeAudio([samples], sampleRate);
};
/** Right tempo, or the right one offered as the half/double alternative. */
const tempoFound = (r: ReturnType<typeof analyse>, bpm: number, tol = 1.5) =>
  Math.abs(r.bpm!.value - bpm) <= tol ||
  (r.bpm!.ambiguous && r.bpm!.candidates.some((c) => Math.abs(c.bpm - bpm) <= tol));

describe("tempo and beats (synthetic grooves with a known answer)", () => {
  for (const bpm of [72, 90, 100, 120, 140]) {
    it(`finds ${bpm} BPM in 4/4`, () => {
      const r = analyse({ bpm, beatsPerBar: 4, bars: 16, chords: [C, F, G, C] });
      expect(Math.abs(r.bpm!.value - bpm), JSON.stringify(r.bpm)).toBeLessThanOrEqual(0.3);
      // Beats line up with the groove: the interval between them is the beat period.
      const ibi = (r.beats.at(-1)! - r.beats[0]!) / (r.beats.length - 1);
      expect(Math.abs(60 / ibi - bpm)).toBeLessThan(1.5);
      expect(r.beats.length).toBeGreaterThan(16 * 4 * 0.85);
      expect(r.stability!.cv).toBeLessThan(0.03);
    });
  }

  it("says when half or double time is plausible (eighth-note hi-hats at 72 BPM)", () => {
    const r = analyse({ bpm: 72, beatsPerBar: 4, bars: 16, chords: [Am, F, C, G], hats: true });
    expect(tempoFound(r, 72, 0.5), JSON.stringify(r.bpm)).toBe(true);
    // Both readings are offered and the result says the choice is open.
    expect(r.bpm!.ambiguous).toBe(true);
    const other = r.bpm!.candidates.find(
      (c) => Math.abs(c.bpm - 144) < 2 || Math.abs(c.bpm - 72) < 2,
    );
    expect(other).toBeTruthy();
  });

  it("still finds the tempo through room noise, as a phone microphone would hear it", () => {
    const r = analyse({ bpm: 96, beatsPerBar: 4, bars: 12, chords: [D, Bm, G, A], noise: 0.15 });
    expect(tempoFound(r, 96, 0.5), JSON.stringify(r.bpm)).toBe(true);
  });

  it("reports an unsteady tempo as less stable", () => {
    const steady = analyse({ bpm: 100, beatsPerBar: 4, bars: 24, chords: [C, F, G, C] });
    expect(steady.stability!.cv).toBeLessThan(0.01);
    const drifting = analyse({
      bpm: 92,
      beatsPerBar: 4,
      bars: 24,
      chords: [C, F, G, C],
      drift: 16,
    });
    expect(drifting.stability!.cv).toBeGreaterThan(steady.stability!.cv);
  });
});

describe("meter", () => {
  it("hears the accent every 4 beats", () => {
    const r = analyse({ bpm: 110, beatsPerBar: 4, bars: 16, chords: [C, F, G, C] });
    expect(r.meter!.beatsPerBar).toBe(4);
  });

  it("hears the accent every 3 beats", () => {
    const r = analyse({ bpm: 120, beatsPerBar: 3, bars: 20, chords: [G, C, D, G] });
    expect(r.meter!.beatsPerBar).toBe(3);
  });
});

describe("key", () => {
  it("finds a major key (C – F – G – C)", () => {
    const r = analyse({ bpm: 100, beatsPerBar: 4, bars: 16, chords: [C, F, G, C] });
    expect(r.key!.key).toBe("C");
  });

  it("finds a minor key with its leading tone (Am – Dm – E – Am)", () => {
    const r = analyse({ bpm: 100, beatsPerBar: 4, bars: 16, chords: [Am, Dm, E, Am] });
    expect(r.key!.key).toBe("Am");
  });

  it("finds other keys (D, Em, F#m) and keeps the relative key among the candidates", () => {
    expect(analyse({ bpm: 90, beatsPerBar: 4, bars: 16, chords: [D, G, A, D] }).key!.key).toBe("D");
    expect(analyse({ bpm: 90, beatsPerBar: 4, bars: 16, chords: [Em, Am, B, Em] }).key!.key).toBe(
      "Em",
    );
    const fsm = analyse({ bpm: 90, beatsPerBar: 4, bars: 16, chords: [Fsm, Bm, Fsm, Bm] });
    expect(fsm.key!.key).toBe("F#m");
    // A progression that fits both C major and A minor: the other one is offered too.
    const ambiguous = analyse({ bpm: 90, beatsPerBar: 4, bars: 16, chords: [Am, F, C, G] });
    expect(["Am", "C"]).toContain(ambiguous.key!.key);
    expect(ambiguous.key!.candidates.map((c) => c.key)).toEqual(
      expect.arrayContaining(["Am", "C"]),
    );
  });

  it("spells keys the way musicians write them", () => {
    expect(keyName(10, "major")).toBe("Bb");
    expect(keyName(6, "minor")).toBe("F#m");
    expect(keyName(3, "minor")).toBe("Ebm");
    expect(keyName(1, "major")).toBe("Db");
  });
});

describe("refusing to guess", () => {
  it("needs at least 8 seconds", () => {
    const { samples, sampleRate } = synthTrack({ bpm: 100, beatsPerBar: 4, bars: 2, chords: [C] });
    expect(() => analyzeAudio([samples], sampleRate)).toThrowError(AnalysisError);
  });

  it("does not invent a tempo or key from silence", () => {
    const silence = new Float32Array(22_050 * 15);
    expect(() => analyzeAudio([silence], 22_050)).toThrowError("no_signal");
  });

  it("works at the usual device sample rates and with stereo input", () => {
    for (const sampleRate of [44_100, 48_000]) {
      const { samples } = synthTrack({
        bpm: 120,
        beatsPerBar: 4,
        bars: 12,
        chords: [C, F, G, C],
        sampleRate,
      });
      const r = analyzeAudio([samples, samples], sampleRate);
      expect(Math.abs(r.bpm!.value - 120)).toBeLessThanOrEqual(1);
      expect(r.key!.key).toBe("C");
    }
  });
});

describe("wav encoding", () => {
  it("writes a valid 16-bit mono header", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 8000);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint32(40, true)).toBe(8);
    expect(v.getInt16(46, true)).toBe(16383);
  });
});

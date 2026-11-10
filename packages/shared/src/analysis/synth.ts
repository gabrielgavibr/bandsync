/**
 * Test signals with a known answer: a drum pattern and chords synthesised at a given tempo, meter
 * and key. Used to check the analysis engine and to feed a fake microphone in browser tests.
 * No recording of any real song is involved.
 */

export interface SynthOptions {
  bpm: number;
  beatsPerBar: number;
  bars: number;
  /** One chord per bar, as MIDI note numbers (the first is played as the bass, an octave down). */
  chords: number[][];
  sampleRate?: number;
  /** Eighth-note hi-hats (they add a periodicity at twice the tempo, like many real grooves). */
  hats?: boolean;
  /** Amount of white noise, 0..1 (simulates a room heard through a phone microphone). */
  noise?: number;
  /** Changes the tempo smoothly by this many BPM over the track. */
  drift?: number;
  seed?: number;
}

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export function synthTrack(o: SynthOptions): { samples: Float32Array; sampleRate: number } {
  const sr = o.sampleRate ?? 22_050;
  const beats = o.bars * o.beatsPerBar;
  const beatTimes: number[] = [];
  let t = 0.25;
  for (let i = 0; i < beats; i += 1) {
    beatTimes.push(t);
    const bpm = o.bpm + ((o.drift ?? 0) * i) / beats;
    t += 60 / bpm;
  }
  const total = Math.ceil((t + 1) * sr);
  const x = new Float32Array(total);
  let seed = o.seed ?? 7;
  const rnd = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 2 ** 32 - 0.5;
  };
  const add = (start: number, dur: number, fn: (u: number) => number) => {
    const a = Math.floor(start * sr);
    const n = Math.floor(dur * sr);
    for (let i = 0; i < n && a + i < total; i += 1) x[a + i]! += fn(i / sr);
  };
  beatTimes.forEach((bt, i) => {
    const downbeat = i % o.beatsPerBar === 0;
    // Kick: a pitched-down sine, louder on the first beat of the bar.
    const amp = downbeat ? 0.9 : 0.4;
    add(bt, 0.18, (u) => amp * Math.sin(2 * Math.PI * (110 - 200 * u) * u) * Math.exp(-u * 25));
    if (o.hats) {
      const step = i + 1 < beatTimes.length ? beatTimes[i + 1]! - bt : 60 / o.bpm;
      for (const off of [0, step / 2])
        add(bt + off, 0.04, (u) => 0.12 * rnd() * Math.exp(-u * 120));
    }
  });
  // Chords: sustained for each bar, with the root an octave lower as a bass note.
  for (let bar = 0; bar < o.bars; bar += 1) {
    const chord = o.chords[bar % o.chords.length]!;
    const start = beatTimes[bar * o.beatsPerBar]!;
    const end = beatTimes[(bar + 1) * o.beatsPerBar] ?? t;
    const dur = end - start;
    const notes = [chord[0]! - 12, ...chord];
    add(start, dur, (u) => {
      const env = Math.min(1, u / 0.02) * Math.min(1, (dur - u) / 0.05);
      let s = 0;
      for (const m of notes) {
        const f = midiHz(m);
        s += Math.sin(2 * Math.PI * f * u) + 0.3 * Math.sin(4 * Math.PI * f * u);
      }
      return (0.08 * env * s) / notes.length;
    });
  }
  if (o.noise) for (let i = 0; i < total; i += 1) x[i]! += o.noise * rnd();
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.95) for (let i = 0; i < total; i += 1) x[i] = (x[i]! / peak) * 0.95;
  return { samples: x, sampleRate: sr };
}

/** 16-bit PCM mono WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const data = samples.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i += 1)
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i]!)) * 0x7fff, true);
  return new Uint8Array(buf);
}

/** Chords (MIDI, octave 4) used by the tests. */
export const CHORDS = {
  C: [60, 64, 67],
  Dm: [62, 65, 69],
  E: [64, 68, 71],
  F: [65, 69, 72],
  G: [67, 71, 74],
  Am: [57, 60, 64],
  D: [62, 66, 69],
  Bm: [59, 62, 66],
  A: [57, 61, 64],
  Em: [64, 67, 71],
  Fsm: [66, 69, 73],
  B: [59, 63, 66],
};

export interface SynthPart {
  name: string;
  bars: number;
  /** One chord per bar, cycled. */
  chords: number[][];
  /** 0..1: how full the band is (kick level, hats, pad level). */
  energy: number;
  /** Adds an arpeggiated lead line (a different timbre). */
  lead?: boolean;
}

/** A song with known sections: returns the audio and where each section really starts. */
export function synthSong(o: {
  bpm: number;
  beatsPerBar: number;
  parts: SynthPart[];
  sampleRate?: number;
  seed?: number;
}): {
  samples: Float32Array;
  sampleRate: number;
  truth: { name: string; startSec: number; startBar: number; bars: number }[];
} {
  const sr = o.sampleRate ?? 22_050;
  const beat = 60 / o.bpm;
  const lead = 0.25;
  const totalBars = o.parts.reduce((a, p) => a + p.bars, 0);
  const total = Math.ceil((lead + totalBars * o.beatsPerBar * beat + 1) * sr);
  const x = new Float32Array(total);
  let seed = o.seed ?? 11;
  const rnd = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 2 ** 32 - 0.5;
  };
  const add = (start: number, dur: number, fn: (u: number) => number) => {
    const a = Math.floor(start * sr);
    const n = Math.floor(dur * sr);
    for (let i = 0; i < n && a + i < total; i += 1) x[a + i]! += fn(i / sr);
  };
  const truth: { name: string; startSec: number; startBar: number; bars: number }[] = [];
  let bar = 0;
  for (const part of o.parts) {
    truth.push({
      name: part.name,
      startSec: lead + bar * o.beatsPerBar * beat,
      startBar: bar,
      bars: part.bars,
    });
    for (let b = 0; b < part.bars; b += 1, bar += 1) {
      const t0 = lead + bar * o.beatsPerBar * beat;
      const chord = part.chords[b % part.chords.length]!;
      for (let k = 0; k < o.beatsPerBar; k += 1) {
        const bt = t0 + k * beat;
        const amp = (k === 0 ? 0.9 : 0.4) * (0.35 + 0.65 * part.energy);
        add(bt, 0.18, (u) => amp * Math.sin(2 * Math.PI * (110 - 200 * u) * u) * Math.exp(-u * 25));
        if (part.energy > 0.5)
          for (const off of [0, beat / 2])
            add(bt + off, 0.04, (u) => 0.1 * part.energy * rnd() * Math.exp(-u * 120));
      }
      const dur = o.beatsPerBar * beat;
      const notes = [chord[0]! - 12, ...chord];
      const pad = 0.05 + 0.07 * part.energy;
      add(t0, dur, (u) => {
        const env = Math.min(1, u / 0.02) * Math.min(1, (dur - u) / 0.05);
        let s = 0;
        for (const m of notes) {
          const f = midiHz(m);
          s += Math.sin(2 * Math.PI * f * u) + 0.3 * Math.sin(4 * Math.PI * f * u);
        }
        return (pad * env * s) / notes.length;
      });
      if (part.lead) {
        // Eighth-note arpeggio an octave up, with a brighter (square-ish) tone.
        for (let k = 0; k < o.beatsPerBar * 2; k += 1) {
          const m = chord[k % chord.length]! + 12;
          const f = midiHz(m);
          add(t0 + (k * beat) / 2, beat / 2, (u) => {
            const env = Math.exp(-u * 6);
            return (
              0.05 *
              env *
              (Math.sin(2 * Math.PI * f * u) +
                0.4 * Math.sin(6 * Math.PI * f * u) +
                0.2 * Math.sin(10 * Math.PI * f * u))
            );
          });
        }
      }
    }
  }
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.95) for (let i = 0; i < total; i += 1) x[i] = (x[i]! / peak) * 0.95;
  return { samples: x, sampleRate: sr, truth };
}

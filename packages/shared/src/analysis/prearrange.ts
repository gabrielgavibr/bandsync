/**
 * "Pré-arranjo da gravação": a first musical map of a whole recording, computed from audio the
 * band may process. Builds on the tempo/beat analysis (analyze.ts) and adds:
 *  - chords per beat by template matching on beat-synchronous chroma, smoothed with a Viterbi pass
 *    (major/minor triads only; sevenths, inversions and extensions are not distinguished);
 *  - bar lines, by finding where in each group of beats the low-frequency accents and the chord
 *    changes fall;
 *  - section boundaries from a bar-level self-similarity matrix (harmony + timbre) with a
 *    checkerboard novelty kernel (Foote 2000) plus loudness changes;
 *  - repetition labels (A, B, C…) by comparing sections along the matrix diagonals;
 *  - a functional guess (intro, verse, chorus, bridge, outro) from repetition, position and
 *    loudness, only when the evidence points one way; otherwise the letter stays;
 *  - cues: stops, entries and drops of the band, from loudness and timbre changes.
 *
 * Every value is an estimate. Nothing here has been calibrated on annotated real recordings of the
 * band's repertoire, so the result is a draft to review, never a transcription.
 */

import {
  ANALYSIS_ENGINE,
  ANALYSIS_SAMPLE_RATE,
  type AnalysisReport,
  analyzeCore,
  frameToSeconds,
  keyName,
  mixDown,
  toAnalysisRate,
} from "./analyze";
import { type Structure, segmentBars } from "./structure";
import {
  type BarAnalysis,
  cosine,
  mean,
  median,
  norm,
  type PreCue,
  type SectionKindGuess,
  type StructureSegment,
  std,
} from "./structure-common";
import { segmentV1 } from "./structure-v1";

export const PREARRANGE_VERSION = "prearrange-v2";

export interface PreSection {
  /** Repetition label: sections with the same letter sound alike. */
  label: string;
  kind: SectionKindGuess;
  /** How much the functional name can be trusted (never "high": nothing is calibrated). */
  kindConfidence: "medium" | "low";
  startSec: number;
  endSec: number;
  /** First bar of the section, counted over the whole recording (0-based). */
  startBar: number;
  bars: number;
  /** One chord per bar ("N" = no clear chord). */
  chords: string[];
  /** Loudness relative to the recording's median, in dB. */
  loudnessDb: number;
  cues: PreCue[];
}

export interface PreArrangement {
  engine: typeof ANALYSIS_ENGINE;
  version: string;
  analysedSeconds: number;
  report: AnalysisReport;
  beatsPerBar: number;
  /** Where the first full bar starts. */
  firstDownbeatSec: number;
  barSeconds: number;
  bars: number;
  sections: PreSection[];
  chordsByBar: string[];
  /** Length in bars of the harmonic loop the recording is built on, when it has one. */
  loopBars?: number | null;
}

export class PrearrangeError extends Error {
  constructor(readonly code: "no_pulse" | "too_short") {
    super(code);
  }
}

/* ------------------------------------------------------------------ */
/* Chords                                                              */
/* ------------------------------------------------------------------ */

interface ChordTemplate {
  name: string;
  root: number;
  minor: boolean;
  vec: number[];
}

function chordTemplates(flats: boolean): ChordTemplate[] {
  const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  const names = flats ? FLAT : SHARP;
  const out: ChordTemplate[] = [];
  for (let root = 0; root < 12; root += 1) {
    for (const minor of [false, true]) {
      const vec = new Array<number>(12).fill(0);
      vec[root] = 1;
      vec[(root + (minor ? 3 : 4)) % 12] = 0.8;
      vec[(root + 7) % 12] = 0.9;
      out.push({ name: `${names[root]}${minor ? "m" : ""}`, root, minor, vec });
    }
  }
  return out;
}

/** Most likely chord per beat, smoothed so that chords do not flicker beat by beat. */
function trackChords(beatChroma: number[][], loud: number[], templates: ChordTemplate[]): string[] {
  const n = beatChroma.length;
  const S = templates.length + 1; // last state = no chord
  const quiet = median(loud) - 18;
  const emit = beatChroma.map((c, i) => {
    const e = new Array<number>(S);
    const silent = loud[i]! < quiet || norm(c) === 0;
    for (let s = 0; s < templates.length; s += 1)
      e[s] = silent ? -6 : 8 * cosine(c, templates[s]!.vec);
    e[S - 1] = silent ? 0 : 8 * 0.55; // "N" wins only when nothing fits
    return e;
  });
  const stay = Math.log(0.88);
  const move = Math.log(0.12 / (S - 1));
  let prev = emit[0]!.slice();
  const back: Int16Array[] = [];
  for (let t = 1; t < n; t += 1) {
    const cur = new Array<number>(S);
    const bp = new Int16Array(S);
    let bestPrev = 0;
    for (let s = 1; s < S; s += 1) if (prev[s]! > prev[bestPrev]!) bestPrev = s;
    for (let s = 0; s < S; s += 1) {
      const a = prev[s]! + stay;
      const b = prev[bestPrev]! + move;
      if (a >= b) {
        cur[s] = a + emit[t]![s]!;
        bp[s] = s;
      } else {
        cur[s] = b + emit[t]![s]!;
        bp[s] = bestPrev;
      }
    }
    back.push(bp);
    prev = cur;
  }
  let state = 0;
  for (let s = 1; s < S; s += 1) if (prev[s]! > prev[state]!) state = s;
  const path = new Array<number>(n);
  path[n - 1] = state;
  for (let t = n - 1; t > 0; t -= 1) {
    state = back[t - 1]![state]!;
    path[t - 1] = state;
  }
  return path.map((s) => (s === S - 1 ? "N" : templates[s]!.name));
}

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */

/** Beats, bars, harmony, timbre and loudness of a recording at the analysis rate. */
export function analyseBars(x: Float32Array): BarAnalysis {
  const core = analyzeCore(x);
  const { report, features: f, low, beatFrames } = core;
  if (!report.bpm || beatFrames.length < 16) throw new PrearrangeError("no_pulse");
  const seconds = x.length / ANALYSIS_SAMPLE_RATE;
  const flats = report.key
    ? ["F", "Bb", "Eb", "Ab", "Db", "Gb", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"].includes(
        report.key.key,
      )
    : false;

  // 1. Beat-synchronous features.
  const nb = beatFrames.length;
  const period = Math.round(median(beatFrames.slice(1).map((b, i) => b - beatFrames[i]!)));
  const beatChroma: number[][] = [];
  const beatBands: number[][] = [];
  const beatLoud: number[] = [];
  const beatAccent: number[] = [];
  for (let i = 0; i < nb; i += 1) {
    const a = beatFrames[i]!;
    const b = Math.min(f.frames, i + 1 < nb ? beatFrames[i + 1]! : a + period);
    const c = new Array<number>(12).fill(0);
    const t = new Array<number>(12).fill(0);
    let e = 0;
    // Harmony is read after the attack of the beat: drum hits have a pitch of their own.
    const settle = a + Math.floor((b - a) / 4);
    for (let fr = a; fr < b; fr += 1) {
      for (let p = 0; p < 12; p += 1) {
        if (fr >= settle) c[p]! += f.chroma[fr * 12 + p]!;
        t[p]! += f.bands[fr * 12 + p]!;
      }
      e += f.energy[fr]!;
    }
    const len = Math.max(1, b - a);
    const cn = norm(c) || 1;
    beatChroma.push(c.map((v) => v / cn));
    beatBands.push(t.map((v) => v / len));
    beatLoud.push(10 * Math.log10(1e-12 + e / len));
    let acc = 0;
    for (let d = -2; d <= 2; d += 1) acc = Math.max(acc, low[a + d] ?? 0);
    beatAccent.push(acc);
  }

  // 2. Chords per beat.
  const templates = chordTemplates(flats);
  const beatChords = trackChords(beatChroma, beatLoud, templates);

  // 3. Meter and bar lines: where low accents and harmonic changes fall, in groups of 3 or 4.
  const change = beatChroma.map((c, i) => (i === 0 ? 0 : 1 - cosine(beatChroma[i - 1]!, c)));
  const chordMoves = beatChords.map((c, i) => (i > 0 && c !== beatChords[i - 1] ? 1 : 0));
  const accentMax = Math.max(...beatAccent, 1e-9);
  const strength = beatAccent.map((a, i) => a / accentMax + 2 * change[i]! + chordMoves[i]!);
  const phaseContrast = (m: number) => {
    let best = { phase: 0, contrast: Number.NEGATIVE_INFINITY };
    for (let ph = 0; ph < m; ph += 1) {
      const on: number[] = [];
      const off: number[] = [];
      strength.forEach((v, i) => {
        ((i - ph) % m === 0 ? on : off).push(v);
      });
      const c = mean(on) - mean(off);
      if (c > best.contrast) best = { phase: ph, contrast: c };
    }
    return best;
  };
  const three = phaseContrast(3);
  const four = phaseContrast(4);
  // Harmony that changes every 3 beats is strong evidence of 3/4 even when the drums are even.
  const beatsPerBar = three.contrast > four.contrast * 1.15 ? 3 : 4;
  const phase = beatsPerBar === 3 ? three.phase : four.phase;
  if (report.meter) report.meter = { ...report.meter, beatsPerBar };
  const barStartBeats: number[] = [];
  for (let i = phase; i + beatsPerBar <= nb; i += beatsPerBar) barStartBeats.push(i);
  const nBars = barStartBeats.length;
  if (nBars < 4) throw new PrearrangeError("too_short");
  const barSec = frameToSeconds(beatFrames[beatsPerBar]!) - frameToSeconds(beatFrames[0]!) || 1;

  // 4. Bar features and chords.
  const barChroma: number[][] = [];
  const barBands: number[][] = [];
  const barLoud: number[] = [];
  const chordsByBar: string[] = [];
  const quietBar = median(beatLoud) - 18;
  for (const s of barStartBeats) {
    const c = new Array<number>(12).fill(0);
    const t = new Array<number>(12).fill(0);
    const l: number[] = [];
    for (let k = 0; k < beatsPerBar; k += 1) {
      const i = s + k;
      for (let p = 0; p < 12; p += 1) {
        c[p]! += beatChroma[i]![p]!;
        t[p]! += beatBands[i]![p]! / beatsPerBar;
      }
      l.push(beatLoud[i]!);
    }
    const cn = norm(c) || 1;
    const bc = c.map((v) => v / cn);
    barChroma.push(bc);
    barBands.push(t);
    barLoud.push(mean(l));
    // The bar's chord: the triad that best fits the whole bar's harmony (after the attacks).
    let best = "N";
    let bestFit = 0.6;
    if (mean(l) > quietBar)
      for (const tpl of templates) {
        const fit = cosine(bc, tpl.vec);
        if (fit > bestFit) {
          bestFit = fit;
          best = tpl.name;
        }
      }
    chordsByBar.push(best);
  }
  // Timbre: z-score each band across the recording, so the comparison is about changes in it.
  const bandMean = new Array<number>(12).fill(0).map((_, k) => mean(barBands.map((b) => b[k]!)));
  const bandStd = new Array<number>(12).fill(0).map((_, k) => std(barBands.map((b) => b[k]!)) || 1);
  const barTimbre = barBands.map((b) => b.map((v, k) => (v - bandMean[k]!) / bandStd[k]!));
  const loudMedian = median(barLoud);
  const barStartSec = barStartBeats.map((b) => frameToSeconds(beatFrames[b]!));
  return {
    report,
    seconds,
    beatsPerBar,
    nBars,
    barSec,
    barStartSec,
    barChroma,
    barTimbre,
    barLoud,
    loudMedian,
    chordsByBar,
    flats,
  };
}

/** Turns bar-level segments into the pre-arrangement (seconds, chords, loudness). */
function assemble(bars: BarAnalysis, segs: StructureSegment[], version: string): PreArrangement {
  const letter = (l: number) => String.fromCharCode(65 + (l % 26));
  const sections: PreSection[] = segs.map((seg, i) => {
    const next = segs[i + 1];
    const startSec = i === 0 ? 0 : bars.barStartSec[seg.start]!;
    const endSec = next ? bars.barStartSec[next.start]! : bars.seconds;
    const loud = mean(bars.barLoud.slice(seg.start, seg.start + seg.len)) - bars.loudMedian;
    return {
      label: letter(seg.label),
      kind: seg.kind,
      kindConfidence: seg.conf,
      startSec: Math.round(startSec * 100) / 100,
      endSec: Math.round(endSec * 100) / 100,
      startBar: seg.start,
      bars: seg.len,
      chords: bars.chordsByBar.slice(seg.start, seg.start + seg.len),
      loudnessDb: Math.round(loud * 10) / 10,
      cues: seg.cues,
    };
  });
  return {
    engine: ANALYSIS_ENGINE,
    version,
    analysedSeconds: Math.round(bars.seconds * 10) / 10,
    report: bars.report,
    beatsPerBar: bars.beatsPerBar,
    firstDownbeatSec: Math.round(bars.barStartSec[0]! * 1000) / 1000,
    barSeconds: Math.round(bars.barSec * 1000) / 1000,
    bars: bars.nBars,
    sections,
    chordsByBar: bars.chordsByBar,
  };
}

/**
 * Chords of loop-based music, read from every time the loop comes round: within sections that
 * hold the same material, the bars at the same place in the loop are pooled, so one unclear bar
 * (a fill, a vocal line over a thin accompaniment) does not hide a chord the loop plays every
 * time. A bar keeps its own reading when it clearly disagrees with the pooled one.
 */
function pooledChords(bars: BarAnalysis, structure: Structure): string[] {
  const loop = structure.loopBars;
  if (!loop) return bars.chordsByBar;
  const templates = chordTemplates(bars.flats);
  const fitOf = (c: ArrayLike<number>, name: string) => {
    const t = templates.find((x) => x.name === name);
    return t ? cosine(c, t.vec) : 0;
  };
  const best = (c: number[]) => {
    let name = "N";
    let fit = 0.6;
    for (const t of templates) {
      const f = cosine(c, t.vec);
      if (f > fit) {
        fit = f;
        name = t.name;
      }
    }
    return { name, fit };
  };
  const out = bars.chordsByBar.slice();
  const quiet = bars.loudMedian - 18;
  const phaseOf = (i: number) => (((i - structure.loopPhase) % loop) + loop) % loop;
  const pool = (members: number[]) => {
    const sums = Array.from({ length: loop }, () => new Array<number>(12).fill(0));
    const counts = new Array<number>(loop).fill(0);
    for (const i of members) {
      const p = phaseOf(i);
      for (let k = 0; k < 12; k += 1) sums[p]![k]! += bars.barChroma[i]![k]!;
      counts[p]! += 1;
    }
    return sums.map((c, p) => (counts[p]! >= 2 ? best(c) : null));
  };
  const audible = (i: number) => bars.barLoud[i]! > quiet;
  // The loop as the whole recording plays it: used where a section's own reading is unclear.
  const everywhere = pool(Array.from({ length: bars.nBars }, (_, i) => i).filter(audible));
  for (const label of new Set(structure.segments.map((s) => s.label))) {
    const members: number[] = [];
    for (const seg of structure.segments.filter((s) => s.label === label))
      for (let i = seg.start; i < seg.start + seg.len; i += 1) if (audible(i)) members.push(i);
    const pooled = pool(members);
    for (const i of members) {
      const p = phaseOf(i);
      const inSection = pooled[p];
      const shared = inSection && inSection.name !== "N" ? inSection : everywhere[p];
      if (!shared || shared.name === "N") continue;
      const own = best(bars.barChroma[i]!);
      const sharedHere = fitOf(bars.barChroma[i]!, shared.name);
      // The bar's own chord stands only when it is clear and the loop's chord really does not fit.
      if (own.name !== "N" && own.name !== shared.name && own.fit - sharedHere >= 0.12) continue;
      out[i] = shared.name;
    }
  }
  return out;
}

export function prearrangeMono(x: Float32Array): PreArrangement {
  const bars = analyseBars(x);
  const structure = segmentBars(bars);
  const chords = pooledChords(bars, structure);
  return {
    ...assemble({ ...bars, chordsByBar: chords }, structure.segments, PREARRANGE_VERSION),
    loopBars: structure.loopBars,
  };
}

/** The previous engine's result for the same audio, for comparisons. */
export function prearrangeMonoV1(x: Float32Array): PreArrangement {
  const bars = analyseBars(x);
  return assemble(bars, segmentV1(bars), "prearrange-v1");
}

/** Pre-arrangement of audio at any sample rate (one or more channels). */
export function prearrange(channels: Float32Array[], sampleRate: number): PreArrangement {
  return prearrangeMono(toAnalysisRate(mixDown(channels), sampleRate));
}

/** Chord changes of a section, without repeats: "Am F C G". */
export function progression(chords: string[]): string[] {
  return chords.filter((c, i) => c !== "N" && c !== chords[i - 1]);
}

export {
  type BarAnalysis,
  type PreCue,
  SECTION_KINDS_GUESS,
  type SectionKindGuess,
  type StructureSegment,
} from "./structure-common";
export { keyName };

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

export const PREARRANGE_VERSION = "prearrange-v1";

export const SECTION_KINDS_GUESS = [
  "intro",
  "verse",
  "chorus",
  "bridge",
  "outro",
  "unknown",
] as const;
export type SectionKindGuess = (typeof SECTION_KINDS_GUESS)[number];

export interface PreCue {
  /** Bar index inside the section (0-based). */
  bar: number;
  type: "stop" | "entry" | "drop" | "texture";
}

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
  version: typeof PREARRANGE_VERSION;
  analysedSeconds: number;
  report: AnalysisReport;
  beatsPerBar: number;
  /** Where the first full bar starts. */
  firstDownbeatSec: number;
  barSeconds: number;
  bars: number;
  sections: PreSection[];
  chordsByBar: string[];
}

export class PrearrangeError extends Error {
  constructor(readonly code: "no_pulse" | "too_short") {
    super(code);
  }
}

/* ------------------------------------------------------------------ */
/* Small vector helpers                                                */
/* ------------------------------------------------------------------ */

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i]! * b[i]!;
  return s;
};
const norm = (a: ArrayLike<number>) => Math.sqrt(dot(a, a));
const cosine = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  const d = norm(a) * norm(b);
  return d > 0 ? dot(a, b) / d : 0;
};
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const median = (v: number[]) => {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const std = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
};

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

/** Checkerboard novelty along the diagonal of a self-similarity matrix. */
function novelty(S: number[][], half: number): number[] {
  const n = S.length;
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let v = 0;
    let w = 0;
    for (let a = -half; a < half; a += 1) {
      for (let b = -half; b < half; b += 1) {
        const x = i + a;
        const y = i + b;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const sign = a < 0 === b < 0 ? 1 : -1;
        const g = Math.exp(-((a + 0.5) ** 2 + (b + 0.5) ** 2) / (2 * (half / 2) ** 2));
        v += sign * g * S[x]![y]!;
        w += g;
      }
    }
    out[i] = w ? Math.max(0, v / w) : 0;
  }
  return out;
}

/** Mean similarity of two sections aligned bar by bar (best of a few alignments). */
function sectionSimilarity(S: number[][], a0: number, la: number, b0: number, lb: number): number {
  const len = Math.min(la, lb);
  if (len === 0) return 0;
  let best = 0;
  for (const [sa, sb] of [
    [0, 0],
    [la - len, lb - len],
  ] as const) {
    let s = 0;
    for (let k = 0; k < len; k += 1) s += S[a0 + sa + k]![b0 + sb + k]!;
    best = Math.max(best, s / len);
  }
  return best;
}

/* ------------------------------------------------------------------ */

export function prearrangeMono(x: Float32Array): PreArrangement {
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
      strength.forEach((v, i) => ((i - ph) % m === 0 ? on : off).push(v));
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

  // 5. Self-similarity of bars (harmony + timbre + loudness), enhanced along the diagonals.
  const raw: number[][] = [];
  for (let i = 0; i < nBars; i += 1) {
    const row: number[] = [];
    for (let j = 0; j < nBars; j += 1) {
      const sc = cosine(barChroma[i]!, barChroma[j]!);
      const st = (cosine(barTimbre[i]!, barTimbre[j]!) + 1) / 2;
      const sl = Math.exp(-Math.abs(barLoud[i]! - barLoud[j]!) / 6);
      row.push(0.55 * sc + 0.3 * st + 0.15 * sl);
    }
    raw.push(row);
  }
  const S: number[][] = raw.map((row, i) =>
    row.map((_, j) => {
      let s = 0;
      let c = 0;
      for (let k = -1; k <= 1; k += 1) {
        const a = i + k;
        const b = j + k;
        if (a < 0 || b < 0 || a >= nBars || b >= nBars) continue;
        s += raw[a]![b]!;
        c += 1;
      }
      return s / c;
    }),
  );

  // 6. Boundaries: novelty peaks, at least 4 bars apart, preferring even bars.
  // Measured on real recordings: windows sized in seconds over-segment; four bars works better.
  const kernelHalf = 4;
  const minGap = 4;
  const nov = novelty(raw, kernelHalf);
  // A change of level that lasts: the mean of the next 4 bars against the previous 4.
  const step = barLoud.map((_, i) => {
    if (i === 0) return 0;
    const before = barLoud.slice(Math.max(0, i - kernelHalf), i);
    const after = barLoud.slice(i, Math.min(nBars, i + kernelHalf));
    return Math.abs(mean(after) - mean(before));
  });
  // The kernel sees "change" at the very edges of the recording; leave them out of the scale.
  const maxNov = Math.max(...nov.slice(2, Math.max(3, nBars - 2)), 1e-9);
  // A level change of 3 dB that lasts is, on its own, as strong a sign as the clearest novelty.
  const score = nov.map((v, i) => v / maxNov + Math.min(1, step[i]! / 3));
  // Sections usually start on even bars (phrases of 2, 4, 8 bars).
  const prior = score.map((v, i) => v * (i % 2 === 0 ? 1 : 0.85));
  // A boundary is a local peak at least 40 % as strong as the strongest one: wide, clear
  // changes and quieter ones (an intro that only differs in level) both count.
  const interior = prior.slice(2, Math.max(3, nBars - 2));
  const thr = 0.4 * Math.max(...interior, 1e-9);
  const candidates: number[] = [];
  const reach = 2;
  for (let i = 2; i < nBars - 2; i += 1) {
    let peak = true;
    for (let d = -reach; d <= reach; d += 1)
      if (d !== 0 && (prior[i + d] ?? 0) > prior[i]!) peak = false;
    if (peak && prior[i]! > thr) candidates.push(i);
  }
  candidates.sort((a, b) => prior[b]! - prior[a]!);
  const maxSections = Math.max(2, Math.ceil(nBars / minGap));
  const bounds: number[] = [];
  for (const c of candidates) {
    if (bounds.length >= maxSections - 1) break;
    if (bounds.every((b) => Math.abs(b - c) >= minGap)) bounds.push(c);
  }
  bounds.sort((a, b) => a - b);
  const starts = [0, ...bounds];
  const segs = starts.map((s, i) => ({ start: s, len: (starts[i + 1] ?? nBars) - s }));

  // 7. Repetition labels: sections that sound alike share a letter.
  const offDiag: number[] = [];
  for (let i = 0; i < nBars; i += 1) for (let j = i + 3; j < nBars; j += 1) offDiag.push(S[i]![j]!);
  offDiag.sort((a, b) => a - b);
  // "Sounds alike": clearly above what unrelated bars of this recording score.
  const p90 = offDiag[Math.floor(offDiag.length * 0.9)] ?? 0.9;
  const sameThreshold = Math.max(p90, 0.88);
  const labelOf: number[] = new Array(segs.length).fill(-1);
  const reps: number[] = [];
  segs.forEach((seg, i) => {
    let best = -1;
    let bestSim = 0;
    reps.forEach((r, label) => {
      const sim = sectionSimilarity(S, segs[r]!.start, segs[r]!.len, seg.start, seg.len);
      if (sim > bestSim) {
        bestSim = sim;
        best = label;
      }
    });
    if (best >= 0 && bestSim >= sameThreshold) labelOf[i] = best;
    else {
      labelOf[i] = reps.length;
      reps.push(i);
    }
  });
  const letter = (l: number) => String.fromCharCode(65 + (l % 26));

  // 8. Functional guess from repetition, position and loudness.
  const segLoud = segs.map((s) => mean(barLoud.slice(s.start, s.start + s.len)) - loudMedian);
  const count = (l: number) => labelOf.filter((x) => x === l).length;
  const labels = [...new Set(labelOf)];
  const repeated = labels.filter((l) => count(l) >= 2);
  const loudOfLabel = (l: number) =>
    mean(
      segs
        .map((_, i) => i)
        .filter((i) => labelOf[i] === l)
        .map((i) => segLoud[i]!),
    );
  const kinds: { kind: SectionKindGuess; conf: "medium" | "low" }[] = segs.map(() => ({
    kind: "unknown",
    conf: "low",
  }));
  let chorus = -1;
  if (repeated.length >= 1) {
    const byLoud = [...repeated].sort((a, b) => loudOfLabel(b) - loudOfLabel(a));
    chorus = byLoud[0]!;
    const margin = byLoud.length > 1 ? loudOfLabel(byLoud[0]!) - loudOfLabel(byLoud[1]!) : 0;
    const conf: "medium" | "low" = byLoud.length > 1 && margin >= 1 ? "medium" : "low";
    labelOf.forEach((l, i) => {
      if (l === chorus) kinds[i] = { kind: "chorus", conf };
    });
    const firstChorus = labelOf.indexOf(chorus);
    for (const l of byLoud.slice(1)) {
      const first = labelOf.indexOf(l);
      if (first < firstChorus || firstChorus <= 0) {
        labelOf.forEach((x, i) => {
          if (x === l) kinds[i] = { kind: "verse", conf };
        });
        break;
      }
    }
  }
  const last = segs.length - 1;
  // Intro, outro and bridge only make sense around parts that repeat.
  if (segs.length >= 3 && repeated.length >= 1) {
    if (count(labelOf[0]!) === 1 && segs[0]!.len <= 8)
      kinds[0] = { kind: "intro", conf: segLoud[0]! < 0 ? "medium" : "low" };
    if (count(labelOf[last]!) === 1 && segs[last]!.len <= 8)
      kinds[last] = { kind: "outro", conf: segLoud[last]! < 0 ? "medium" : "low" };
    const firstChorus = chorus >= 0 ? labelOf.indexOf(chorus) : -1;
    segs.forEach((_, i) => {
      if (i > 0 && i < last && count(labelOf[i]!) === 1 && firstChorus >= 0 && i > firstChorus)
        kinds[i] = { kind: "bridge", conf: "low" };
    });
  }

  // 9. Cues: stops inside sections, entries and drops at the boundaries, texture changes.
  const timbreJump = barTimbre.map((t, i) =>
    i === 0 ? 0 : Math.sqrt(t.reduce((a, v, k) => a + (v - barTimbre[i - 1]![k]!) ** 2, 0)),
  );
  const tjMed = median(timbreJump);
  const tjStd = std(timbreJump);
  const sections: PreSection[] = segs.map((seg, i) => {
    const cues: PreCue[] = [];
    const inside = barLoud.slice(seg.start, seg.start + seg.len);
    const m = median(inside);
    inside.forEach((l, k) => {
      if (k > 0 && l < m - 9) cues.push({ bar: k, type: "stop" });
    });
    if (i > 0) {
      const delta = segLoud[i]! - segLoud[i - 1]!;
      if (delta >= 2.5) cues.push({ bar: 0, type: "entry" });
      else if (delta <= -2.5) cues.push({ bar: 0, type: "drop" });
      else if (timbreJump[seg.start]! > tjMed + 1.5 * tjStd) cues.push({ bar: 0, type: "texture" });
    }
    const startSec = i === 0 ? 0 : frameToSeconds(beatFrames[barStartBeats[seg.start]!]!);
    const next = segs[i + 1];
    const endSec = next ? frameToSeconds(beatFrames[barStartBeats[next.start]!]!) : seconds;
    return {
      label: letter(labelOf[i]!),
      kind: kinds[i]!.kind,
      kindConfidence: kinds[i]!.conf,
      startSec: Math.round(startSec * 100) / 100,
      endSec: Math.round(endSec * 100) / 100,
      startBar: seg.start,
      bars: seg.len,
      chords: chordsByBar.slice(seg.start, seg.start + seg.len),
      loudnessDb: Math.round(segLoud[i]! * 10) / 10,
      cues,
    };
  });

  return {
    engine: ANALYSIS_ENGINE,
    version: PREARRANGE_VERSION,
    analysedSeconds: Math.round(seconds * 10) / 10,
    report,
    beatsPerBar,
    firstDownbeatSec: Math.round(frameToSeconds(beatFrames[barStartBeats[0]!]!) * 1000) / 1000,
    barSeconds: Math.round(barSec * 1000) / 1000,
    bars: nBars,
    sections,
    chordsByBar,
  };
}

/** Pre-arrangement of audio at any sample rate (one or more channels). */
export function prearrange(channels: Float32Array[], sampleRate: number): PreArrangement {
  return prearrangeMono(toAnalysisRate(mixDown(channels), sampleRate));
}

/** Chord changes of a section, without repeats: "Am F C G". */
export function progression(chords: string[]): string[] {
  return chords.filter((c, i) => c !== "N" && c !== chords[i - 1]);
}

export { keyName };

/**
 * Types and small helpers shared by the bar analysis (prearrange.ts) and the structure analyses
 * (structure.ts, and structure-v1.ts kept for comparison).
 */
import type { AnalysisReport } from "./analyze";

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
  /**
   * stop / entry / drop / texture: something happens here that does not start a new section.
   * maybe: a change that could be a section boundary but is not supported well enough.
   */
  type: "stop" | "entry" | "drop" | "texture" | "maybe";
}

/** Everything measured per bar; the input of the structure analysis. */
export interface BarAnalysis {
  report: AnalysisReport;
  seconds: number;
  beatsPerBar: number;
  nBars: number;
  barSec: number;
  /** Start of each bar, in seconds. */
  barStartSec: number[];
  /** Unit-length harmony vector of each bar (12 pitch classes). */
  barChroma: number[][];
  /** Timbre of each bar: 12 log bands, z-scored across the recording. */
  barTimbre: number[][];
  /** Loudness of each bar in dB. */
  barLoud: number[];
  loudMedian: number;
  chordsByBar: string[];
  /** Whether chord names are spelled with flats (from the estimated key). */
  flats: boolean;
}

/** One section found by a structure analysis, in bars. */
export interface StructureSegment {
  start: number;
  len: number;
  /** Repetition group: segments with the same number sound alike. */
  label: number;
  kind: SectionKindGuess;
  conf: "medium" | "low";
  cues: PreCue[];
}

export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i]! * b[i]!;
  return s;
};
export const norm = (a: ArrayLike<number>) => Math.sqrt(dot(a, a));
export const cosine = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  const d = norm(a) * norm(b);
  return d > 0 ? dot(a, b) / d : 0;
};
export const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
export const median = (v: number[]) => {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
export const std = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
};

import type { PreArrangement } from "../src/analysis/prearrange";

export interface Truth {
  /** Section starts in seconds (the first one is 0) and the recording's end. */
  starts: number[];
  end: number;
  /** One label per section: equal labels are the same material. */
  labels: string[];
}

export interface Score {
  sections: number;
  truthSections: number;
  /** True boundaries found within one bar. */
  hits: number;
  /** Boundaries reported where there is none. */
  extra: number;
  boundaryF: number;
  /** Mean distance in seconds between a found true boundary and where it was put. */
  meanErrorSec: number;
  /** Agreement on "these two moments are the same material" (pairwise F over 1-second frames). */
  labelF: number;
}

const f1 = (p: number, r: number) => (p + r > 0 ? (2 * p * r) / (p + r) : 0);

export function score(r: PreArrangement, truth: Truth): Score {
  const tol = r.barSeconds;
  const found = r.sections.slice(1).map((s) => s.startSec);
  const real = truth.starts.slice(1);
  const used = new Set<number>();
  let hits = 0;
  let err = 0;
  for (const t of real) {
    let best = -1;
    found.forEach((f, k) => {
      if (used.has(k) || Math.abs(f - t) > tol) return;
      if (best < 0 || Math.abs(f - t) < Math.abs(found[best]! - t)) best = k;
    });
    if (best >= 0) {
      used.add(best);
      hits += 1;
      err += Math.abs(found[best]! - t);
    }
  }
  const extra = found.length - used.size;
  const precision = found.length ? hits / found.length : real.length ? 0 : 1;
  const recall = real.length ? hits / real.length : 1;
  // Pairwise agreement of labels over one-second frames.
  const truthAt = (t: number) => {
    let k = 0;
    while (k + 1 < truth.starts.length && truth.starts[k + 1]! <= t) k += 1;
    return truth.labels[k]!;
  };
  const predAt = (t: number) =>
    (r.sections.find((s) => s.startSec <= t && s.endSec > t) ?? r.sections[r.sections.length - 1]!)
      .label;
  const frames: [string, string][] = [];
  for (let t = 0.5; t < truth.end; t += 1) frames.push([truthAt(t), predAt(t)]);
  let both = 0;
  let onlyTruth = 0;
  let onlyPred = 0;
  for (let i = 0; i < frames.length; i += 1)
    for (let j = i + 1; j < frames.length; j += 1) {
      const a = frames[i]![0] === frames[j]![0];
      const b = frames[i]![1] === frames[j]![1];
      if (a && b) both += 1;
      else if (a) onlyTruth += 1;
      else if (b) onlyPred += 1;
    }
  const lp = both + onlyPred ? both / (both + onlyPred) : 1;
  const lr = both + onlyTruth ? both / (both + onlyTruth) : 1;
  return {
    sections: r.sections.length,
    truthSections: truth.starts.length,
    hits,
    extra,
    boundaryF: f1(precision, recall),
    meanErrorSec: hits ? err / hits : 0,
    labelF: f1(lp, lr),
  };
}

export const row = (name: string, engine: string, s: Score) =>
  `${name.padEnd(28)} ${engine}  sections ${String(s.sections).padStart(2)}/${s.truthSections}  hits ${s.hits}/${s.truthSections - 1}  extra ${String(s.extra).padStart(2)}  boundary F ${s.boundaryF.toFixed(2)}  err ${s.meanErrorSec.toFixed(2)} s  label F ${s.labelF.toFixed(2)}`;

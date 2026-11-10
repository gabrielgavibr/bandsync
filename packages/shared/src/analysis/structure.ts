/**
 * Structure of a recording from its bars ("prearrange-v2").
 *
 * The first engine compared the four bars before a point with the four bars after it. A song
 * built on one harmonic loop of eight bars then "changes" every four bars, and a threshold
 * relative to the strongest peak accepted nearly all of those changes: 20 sections and 11
 * letters for a song that is one loop played 15 times.
 *
 * This analysis works at the scale of the music's own repetition:
 *  1. it finds the harmonic loop (how many bars until the harmony comes round again);
 *  2. it compares whole loops, not half loops: the mean harmony, timbre and loudness of the loop
 *     before a bar against the loop after it, and the same over two loops (multi-scale). Inside
 *     a steady loop these do not move, wherever in the loop the bar is;
 *  3. near the edges and for short passages, where a whole loop does not fit, it compares bars
 *     with the bars at the same place one loop away;
 *  4. a boundary must be supported by the sections on both sides differing over their whole
 *     length, in absolute terms; weakly supported boundaries are removed one at a time, weakest
 *     first, and what remains of them is kept as an event inside the section (entry, drop,
 *     texture change) or as a "possible division";
 *  5. sections are grouped by what they contain (not by where in the loop they start), so the
 *     same material gets the same letter each time it returns.
 */
import {
  type BarAnalysis,
  cosine,
  mean,
  median,
  type PreCue,
  type SectionKindGuess,
  type StructureSegment,
} from "./structure-common";

export const STRUCTURE_VERSION = "prearrange-v2";

/** A difference of this size, on its own, is a clear change of section. */
const CHROMA_UNIT = 0.05; // 1 - cosine of mean harmony
const TIMBRE_UNIT = 0.9; // RMS difference of z-scored bands
const LOUD_UNIT = 4; // dB

/** Support a boundary needs to stand (1 = one clear difference, or several moderate ones). */
const KEEP = 1;
/** Passages shorter than half a loop need more than that. */
const KEEP_SHORT = 1.5;
/** Below KEEP but above this, the place is reported as a possible division. */
const MAYBE = 0.7;

interface Desc {
  chroma: number[];
  timbre: number[];
  loud: number;
  n: number;
}

export interface Structure {
  segments: StructureSegment[];
  /** Length in bars of the harmonic loop, when the recording has one. */
  loopBars: number | null;
  /** Bar (modulo the loop length) where loops start. */
  loopPhase: number;
}

/**
 * How many bars until the harmony repeats: the shortest lag whose bar-to-bar harmony similarity
 * is close to the best one. Null when no lag stands out (through-composed, or one static chord).
 */
export function loopPeriod(barChroma: number[][]): number | null {
  const n = barChroma.length;
  const sim = (lag: number) => {
    const v: number[] = [];
    for (let i = 0; i + lag < n; i += 1) v.push(cosine(barChroma[i]!, barChroma[i + lag]!));
    return mean(v);
  };
  const all: number[] = [];
  for (let lag = 1; lag <= 16 && n >= 3 * lag; lag += 1) all.push(sim(lag));
  if (all.length < 4) return null;
  const base = median(all);
  const lags = [2, 3, 4, 6, 8, 12, 16].filter((l) => l <= all.length);
  const best = Math.max(...lags.map((l) => all[l - 1]!));
  if (best - base < 0.008) return null;
  return lags.find((l) => all[l - 1]! >= best - 0.25 * (best - base)) ?? null;
}

/**
 * The unit of comparison in bars: one loop (two or more of a very short loop, so that the window
 * never shrinks to a couple of bars), or four bars when nothing loops.
 */
function unitOf(nBars: number, period: number | null): number {
  const u = period === null ? 4 : period < 4 ? period * Math.ceil(4 / period) : period;
  return Math.max(2, Math.min(u, Math.floor(nBars / 3)));
}

function describe(bars: BarAnalysis, idx: number[]): Desc {
  const chroma = new Array<number>(12).fill(0);
  const timbre = new Array<number>(12).fill(0);
  let loud = 0;
  for (const i of idx) {
    for (let k = 0; k < 12; k += 1) {
      chroma[k]! += bars.barChroma[i]![k]!;
      timbre[k]! += bars.barTimbre[i]![k]! / idx.length;
    }
    loud += bars.barLoud[i]! / idx.length;
  }
  return { chroma, timbre, loud, n: idx.length };
}

/** Difference between two passages, in units where 1 is a clear change. */
function distance(
  a: Desc,
  b: Desc,
): { total: number; chroma: number; timbre: number; loud: number } {
  if (a.n === 0 || b.n === 0) return { total: 0, chroma: 0, timbre: 0, loud: 0 };
  const chroma = Math.max(0, 1 - cosine(a.chroma, b.chroma)) / CHROMA_UNIT;
  let t = 0;
  for (let k = 0; k < 12; k += 1) t += (a.timbre[k]! - b.timbre[k]!) ** 2;
  const timbre = Math.sqrt(t / 12) / TIMBRE_UNIT;
  const loud = Math.abs(a.loud - b.loud) / LOUD_UNIT;
  return { total: Math.sqrt(chroma ** 2 + timbre ** 2 + loud ** 2), chroma, timbre, loud };
}

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

/**
 * Change at bar `i` seen through windows of `w` bars. Where a whole loop fits on both sides the
 * two windows are compared directly; otherwise the short side is compared with the bars at the
 * same place one loop away, so a partial loop is never compared with a different partial loop.
 */
function changeAt(bars: BarAnalysis, i: number, w: number, unit: number, loop: boolean): number {
  const n = bars.nBars;
  const b0 = Math.max(0, i - w);
  const a1 = Math.min(n, i + w);
  const before = range(b0, i);
  const after = range(i, a1);
  if (before.length === 0 || after.length === 0) return 0;
  if (before.length >= unit && after.length >= unit)
    return distance(describe(bars, before), describe(bars, after)).total;
  // Nothing loops: a window that does not fit is not compared (the narrower scale covers it).
  if (!loop) return 0;
  // A partial loop at the start: it is a passage of its own only if the rest of that first loop
  // already matches the next one; otherwise the whole first loop differs and the boundary is later.
  if (before.length < unit) {
    const shifted = before.map((j) => j + unit);
    const rest = range(i, unit);
    const restShifted = rest.map((j) => j + unit);
    if (restShifted.some((j) => j >= n) || shifted.some((j) => j >= n)) return 0;
    if (distance(describe(bars, rest), describe(bars, restShifted)).total >= MAYBE) return 0;
    return distance(describe(bars, before), describe(bars, shifted)).total;
  }
  const shifted = after.map((j) => j - unit);
  const rest = range(n - unit, i);
  const restShifted = rest.map((j) => j - unit);
  if (restShifted.some((j) => j < 0) || shifted.some((j) => j < 0)) return 0;
  if (distance(describe(bars, rest), describe(bars, restShifted)).total >= MAYBE) return 0;
  return distance(describe(bars, after), describe(bars, shifted)).total;
}

/**
 * Where loops start (bar index modulo the loop length): the place in the loop where the
 * recording's changes pile up. Sections of loop-based music begin with a loop.
 */
function loopPhase(curve: number[], unit: number): number {
  const sums = new Array<number>(unit).fill(0);
  curve.forEach((v, i) => {
    sums[i % unit]! += v * v;
  });
  return sums.indexOf(Math.max(...sums));
}

/** Bars of `other` that sit at the same place in the loop as the bars of `short`. */
function samePhase(short: number[], other: { start: number; len: number }, unit: number): number[] {
  const out: number[] = [];
  for (const j of short) {
    let best = -1;
    for (let k = other.start; k < other.start + other.len; k += 1)
      if (
        (((k - j) % unit) + unit) % unit === 0 &&
        (best < 0 || Math.abs(k - j) < Math.abs(best - j))
      )
        best = k;
    if (best >= 0) out.push(best);
  }
  return out;
}

interface Seg {
  start: number;
  len: number;
}

/** How different two neighbouring sections are, each taken as a whole. */
function support(bars: BarAnalysis, a: Seg, b: Seg, unit: number, loop: boolean) {
  const ia = range(a.start, a.start + a.len);
  const ib = range(b.start, b.start + b.len);
  if (loop && (a.len < unit || b.len < unit)) {
    // A passage shorter than the loop: compare it with the same part of the loop next door.
    const [short, other] = a.len <= b.len ? [ia, b] : [ib, a];
    const match = samePhase(short, other, unit);
    if (match.length >= Math.ceil(short.length / 2))
      return distance(describe(bars, short), describe(bars, match));
  }
  // Two scales, the clearer one counts: the loop right before against the loop right after (a
  // short passage keeps its edges even when a neighbouring boundary is dropped), and two loops
  // on each side (a change that only shows over a longer stretch).
  const one = distance(describe(bars, ia.slice(-unit)), describe(bars, ib.slice(0, unit)));
  const two = distance(describe(bars, ia.slice(-2 * unit)), describe(bars, ib.slice(0, 2 * unit)));
  return one.total >= two.total ? one : two;
}

/** Whether two sections anywhere in the recording hold the same material. */
function sameMaterial(bars: BarAnalysis, a: Seg, b: Seg, unit: number, loop: boolean): number {
  const ia = range(a.start, a.start + a.len);
  const ib = range(b.start, b.start + b.len);
  if (!loop || (a.len >= unit && b.len >= unit))
    return distance(describe(bars, ia), describe(bars, ib)).total;
  // A short one against a long one: the best place of the long one it can be laid over.
  const [short, long] = a.len <= b.len ? [ia, ib] : [ib, ia];
  let best = Number.POSITIVE_INFINITY;
  for (let off = 0; off + short.length <= long.length; off += 1)
    best = Math.min(
      best,
      distance(describe(bars, short), describe(bars, long.slice(off, off + short.length))).total,
    );
  return best;
}

export function segmentBars(bars: BarAnalysis): Structure {
  const n = bars.nBars;
  const period = loopPeriod(bars.barChroma);
  const loop = period !== null && n >= 3 * period;
  // The unit of comparison: one loop, or four bars when nothing loops.
  const unit = unitOf(n, loop ? period : null);

  // 1. Change curve at the scale of one loop: the loop before each bar against the loop after it.
  //    Without a loop there is no natural scale, so two are combined (multi-scale): the four
  //    bars around a point, and the two bars around it for where exactly the change is.
  const curve = changeCurve(bars, unit, loop);

  // 2. Candidates: local peaks, strongest first. Two candidates less than a loop apart both stay
  //    only when each is strong on its own (a short break, a stop), never as two readings of
  //    one change.
  //    Sections of loop-based music start where loops start: between two nearly equal
  //    neighbours (a pickup, a fill) the one on the loop grid wins.
  const phase = loop ? loopPhase(curve, unit) : 0;
  const onGrid = (i: number) => loop && unit >= 4 && (((i - phase) % unit) + unit) % unit === 0;
  const ranked = curve.map((v, i) => v * (onGrid(i) ? 1.12 : 1));
  const reach = Math.max(1, Math.floor(unit / 2));
  const peaks: number[] = [];
  for (let i = 1; i < n; i += 1) {
    let peak = curve[i]! >= MAYBE * 0.8;
    for (let d = -reach; d <= reach && peak; d += 1)
      if (d !== 0 && (ranked[i + d] ?? 0) > ranked[i]!) peak = false;
    if (peak) peaks.push(i);
  }
  peaks.sort((a, b) => ranked[b]! - ranked[a]!);
  const minGap = Math.max(2, Math.floor(unit / 2));
  const chosen: number[] = [];
  for (const p of peaks) {
    const ok = chosen.every((c) => {
      const gap = Math.abs(c - p);
      return gap >= unit || (gap >= minGap && curve[p]! >= KEEP_SHORT && curve[c]! >= KEEP_SHORT);
    });
    if (ok) chosen.push(p);
  }
  chosen.sort((a, b) => a - b);

  // 3. Regularisation: drop the weakest boundary until every one left is supported by the two
  //    sections around it differing as wholes.
  let cuts = chosen.slice();
  const rejected: { bar: number; strength: number }[] = [];
  const segsOf = (c: number[]): Seg[] =>
    [0, ...c].map((s, k) => ({ start: s, len: ([...c, n][k] ?? n) - s }));
  for (;;) {
    const segs = segsOf(cuts);
    let worst = -1;
    let worstRatio = Number.POSITIVE_INFINITY;
    let worstStrength = 0;
    for (let k = 0; k < cuts.length; k += 1) {
      const a = segs[k]!;
      const b = segs[k + 1]!;
      const s = support(bars, a, b, unit, loop).total;
      const short = Math.min(a.len, b.len) < Math.max(2, unit / 2);
      const ratio = s / (short ? KEEP_SHORT : KEEP);
      if (ratio < worstRatio) {
        worstRatio = ratio;
        worst = k;
        worstStrength = s;
      }
    }
    if (worst < 0 || worstRatio >= 1) break;
    rejected.push({ bar: cuts[worst]!, strength: worstStrength });
    cuts = cuts.filter((_, k) => k !== worst);
  }

  // Silence before the first note or after the last one is not a section.
  const silent = (seg: Seg) =>
    seg.len <= 2 && mean(bars.barLoud.slice(seg.start, seg.start + seg.len)) < bars.loudMedian - 15;
  while (cuts.length > 0 && silent(segsOf(cuts)[cuts.length]!)) cuts = cuts.slice(0, -1);
  while (cuts.length > 0 && silent(segsOf(cuts)[0]!)) cuts = cuts.slice(1);

  // 4. Repetition groups: the same material gets the same number wherever it returns. Two
  //    neighbours that turn out to be the same material are one section: the boundary goes.
  let segs = segsOf(cuts);
  let labelOf: number[] = [];
  for (;;) {
    labelOf = [];
    const reps: number[] = [];
    segs.forEach((seg, i) => {
      let best = -1;
      let bestDist = Number.POSITIVE_INFINITY;
      reps.forEach((r, label) => {
        const d = sameMaterial(bars, segs[r]!, seg, unit, loop);
        if (d < bestDist) {
          bestDist = d;
          best = label;
        }
      });
      if (best >= 0 && bestDist < KEEP * 0.8) labelOf[i] = best;
      else {
        labelOf[i] = reps.length;
        reps.push(i);
      }
    });
    const twin = labelOf.findIndex((l, i) => i > 0 && l === labelOf[i - 1]);
    if (twin < 0) break;
    rejected.push({ bar: cuts[twin - 1]!, strength: 0 });
    cuts = cuts.filter((_, k) => k !== twin - 1);
    segs = segsOf(cuts);
  }

  // 5. Functional names, only from evidence: what repeats, where it sits, how loud it is.
  const segLoud = segs.map(
    (s) => mean(bars.barLoud.slice(s.start, s.start + s.len)) - bars.loudMedian,
  );
  const count = (l: number) => labelOf.filter((x) => x === l).length;
  const repeated = [...new Set(labelOf)].filter((l) => count(l) >= 2);
  const loudOfLabel = (l: number) => mean(segLoud.filter((_, i) => labelOf[i] === l));
  const kinds: { kind: SectionKindGuess; conf: "medium" | "low" }[] = segs.map(() => ({
    kind: "unknown",
    conf: "low",
  }));
  let chorus = -1;
  // A chorus is named only against another repeated part: one repeated part alone is just "A".
  if (repeated.length >= 2) {
    const byLoud = [...repeated].sort((a, b) => loudOfLabel(b) - loudOfLabel(a));
    chorus = byLoud[0]!;
    const margin = loudOfLabel(byLoud[0]!) - loudOfLabel(byLoud[1]!);
    const conf: "medium" | "low" = margin >= 1 ? "medium" : "low";
    labelOf.forEach((l, i) => {
      if (l === chorus) kinds[i] = { kind: "chorus", conf };
    });
    const firstChorus = labelOf.indexOf(chorus);
    for (const l of byLoud.slice(1)) {
      if (labelOf.indexOf(l) < firstChorus || firstChorus <= 0) {
        labelOf.forEach((x, i) => {
          if (x === l) kinds[i] = { kind: "verse", conf };
        });
        break;
      }
    }
  }
  const last = segs.length - 1;
  if (segs.length >= 3 && repeated.length >= 1) {
    const longest = Math.max(...segs.map((s) => s.len));
    if (count(labelOf[0]!) === 1 && segs[0]!.len <= Math.max(8, unit) && segs[0]!.len < longest)
      kinds[0] = { kind: "intro", conf: segLoud[0]! < segLoud[1]! - 1 ? "medium" : "low" };
    if (
      count(labelOf[last]!) === 1 &&
      segs[last]!.len <= Math.max(8, unit) &&
      segs[last]!.len < longest
    )
      kinds[last] = {
        kind: "outro",
        conf: segLoud[last]! < segLoud[last - 1]! - 1 ? "medium" : "low",
      };
    const firstChorus = chorus >= 0 ? labelOf.indexOf(chorus) : -1;
    segs.forEach((_, i) => {
      if (i > 0 && i < last && count(labelOf[i]!) === 1 && firstChorus >= 0 && i > firstChorus)
        kinds[i] = { kind: "bridge", conf: "low" };
    });
  }

  // 6. Events inside sections: stops, and what is left of the boundaries that did not stand.
  const segments: StructureSegment[] = segs.map((seg, i) => {
    const cues: PreCue[] = [];
    const inside = bars.barLoud.slice(seg.start, seg.start + seg.len);
    const m = median(inside);
    inside.forEach((l, k) => {
      if (k > 0 && l < m - 9) cues.push({ bar: k, type: "stop" });
    });
    if (i > 0) {
      const delta = segLoud[i]! - segLoud[i - 1]!;
      if (delta >= 2.5) cues.push({ bar: 0, type: "entry" });
      else if (delta <= -2.5) cues.push({ bar: 0, type: "drop" });
    }
    for (const r of rejected) {
      if (r.bar <= seg.start || r.bar >= seg.start + seg.len) continue;
      const k = r.bar - seg.start;
      const w = Math.max(2, Math.floor(unit / 2));
      const before = mean(bars.barLoud.slice(Math.max(seg.start, r.bar - w), r.bar));
      const after = mean(bars.barLoud.slice(r.bar, Math.min(seg.start + seg.len, r.bar + w)));
      if (r.strength >= MAYBE * KEEP) cues.push({ bar: k, type: "maybe" });
      else if (after - before >= 2.5) cues.push({ bar: k, type: "entry" });
      else if (after - before <= -2.5) cues.push({ bar: k, type: "drop" });
      else if (r.strength >= 0.5) cues.push({ bar: k, type: "texture" });
    }
    cues.sort((a, b) => a.bar - b.bar);
    return {
      start: seg.start,
      len: seg.len,
      label: labelOf[i]!,
      kind: kinds[i]!.kind,
      conf: kinds[i]!.conf,
      cues,
    };
  });

  return { segments, loopBars: loop ? period : null, loopPhase: loop ? phase : 0 };
}

function changeCurve(bars: BarAnalysis, unit: number, loop: boolean): number[] {
  const n = bars.nBars;
  const small = Math.max(2, Math.floor(unit / 2));
  return Array.from({ length: n }, (_, i) => {
    if (i === 0) return 0;
    const wide = changeAt(bars, i, unit, unit, loop);
    return loop ? wide : 0.5 * wide + 0.5 * changeAt(bars, i, small, small, false);
  });
}

/** The change curve, for diagnostics and tests. */
export function debugCurve(bars: BarAnalysis): number[] {
  const n = bars.nBars;
  const period = loopPeriod(bars.barChroma);
  const loop = period !== null && n >= 3 * period;
  return changeCurve(bars, unitOf(n, loop ? period : null), loop);
}

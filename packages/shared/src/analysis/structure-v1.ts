/**
 * The first structure analysis ("prearrange-v1"), kept unchanged so the new one can be compared
 * with it on the same recordings (test/structure-compare.test.ts). Not used by the app.
 *
 * Known weakness, measured on a real song built on one harmonic loop: the novelty kernel spans
 * four bars on each side, so a loop of eight bars looks like a change every four bars, and a
 * threshold relative to the strongest peak lets all of them through.
 */
import {
  type BarAnalysis,
  cosine,
  mean,
  median,
  type PreCue,
  type SectionKindGuess,
  type StructureSegment,
  std,
} from "./structure-common";

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

export function segmentV1(bars: BarAnalysis): StructureSegment[] {
  const { nBars, barChroma, barTimbre, barLoud, loudMedian } = bars;
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
  return segs.map((seg, i) => {
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
    return {
      start: seg.start,
      len: seg.len,
      label: labelOf[i]!,
      kind: kinds[i]!.kind,
      conf: kinds[i]!.conf,
      cues,
    };
  });
}

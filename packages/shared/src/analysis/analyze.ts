/**
 * BandSync's own audio analysis: tempo, beats, meter and key, estimated from audio the band is
 * allowed to process (a file it owns, or what the device's microphone hears while a member plays
 * the reference). Pure TypeScript, no dependencies, runs in a browser worker or in Node.
 *
 * Method (classic music-information-retrieval building blocks):
 *  - spectral-flux onset envelope (Bello et al. 2005) on a mono 11 025 Hz signal;
 *  - tempo from the autocorrelation of that envelope with a log-normal prior around 120 BPM
 *    (as in librosa's beat tracker), refined from the tracked beats;
 *  - beats by dynamic programming (Ellis 2007);
 *  - meter from where the strongest (low-frequency) accents fall in groups of 2, 3 or 4 beats;
 *  - key by correlating the chroma profile with the Krumhansl–Kessler key profiles.
 *
 * Everything returned is an estimate. Confidence is not calibrated on real recordings, so callers
 * must present every value as "needs review" until a person confirms it. Known weaknesses:
 * half/double tempo (common in reggae), relative major/minor, compound meters (6/8), music without
 * a steady pulse, and noisy microphone captures.
 */

export const ANALYSIS_ENGINE = "bandsync-browser";
export const ANALYSIS_ENGINE_VERSION = "listen-v1";
export const ANALYSIS_SAMPLE_RATE = 11_025;
const FRAME = 1024;
const HOP = 256;
const MIN_BPM = 40;
const MAX_BPM = 240;
const MIN_SECONDS = 8;

export interface TempoCandidate {
  bpm: number;
  /** Autocorrelation strength relative to the chosen tempo (1 = as strong). */
  score: number;
}

export interface KeyCandidate {
  key: string;
  tonic: number;
  mode: "major" | "minor";
  /** Pearson correlation with the key profile (-1..1). */
  score: number;
}

export interface MeterCandidate {
  beatsPerBar: number;
  score: number;
}

export interface AnalysisReport {
  engine: typeof ANALYSIS_ENGINE;
  engineVersion: typeof ANALYSIS_ENGINE_VERSION;
  analysedSeconds: number;
  signal: { rms: number; peak: number; silentRatio: number; tooQuiet: boolean };
  bpm: { value: number; candidates: TempoCandidate[]; ambiguous: boolean } | null;
  /** Coefficient of variation of the local tempo over ~10 s windows (0 = perfectly steady). */
  stability: { cv: number; windows: number } | null;
  /** Beat times in seconds from the start of the analysed audio. */
  beats: number[];
  meter: { beatsPerBar: number; beatUnit: 4; candidates: MeterCandidate[] } | null;
  key: { key: string; tonic: number; mode: "major" | "minor"; candidates: KeyCandidate[] } | null;
}

export class AnalysisError extends Error {
  constructor(readonly code: "too_short" | "no_signal") {
    super(code);
  }
}

/* ------------------------------------------------------------------ */
/* Signal helpers                                                      */
/* ------------------------------------------------------------------ */

/** Down-mixes and resamples to the analysis rate (box low-pass, then decimation). */
export function toAnalysisRate(samples: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === ANALYSIS_SAMPLE_RATE) return samples;
  const ratio = sampleRate / ANALYSIS_SAMPLE_RATE;
  const n = Math.floor(samples.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b && j < samples.length; j += 1) s += samples[j]!;
    out[i] = s / (b - a);
  }
  return out;
}

/** Averages channels into one. */
export function mixDown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const n = channels[0]!.length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i += 1) out[i]! += ch[i]! / channels.length;
  return out;
}

function makeFft(n: number) {
  const levels = Math.log2(n);
  if (!Number.isInteger(levels)) throw new Error("FFT size must be a power of two");
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) {
    let r = 0;
    for (let b = 0; b < levels; b += 1) r = (r << 1) | ((i >>> b) & 1);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  /** Magnitudes of bins 0..n/2 of a real frame. */
  return (frame: Float32Array, mags: Float32Array) => {
    for (let i = 0; i < n; i += 1) {
      re[rev[i]!] = frame[i]!;
      im[rev[i]!] = 0;
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k += 1) {
          const c = cos[k * step]!;
          const s = sin[k * step]!;
          const a = start + k;
          const b = a + half;
          const tr = re[b]! * c + im[b]! * s;
          const ti = im[b]! * c - re[b]! * s;
          re[b] = re[a]! - tr;
          im[b] = im[a]! - ti;
          re[a] = re[a]! + tr;
          im[a] = im[a]! + ti;
        }
      }
    }
    for (let k = 0; k <= n / 2; k += 1) mags[k] = Math.hypot(re[k]!, im[k]!);
  };
}

interface Features {
  frameRate: number;
  frames: number;
  onset: Float32Array;
  lowOnset: Float32Array;
  energy: Float32Array;
  chroma: Float32Array; // frames * 12
}

function extractFeatures(x: Float32Array): Features {
  const sr = ANALYSIS_SAMPLE_RATE;
  const frames = Math.max(0, Math.floor((x.length - FRAME) / HOP) + 1);
  const fft = makeFft(FRAME);
  const win = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i += 1) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
  const bins = FRAME / 2 + 1;
  const binHz = sr / FRAME;
  // Each bin between 55 Hz and 2 kHz feeds the chroma bin of its nearest pitch class.
  const pc = new Int8Array(bins).fill(-1);
  for (let k = 1; k < bins; k += 1) {
    const f = k * binHz;
    if (f < 55 || f > 2000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    pc[k] = ((Math.round(midi) % 12) + 12) % 12;
  }
  const lowLimit = Math.ceil(180 / binHz);
  const onset = new Float32Array(frames);
  const lowOnset = new Float32Array(frames);
  const energy = new Float32Array(frames);
  const chroma = new Float32Array(frames * 12);
  const frame = new Float32Array(FRAME);
  const mags = new Float32Array(bins);
  let prev = new Float32Array(bins);
  let cur = new Float32Array(bins);
  for (let f = 0; f < frames; f += 1) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i += 1) frame[i] = x[off + i]! * win[i]!;
    fft(frame, mags);
    let flux = 0;
    let lowFlux = 0;
    let e = 0;
    for (let k = 1; k < bins; k += 1) {
      const m = mags[k]!;
      e += m * m;
      cur[k] = Math.log1p(100 * m);
      const d = cur[k]! - prev[k]!;
      if (d > 0) {
        flux += d;
        if (k <= lowLimit) lowFlux += d;
      }
      const p = pc[k]!;
      if (p >= 0) chroma[f * 12 + p]! += m;
    }
    onset[f] = f === 0 ? 0 : flux;
    lowOnset[f] = f === 0 ? 0 : lowFlux;
    energy[f] = e;
    [prev, cur] = [cur, prev];
  }
  return { frameRate: sr / HOP, frames, onset, lowOnset, energy, chroma };
}

/** Removes the slowly varying part, keeps positive peaks, scales to unit deviation. */
function normaliseEnvelope(env: Float32Array, frameRate: number): Float32Array {
  const n = env.length;
  const half = Math.max(1, Math.round(frameRate * 0.25));
  const out = new Float32Array(n);
  let sum = 0;
  let count = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i += 1) {
    while (hi < Math.min(n - 1, i + half)) {
      hi += 1;
      sum += env[hi]!;
      count += 1;
    }
    while (lo < i - half) {
      sum -= env[lo]!;
      lo += 1;
      count -= 1;
    }
    out[i] = Math.max(0, env[i]! - sum / count);
  }
  let mean = 0;
  for (const v of out) mean += v;
  mean /= Math.max(1, n);
  let v2 = 0;
  for (const v of out) v2 += (v - mean) ** 2;
  const sd = Math.sqrt(v2 / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i += 1) out[i] = out[i]! / sd;
  return out;
}

function autocorrelation(env: Float32Array, minLag: number, maxLag: number): Float64Array {
  const acf = new Float64Array(maxLag + 2);
  const n = env.length;
  for (let lag = Math.max(1, minLag - 1); lag <= Math.min(maxLag + 1, n - 1); lag += 1) {
    let s = 0;
    for (let t = 0; t + lag < n; t += 1) s += env[t]! * env[t + lag]!;
    acf[lag] = s / (n - lag);
  }
  return acf;
}

/** Value of a sampled curve at a fractional position. */
function at(curve: ArrayLike<number>, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = curve[i] ?? 0;
  const b = curve[i + 1] ?? a;
  return a + (b - a) * f;
}

/* ------------------------------------------------------------------ */
/* Tempo, beats, meter, key                                            */
/* ------------------------------------------------------------------ */

function estimateTempo(env: Float32Array, frameRate: number) {
  const minLag = Math.floor((60 * frameRate) / MAX_BPM);
  const maxLag = Math.ceil((60 * frameRate) / MIN_BPM);
  if (env.length < maxLag * 2) return null;
  const acf = autocorrelation(env, minLag, maxLag);
  const prior = (bpm: number) => Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
  let best = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    if (!(acf[lag]! >= acf[lag - 1]! && acf[lag]! >= acf[lag + 1]!)) continue; // local peaks only
    const score = acf[lag]! * prior((60 * frameRate) / lag);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (best < 0 || acf[best]! <= 0) return null;
  // Parabolic refinement of the peak position.
  const y0 = acf[best - 1]!;
  const y1 = acf[best]!;
  const y2 = acf[best + 1]!;
  const denom = y0 - 2 * y1 + y2;
  const lag = denom === 0 ? best : best + (0.5 * (y0 - y2)) / denom;
  const bpm = (60 * frameRate) / lag;
  const strength = (l: number) => Math.max(0, at(acf, l)) / y1;
  const candidates: TempoCandidate[] = [{ bpm, score: 1 }];
  for (const factor of [0.5, 2, 2 / 3, 3 / 2]) {
    const b = bpm * factor;
    const l = (60 * frameRate) / b;
    if (b < MIN_BPM || b > MAX_BPM || l >= acf.length - 1) continue;
    // Strongest point near that lag.
    let s = 0;
    for (let d = -1; d <= 1; d += 1) s = Math.max(s, strength(l + d));
    candidates.push({ bpm: b, score: s });
  }
  const half = candidates.find((c) => Math.abs(c.bpm / bpm - 0.5) < 1e-6);
  const double = candidates.find((c) => Math.abs(c.bpm / bpm - 2) < 1e-6);
  const ambiguous = (half?.score ?? 0) >= 0.7 || (double?.score ?? 0) >= 0.7;
  return { bpm, period: lag, candidates, ambiguous, acf };
}

function trackBeats(env: Float32Array, period: number): number[] {
  const n = env.length;
  // Local score: onset strength smoothed at the scale of the beat.
  const sd = Math.max(1, period / 32);
  const radius = Math.ceil(sd * 3);
  const kernel: number[] = [];
  for (let i = -radius; i <= radius; i += 1) kernel.push(Math.exp(-0.5 * (i / sd) ** 2));
  const local = new Float64Array(n);
  for (let t = 0; t < n; t += 1) {
    let s = 0;
    for (let i = -radius; i <= radius; i += 1) s += (env[t + i] ?? 0) * kernel[i + radius]!;
    local[t] = s;
  }
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const alpha = 100;
  for (let t = 0; t < n; t += 1) {
    let best = 0;
    let arg = -1;
    const from = Math.max(0, Math.floor(t - 2 * period));
    const to = Math.min(t - 1, Math.round(t - period / 2));
    for (let prev = from; prev <= to; prev += 1) {
      const s = cum[prev]! - alpha * Math.log((t - prev) / period) ** 2;
      if (arg < 0 || s > best) {
        best = s;
        arg = prev;
      }
    }
    cum[t] = local[t]! + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  // Last beat: the best cumulative score within the final period.
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t += 1) if (cum[t]! > cum[end]!) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]!) {
    beats.push(t);
    if (back[t]! < 0) break;
  }
  beats.reverse();
  // Drop leading/trailing beats where nothing is playing.
  const threshold = 0.1 * (local.reduce((a, b) => a + b, 0) / Math.max(1, n));
  while (beats.length > 0 && local[beats[0]!]! < threshold) beats.shift();
  while (beats.length > 0 && local[beats[beats.length - 1]!]! < threshold) beats.pop();
  return beats;
}

/** The longest stretch of consecutive beats whose spacing stays within 15 % of the period. */
function longestRegularRun(beats: number[], period: number): number[] {
  let best: number[] = [];
  let cur: number[] = beats.length ? [beats[0]!] : [];
  for (let i = 1; i < beats.length; i += 1) {
    const gap = beats[i]! - beats[i - 1]!;
    if (Math.abs(gap / period - 1) <= 0.15) cur.push(beats[i]!);
    else {
      if (cur.length > best.length) best = cur;
      cur = [beats[i]!];
    }
  }
  return cur.length > best.length ? cur : best;
}

function estimateMeter(beats: number[], accent: Float32Array): AnalysisReport["meter"] {
  if (beats.length < 12) return null;
  const strength = beats.map((b) => {
    let m = 0;
    for (let d = -2; d <= 2; d += 1) m = Math.max(m, accent[b + d] ?? 0);
    return m;
  });
  const contrast = (m: number) => {
    let best = 0;
    for (let phase = 0; phase < m; phase += 1) {
      let on = 0;
      let nOn = 0;
      let off = 0;
      let nOff = 0;
      strength.forEach((s, i) => {
        if (i % m === phase) {
          on += s;
          nOn += 1;
        } else {
          off += s;
          nOff += 1;
        }
      });
      const c = on / Math.max(1, nOn) - off / Math.max(1, nOff);
      best = Math.max(best, c);
    }
    return best;
  };
  const raw = [2, 3, 4].map((m) => ({ beatsPerBar: m, score: contrast(m) }));
  const top = Math.max(...raw.map((r) => r.score), 1e-9);
  const scored = raw.map((r) => ({ beatsPerBar: r.beatsPerBar, score: r.score / top }));
  // An accent every 2 beats is also one every 4: popular music is written in 4 far more often.
  const four = scored.find((s) => s.beatsPerBar === 4)!;
  const two = scored.find((s) => s.beatsPerBar === 2)!;
  const three = scored.find((s) => s.beatsPerBar === 3)!;
  const pick = three.score > Math.max(four.score, two.score) ? 3 : 4;
  const candidates = [
    { beatsPerBar: 4, score: Math.max(four.score, two.score) },
    { beatsPerBar: 3, score: three.score },
  ].sort((a, b) => b.score - a.score);
  return { beatsPerBar: pick, beatUnit: 4, candidates };
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const FLAT_MAJOR_TONICS = new Set([5, 10, 3, 8, 1, 6]);

export function keyName(tonic: number, mode: "major" | "minor"): string {
  const major = mode === "major" ? tonic : (tonic + 3) % 12;
  const name = (FLAT_MAJOR_TONICS.has(major) ? FLAT : SHARP)[tonic]!;
  return mode === "minor" ? `${name}m` : name;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function estimateKey(f: Features): AnalysisReport["key"] {
  const profile = new Array<number>(12).fill(0);
  for (let t = 0; t < f.frames; t += 1) {
    let frameSum = 0;
    for (let p = 0; p < 12; p += 1) frameSum += f.chroma[t * 12 + p]!;
    if (frameSum <= 0) continue;
    // Each frame counts by its loudness, but relative within the frame (tonal content).
    const w = Math.sqrt(f.energy[t]!);
    for (let p = 0; p < 12; p += 1) profile[p]! += (f.chroma[t * 12 + p]! / frameSum) * w;
  }
  if (profile.every((v) => v === 0)) return null;
  const all: KeyCandidate[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const [mode, ref] of [
      ["major", MAJOR],
      ["minor", MINOR],
    ] as const) {
      const rotated = ref.map((_, i) => ref[(i - tonic + 12) % 12]!);
      all.push({ key: keyName(tonic, mode), tonic, mode, score: pearson(profile, rotated) });
    }
  }
  all.sort((a, b) => b.score - a.score);
  const best = all[0]!;
  return { key: best.key, tonic: best.tonic, mode: best.mode, candidates: all.slice(0, 4) };
}

function tempoStability(env: Float32Array, frameRate: number, period: number) {
  const win = Math.round(frameRate * 10);
  const hop = Math.round(frameRate * 5);
  const local: number[] = [];
  for (let start = 0; start + win <= env.length; start += hop) {
    const seg = env.subarray(start, start + win);
    const lo = Math.floor(period * 0.85);
    const hi = Math.ceil(period * 1.15);
    const acf = autocorrelation(seg, lo, hi);
    let best = lo;
    for (let l = lo; l <= hi; l += 1) if (acf[l]! > acf[best]!) best = l;
    if (acf[best]! > 0) local.push((60 * frameRate) / best);
  }
  if (local.length < 2) return null;
  const mean = local.reduce((a, b) => a + b, 0) / local.length;
  const sd = Math.sqrt(local.reduce((a, b) => a + (b - mean) ** 2, 0) / local.length);
  return { cv: Math.round((sd / mean) * 1000) / 1000, windows: local.length };
}

/* ------------------------------------------------------------------ */

/** Analyses mono audio already at {@link ANALYSIS_SAMPLE_RATE}. */
export function analyzeMono(x: Float32Array): AnalysisReport {
  const seconds = x.length / ANALYSIS_SAMPLE_RATE;
  if (seconds < MIN_SECONDS) throw new AnalysisError("too_short");
  let peak = 0;
  let sq = 0;
  for (const v of x) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sq += v * v;
  }
  const rms = Math.sqrt(sq / x.length);
  const f = extractFeatures(x);
  let maxE = 0;
  for (const e of f.energy) maxE = Math.max(maxE, e);
  let silent = 0;
  for (const e of f.energy) if (e < maxE * 1e-4) silent += 1;
  const silentRatio = f.frames ? silent / f.frames : 1;
  const signal = {
    rms: Math.round(rms * 1e4) / 1e4,
    peak: Math.round(peak * 1e4) / 1e4,
    silentRatio: Math.round(silentRatio * 100) / 100,
    tooQuiet: rms < 0.005,
  };
  if (maxE === 0 || silentRatio > 0.8) throw new AnalysisError("no_signal");

  const env = normaliseEnvelope(f.onset, f.frameRate);
  const low = normaliseEnvelope(f.lowOnset, f.frameRate);
  const tempo = estimateTempo(env, f.frameRate);
  let beats: number[] = [];
  let bpm: AnalysisReport["bpm"] = null;
  let meter: AnalysisReport["meter"] = null;
  let stability: AnalysisReport["stability"] = null;
  if (tempo) {
    beats = trackBeats(env, tempo.period);
    // Refine the tempo from the beats actually tracked: each beat is placed between frames by
    // parabolic interpolation, then a line is fitted through the longest run of regular beats.
    let value = tempo.bpm;
    const fine = beats.map((b) => {
      const y0 = env[b - 1] ?? 0;
      const y1 = env[b] ?? 0;
      const y2 = env[b + 1] ?? 0;
      const d = y0 - 2 * y1 + y2;
      return d < 0 ? b + Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d)) : b;
    });
    const run = longestRegularRun(fine, tempo.period);
    if (run.length >= 8) {
      const n = run.length;
      const mx = (n - 1) / 2;
      const my = run.reduce((a, b) => a + b, 0) / n;
      let num = 0;
      let den = 0;
      run.forEach((y, i) => {
        num += (i - mx) * (y - my);
        den += (i - mx) ** 2;
      });
      const fromBeats = (60 * f.frameRate) / (num / den);
      if (Math.abs(fromBeats / tempo.bpm - 1) < 0.06) value = fromBeats;
    }
    const scale = value / tempo.bpm;
    bpm = {
      value: Math.round(value * 10) / 10,
      candidates: tempo.candidates.map((c) => ({
        bpm: Math.round(c.bpm * scale * 10) / 10,
        score: Math.round(c.score * 100) / 100,
      })),
      ambiguous: tempo.ambiguous,
    };
    const accent = new Float32Array(env.length);
    for (let i = 0; i < env.length; i += 1) accent[i] = env[i]! + 2 * low[i]!;
    meter = estimateMeter(beats, accent);
    stability = tempoStability(env, f.frameRate, tempo.period);
  }
  return {
    engine: ANALYSIS_ENGINE,
    engineVersion: ANALYSIS_ENGINE_VERSION,
    analysedSeconds: Math.round(seconds * 10) / 10,
    signal,
    bpm,
    stability,
    beats: beats.map(
      (b) => Math.round(((b * HOP + FRAME / 2) / ANALYSIS_SAMPLE_RATE) * 1000) / 1000,
    ),
    meter,
    key: estimateKey(f),
  };
}

/** Analyses audio at any sample rate (one or more channels). */
export function analyzeAudio(channels: Float32Array[], sampleRate: number): AnalysisReport {
  return analyzeMono(toAnalysisRate(mixDown(channels), sampleRate));
}

/**
 * Pitch detection for the tuner: YIN (de Cheveigné & Kawahara, 2002).
 *
 * The method measures how well the signal matches itself one period later, normalised so that
 * the result does not depend on how loud the signal is: a quiet note is found as well as a loud
 * one, as long as it stands out of the noise. Loudness is judged separately (see tuner.ts).
 *
 * To reach the low E of a bass (41 Hz) and below without heavy work on a phone, the search runs
 * on the signal reduced to about 12 kHz over a long window, and the period found is then refined
 * on the full-rate signal for precision in cents.
 */

export interface PitchEstimate {
  /** Fundamental frequency in Hz. */
  freq: number;
  /** 0..1: how periodic the signal is at that frequency (1 = a perfectly steady tone). */
  clarity: number;
}

export interface PitchOptions {
  minHz?: number;
  maxHz?: number;
  /** YIN's threshold: the first period this "clean" is taken (lower = stricter). */
  threshold?: number;
}

/** Sum of squared differences between the signal and itself `lag` samples later. */
function difference(x: Float32Array, lag: number, width: number): number {
  let d = 0;
  for (let i = 0; i < width; i += 1) {
    const v = x[i]! - x[i + lag]!;
    d += v * v;
  }
  return d;
}

/** Minimum of the parabola through three points around index 1 (offset in -1..1 and its value). */
function parabola(y0: number, y1: number, y2: number): { shift: number; value: number } {
  const denom = y0 - 2 * y1 + y2;
  if (denom === 0) return { shift: 0, value: y1 };
  const shift = Math.max(-1, Math.min(1, (0.5 * (y0 - y2)) / denom));
  return { shift, value: y1 - 0.25 * (y0 - y2) * shift };
}

export function estimatePitch(
  buffer: Float32Array,
  sampleRate: number,
  opts: PitchOptions = {},
): PitchEstimate | null {
  const minHz = opts.minHz ?? 27;
  const maxHz = opts.maxHz ?? 1600;
  const threshold = opts.threshold ?? 0.15;
  const n = buffer.length;
  if (n < 512) return null;

  // 1. Remove the offset, and reduce the rate (two box filters = a triangular low-pass).
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += buffer[i]!;
  mean /= n;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i += 1) x[i] = buffer[i]! - mean;
  const factor = Math.max(1, Math.floor(sampleRate / 11_000));
  let y = x;
  let rate = sampleRate;
  if (factor > 1) {
    const smooth = new Float32Array(n);
    let acc = 0;
    for (let i = 0; i < n; i += 1) {
      acc += x[i]!;
      if (i >= factor) acc -= x[i - factor]!;
      smooth[i] = acc / factor;
    }
    const m = Math.floor(n / factor);
    y = new Float32Array(m);
    acc = 0;
    for (let i = 0; i < n; i += 1) {
      acc += smooth[i]!;
      if (i >= factor) acc -= smooth[i - factor]!;
      if (i % factor === factor - 1) y[(i - (factor - 1)) / factor] = acc / factor;
    }
    rate = sampleRate / factor;
  }

  // 2. Cumulative mean normalised difference over the lags of interest.
  const m = y.length;
  const tauMax = Math.min(Math.floor(rate / minHz), Math.floor(m / 2) - 1);
  const tauMin = Math.max(2, Math.floor(rate / maxHz));
  if (tauMax <= tauMin + 2) return null;
  const width = m - tauMax;
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau += 1) {
    const d = difference(y, tau, width);
    running += d;
    cmnd[tau] = running > 0 ? (d * tau) / running : 1;
  }

  // 3. The first lag that is clean enough, followed down to its local minimum; failing that,
  //    the cleanest lag of all (its clarity then says how much to trust it).
  let tau = -1;
  for (let t = tauMin; t < tauMax; t += 1) {
    if (cmnd[t]! < threshold) {
      while (t + 1 < tauMax && cmnd[t + 1]! < cmnd[t]!) t += 1;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    let best = tauMin;
    for (let t = tauMin; t < tauMax; t += 1) if (cmnd[t]! < cmnd[best]!) best = t;
    tau = best;
  }
  if (tau <= 1 || tau >= tauMax) return null;
  const coarse = parabola(cmnd[tau - 1]!, cmnd[tau]!, cmnd[tau + 1]!);
  const clarity = Math.max(0, Math.min(1, 1 - coarse.value));
  let period = (tau + coarse.shift) * factor;

  // 4. Refine on the full-rate signal around that period (cents need more than 12 kHz gives).
  if (factor > 1) {
    const centre = Math.round(period);
    const lo = Math.max(2, centre - factor);
    const hi = centre + factor;
    const w = Math.min(n - hi - 1, 4096);
    if (w > 256) {
      let best = lo;
      let bestD = Number.POSITIVE_INFINITY;
      const ds: number[] = [];
      for (let lag = lo - 1; lag <= hi + 1; lag += 1) {
        const d = difference(x, lag, w);
        ds.push(d);
        if (lag >= lo && lag <= hi && d < bestD) {
          bestD = d;
          best = lag;
        }
      }
      const k = best - (lo - 1);
      period = best + parabola(ds[k - 1]!, ds[k]!, ds[k + 1]!).shift;
    }
  }
  const freq = sampleRate / period;
  return freq >= minHz * 0.97 && freq <= maxHz * 1.03 ? { freq, clarity } : null;
}

/** Kept for callers that only want a frequency. */
export function detectPitch(buffer: Float32Array, sampleRate: number): number | null {
  const e = estimatePitch(buffer, sampleRate);
  return e && e.clarity >= 0.8 ? e.freq : null;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function describeFrequency(
  freq: number,
  a4 = 440,
): { note: string; octave: number; midi: number; cents: number } {
  const midiFloat = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  return {
    note: NOTE_NAMES[((midi % 12) + 12) % 12]!,
    octave: Math.floor(midi / 12) - 1,
    midi,
    cents,
  };
}

/**
 * Pitch detection by normalised autocorrelation (McLeod-style simplification).
 * Returns the fundamental frequency in Hz, or null when the signal is too quiet or unclear.
 */
export function detectPitch(buffer: Float32Array, sampleRate: number): number | null {
  const n = buffer.length;
  let rms = 0;
  for (let i = 0; i < n; i += 1) rms += buffer[i]! * buffer[i]!;
  rms = Math.sqrt(rms / n);
  if (rms < 0.01) return null;

  const maxLag = Math.floor(sampleRate / 50); // 50 Hz lowest
  const minLag = Math.floor(sampleRate / 1500); // 1.5 kHz highest
  let bestLag = -1;
  let bestCorr = 0;
  const nsdf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let acf = 0;
    let m = 0;
    for (let i = 0; i < n - lag; i += 1) {
      const a = buffer[i]!;
      const b = buffer[i + lag]!;
      acf += a * b;
      m += a * a + b * b;
    }
    nsdf[lag] = m > 0 ? (2 * acf) / m : 0;
  }
  // Pick the first clear peak after the first zero crossing.
  let lag = minLag;
  while (lag <= maxLag && nsdf[lag]! > 0) lag += 1;
  for (; lag < maxLag; lag += 1) {
    if (nsdf[lag]! > nsdf[lag - 1]! && nsdf[lag]! >= nsdf[lag + 1]! && nsdf[lag]! > bestCorr) {
      bestCorr = nsdf[lag]!;
      bestLag = lag;
      if (bestCorr > 0.9) break;
    }
  }
  if (bestLag === -1 || bestCorr < 0.6) return null;
  // Parabolic interpolation for sub-sample precision.
  const y0 = nsdf[bestLag - 1]!;
  const y1 = nsdf[bestLag]!;
  const y2 = nsdf[bestLag + 1]!;
  const denom = 2 * (2 * y1 - y0 - y2);
  const shift = denom === 0 ? 0 : (y2 - y0) / denom;
  return sampleRate / (bestLag + shift);
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

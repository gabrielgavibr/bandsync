export interface TimeSignature {
  beatsPerBar: number;
  beatUnit: number;
}

export const COMMON_TIME_SIGNATURES: TimeSignature[] = [
  { beatsPerBar: 4, beatUnit: 4 },
  { beatsPerBar: 3, beatUnit: 4 },
  { beatsPerBar: 2, beatUnit: 4 },
  { beatsPerBar: 6, beatUnit: 8 },
  { beatsPerBar: 5, beatUnit: 4 },
  { beatsPerBar: 7, beatUnit: 8 },
  { beatsPerBar: 12, beatUnit: 8 },
];

export function parseTimeSignature(text: string): TimeSignature | null {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/u.exec(text);
  if (!m) return null;
  const beatsPerBar = Number(m[1]);
  const beatUnit = Number(m[2]);
  if (beatsPerBar < 1 || beatsPerBar > 32) return null;
  if (![1, 2, 4, 8, 16].includes(beatUnit)) return null;
  return { beatsPerBar, beatUnit };
}

export function formatTimeSignature(ts: TimeSignature): string {
  return `${ts.beatsPerBar}/${ts.beatUnit}`;
}

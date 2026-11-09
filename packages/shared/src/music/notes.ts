import type { Notation } from "../constants";

/** Pitch class 0..11 where 0 = C. */
export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;
const LATIN_BASE: Record<string, string> = {
  C: "Dó",
  D: "Ré",
  E: "Mi",
  F: "Fá",
  G: "Sol",
  A: "Lá",
  B: "Si",
};
const LATIN_TO_ENGLISH: Record<string, string> = {
  do: "C",
  dó: "C",
  re: "D",
  ré: "D",
  mi: "E",
  fa: "F",
  fá: "F",
  sol: "G",
  la: "A",
  lá: "A",
  si: "B",
};

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Keys conventionally spelled with flats (major keys and their relative minors). */
const FLAT_KEY_PCS_MAJOR = new Set<number>([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb

export function normalizeAccidental(acc: string): number {
  let n = 0;
  for (const ch of acc) {
    if (ch === "#" || ch === "♯") n += 1;
    else if (ch === "b" || ch === "♭") n -= 1;
  }
  return n;
}

/**
 * Parse an English note name like "C", "F#", "Bb", "Ab" or a Latin one like "Ré", "Sib".
 * Returns null when the text is not a note.
 */
export function parseNote(text: string): PitchClass | null {
  const t = text.trim();
  if (!t) return null;
  const m =
    /^([A-Ga-g]|D[oó]|d[oó]|R[eé]|r[eé]|Mi|mi|F[aá]|f[aá]|Sol|sol|L[aá]|l[aá]|Si|si)([#♯b♭]*)$/u.exec(
      t,
    );
  if (!m) return null;
  let letter = m[1]!;
  if (letter.length > 1) {
    const en = LATIN_TO_ENGLISH[letter.toLowerCase()];
    if (!en) return null;
    letter = en;
  } else {
    letter = letter.toUpperCase();
  }
  const base = LETTER_PC[letter];
  if (base === undefined) return null;
  const pc = (((base + normalizeAccidental(m[2] ?? "")) % 12) + 12) % 12;
  return pc as PitchClass;
}

export interface SpellOptions {
  /** Prefer flats over sharps for black keys. */
  flats?: boolean;
  notation?: Notation;
}

export function spellPitchClass(pc: number, opts: SpellOptions = {}): string {
  const idx = (((pc % 12) + 12) % 12) as PitchClass;
  const english = (opts.flats ? FLAT_NAMES : SHARP_NAMES)[idx];
  if (opts.notation === "latin") return toLatin(english);
  return english;
}

/** Convert an English spelled note ("Bb") to Latin ("Sib"). */
export function toLatin(english: string): string {
  const letter = english[0]!;
  const rest = english.slice(1);
  return `${LATIN_BASE[letter] ?? letter}${rest}`;
}

export interface MusicalKey {
  tonic: PitchClass;
  mode: "major" | "minor";
}

/** Parse "D", "Dm", "F#m", "Bb major", "Ré menor", "Am" … */
export function parseKey(text: string): MusicalKey | null {
  const t = text.trim();
  const m = /^(.+?)\s*(m|min|minor|menor|-|maj|major|maior)?$/iu.exec(t);
  if (!m) return null;
  const tonic = parseNote(m[1]!);
  if (tonic === null) return null;
  const q = (m[2] ?? "").toLowerCase();
  const mode =
    q === "m" || q === "min" || q === "minor" || q === "menor" || q === "-" ? "minor" : "major";
  return { tonic, mode };
}

/** Whether a key is conventionally written with flats. */
export function keyPrefersFlats(key: MusicalKey): boolean {
  const majorTonic = key.mode === "major" ? key.tonic : (key.tonic + 3) % 12;
  return FLAT_KEY_PCS_MAJOR.has(majorTonic);
}

export function formatKey(key: MusicalKey, notation: Notation = "english"): string {
  const flats = keyPrefersFlats(key);
  const tonic = spellPitchClass(key.tonic, { flats, notation });
  return key.mode === "minor" ? `${tonic}m` : tonic;
}

export function transposeKey(key: MusicalKey, semitones: number): MusicalKey {
  return { tonic: ((((key.tonic + semitones) % 12) + 12) % 12) as PitchClass, mode: key.mode };
}

/** Signed shortest interval (in semitones, -6..+6) from one key to another. */
export function intervalBetween(from: MusicalKey, to: MusicalKey): number {
  let d = (to.tonic - from.tonic) % 12;
  if (d > 6) d -= 12;
  if (d < -6) d += 12;
  return d;
}

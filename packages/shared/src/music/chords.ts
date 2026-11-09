import type { Notation } from "../constants";
import { keyPrefersFlats, type MusicalKey, parseNote, spellPitchClass } from "./notes";

/**
 * A chord symbol: root + quality suffix + optional bass note.
 * Quality is kept verbatim (m7, maj7, sus4, 7(b9), dim, °, +, add9, …).
 */
export interface ChordSymbol {
  root: number;
  quality: string;
  bass: number | null;
}

const CHORD_RE =
  /^([A-G](?:[#♯b♭])?)((?:maj|min|dim|aug|sus|add|m|M|°|ø|\+|-|\d|\(|\)|#|♯|b|♭|\/(?![A-G]))*)(?:\/([A-G](?:[#♯b♭])?))?$/u;

export function parseChord(token: string): ChordSymbol | null {
  const t = token.trim();
  if (!t) return null;
  const m = CHORD_RE.exec(t);
  if (!m) return null;
  const root = parseNote(m[1]!);
  if (root === null) return null;
  const quality = m[2] ?? "";
  // Reject tokens that are plain words starting with a capital letter (e.g. "Am" is a chord, "Bridge" is not).
  if (/[a-zA-Z]{3,}/u.test(quality.replace(/maj|min|dim|aug|sus|add/gu, ""))) return null;
  const bass = m[3] ? parseNote(m[3]) : null;
  return { root, quality, bass };
}

export interface FormatChordOptions {
  flats?: boolean;
  notation?: Notation;
}

export function formatChord(chord: ChordSymbol, opts: FormatChordOptions = {}): string {
  const root = spellPitchClass(chord.root, opts);
  const bass = chord.bass === null ? "" : `/${spellPitchClass(chord.bass, opts)}`;
  return `${root}${chord.quality}${bass}`;
}

export function transposeChord(chord: ChordSymbol, semitones: number): ChordSymbol {
  const wrap = (n: number) => (((n + semitones) % 12) + 12) % 12;
  return {
    root: wrap(chord.root),
    quality: chord.quality,
    bass: chord.bass === null ? null : wrap(chord.bass),
  };
}

/** Heuristic: a line is a "chord line" when most of its tokens parse as chords. */
export function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return false;
  let chords = 0;
  for (const tk of tokens) {
    if (parseChord(tk) || /^[|:%x\-–—()]+$/u.test(tk)) chords += 1;
  }
  return chords / tokens.length >= 0.6 && tokens.some((tk) => parseChord(tk));
}

export interface TransposeSheetOptions {
  semitones: number;
  /** Target key, used to decide between sharps and flats. If omitted, inferred from semitones direction. */
  targetKey?: MusicalKey | null;
  notation?: Notation;
}

/**
 * Transpose a chord sheet in either of the two supported text formats:
 *  1. "chords over lyrics": lines made mostly of chord tokens, aligned above lyric lines
 *  2. inline bracket chords: "[Am]Some lyric [F]here"
 * Spacing is preserved as much as possible so alignment survives.
 */
export function transposeChordSheet(text: string, opts: TransposeSheetOptions): string {
  const flats = opts.targetKey ? keyPrefersFlats(opts.targetKey) : opts.semitones < 0;
  const fmt = { flats, notation: opts.notation ?? "english" } as const;
  const convert = (token: string): string => {
    const c = parseChord(token);
    if (!c) return token;
    return formatChord(transposeChord(c, opts.semitones), fmt);
  };

  return text
    .split("\n")
    .map((line) => {
      if (line.includes("[")) {
        return line.replace(/\[([^\]\n]+)\]/gu, (whole, inner: string) => {
          const c = parseChord(inner);
          return c ? `[${convert(inner)}]` : whole;
        });
      }
      if (!isChordLine(line)) return line;
      // Replace tokens while preserving whitespace runs.
      return line.replace(/\S+/gu, (tk) => convert(tk));
    })
    .join("\n");
}

/** Re-spell chords (no transposition) into another notation, e.g. for Latin display. */
export function respellChordSheet(text: string, notation: Notation, flats = false): string {
  if (notation === "english") return text;
  const conv = (tk: string) => {
    const c = parseChord(tk);
    return c ? formatChord(c, { notation, flats }) : tk;
  };
  return text
    .split("\n")
    .map((line) => {
      if (line.includes("[")) {
        return line.replace(/\[([^\]\n]+)\]/gu, (w, inner: string) =>
          parseChord(inner) ? `[${conv(inner)}]` : w,
        );
      }
      return isChordLine(line) ? line.replace(/\S+/gu, conv) : line;
    })
    .join("\n");
}

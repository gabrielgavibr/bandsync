/**
 * The band's arrangement as an editable list of sections, independent from the recording's
 * pre-arrangement. Pure functions, so every edit is predictable and testable.
 */
import {
  formatChord,
  parseChord,
  type RecordingArrangementDto,
  type SectionCue,
  type SectionKind,
  type SongSectionDto,
  transposeChord,
} from "@bandsync/shared";

export interface EditableSection {
  /** Local key for React; not stored. */
  key: string;
  name: string;
  kind: SectionKind | null;
  label: string | null;
  bars: number;
  chords: string[];
  cues: SectionCue[];
  notes: string;
  /** Where this part is heard in the reference recording (for listening), when known. */
  startMs: number | null;
  endMs: number | null;
}

let seq = 0;
const nextKey = () => {
  seq += 1;
  return `s${Date.now().toString(36)}${seq}`;
};

const KIND_FROM_GUESS: Record<string, SectionKind | null> = {
  intro: "intro",
  verse: "verse",
  chorus: "chorus",
  bridge: "bridge",
  outro: "outro",
  unknown: null,
};

/** Default names for a section (translated by the caller through `nameFor`). */
export type NameFor = (kind: SectionKind | null, label: string, nth: number) => string;

/** Starts the band's arrangement from the recording's pre-arrangement. */
export function fromPrearrangement(
  pre: RecordingArrangementDto,
  nameFor: NameFor,
  cueText: (type: "stop" | "entry") => string = (type) => type,
): EditableSection[] {
  const seen = new Map<string, number>();
  return pre.data.sections.map((s) => {
    // A functional name only when the analysis had reasonable evidence for it.
    const kind = s.kindConfidence === "medium" ? (KIND_FROM_GUESS[s.kind] ?? null) : null;
    const id = kind ?? `label:${s.label}`;
    const nth = (seen.get(id) ?? 0) + 1;
    seen.set(id, nth);
    const cues: SectionCue[] = s.cues
      .filter((c) => c.type === "stop" || c.type === "entry")
      .map((c) => ({
        type: c.type === "stop" ? ("stop" as const) : ("entry" as const),
        text: cueText(c.type === "stop" ? "stop" : "entry"),
        bar: c.bar + 1,
      }));
    return {
      key: nextKey(),
      name: nameFor(kind, s.label, nth),
      kind,
      label: s.label,
      bars: s.bars,
      chords: s.chords.slice(),
      cues,
      notes: "",
      startMs: Math.round(s.startSec * 1000),
      endMs: Math.round(s.endSec * 1000),
    };
  });
}

export function fromSaved(sections: SongSectionDto[]): EditableSection[] {
  return sections.map((s) => ({
    key: nextKey(),
    name: s.name,
    kind: (s.kind as SectionKind | null) ?? null,
    label: s.label,
    bars: s.bars,
    chords: s.chords.slice(),
    cues: s.cues.slice(),
    notes: s.notes ?? "",
    startMs: s.startMs,
    endMs: s.endMs,
  }));
}

export function toSaved(sections: EditableSection[]) {
  return sections.map((s) => ({
    name: s.name.trim() || "—",
    kind: s.kind,
    label: s.label,
    bars: Math.max(0, Math.min(999, Math.round(s.bars))),
    chords: s.chords.slice(0, 256),
    cues: s.cues,
    notes: s.notes.trim() || null,
    startMs: s.startMs,
    endMs: s.endMs,
  }));
}

export function newSection(name: string): EditableSection {
  return {
    key: nextKey(),
    name,
    kind: null,
    label: null,
    bars: 8,
    chords: [],
    cues: [],
    notes: "",
    startMs: null,
    endMs: null,
  };
}

export const move = (list: EditableSection[], i: number, by: number) => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const out = list.slice();
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

export const remove = (list: EditableSection[], i: number) => list.filter((_, k) => k !== i);

/** Plays the same section again right after (e.g. "repeat the chorus"). */
export function repeat(list: EditableSection[], i: number): EditableSection[] {
  const s = list[i]!;
  const copy = { ...s, key: nextKey(), chords: s.chords.slice(), cues: s.cues.slice() };
  return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
}

/** Splits a section after `atBar` bars; the recording time is divided in proportion. */
export function split(list: EditableSection[], i: number, atBar: number): EditableSection[] {
  const s = list[i]!;
  if (atBar <= 0 || atBar >= s.bars) return list;
  const ratio = atBar / s.bars;
  const mid =
    s.startMs !== null && s.endMs !== null
      ? Math.round(s.startMs + (s.endMs - s.startMs) * ratio)
      : null;
  const first: EditableSection = {
    ...s,
    bars: atBar,
    chords: s.chords.slice(0, atBar),
    cues: s.cues.filter((c) => (c.bar ?? 1) <= atBar),
    endMs: mid ?? s.endMs,
  };
  const second: EditableSection = {
    ...s,
    key: nextKey(),
    name: `${s.name} (2)`,
    bars: s.bars - atBar,
    chords: s.chords.slice(atBar),
    cues: s.cues
      .filter((c) => (c.bar ?? 1) > atBar)
      .map((c) => ({ ...c, bar: (c.bar ?? 1) - atBar })),
    startMs: mid ?? s.startMs,
  };
  return [...list.slice(0, i), first, second, ...list.slice(i + 1)];
}

/** Joins a section with the next one. */
export function mergeWithNext(list: EditableSection[], i: number): EditableSection[] {
  const a = list[i];
  const b = list[i + 1];
  if (!a || !b) return list;
  const merged: EditableSection = {
    ...a,
    bars: a.bars + b.bars,
    chords: [...a.chords, ...b.chords],
    cues: [...a.cues, ...b.cues.map((c) => ({ ...c, bar: (c.bar ?? 1) + a.bars }))],
    notes: [a.notes, b.notes].filter(Boolean).join(" · "),
    endMs: b.endMs ?? a.endMs,
  };
  return [...list.slice(0, i), merged, ...list.slice(i + 2)];
}

/** Shortens or lengthens a section, keeping its chords for the bars that remain. */
export function setBars(list: EditableSection[], i: number, bars: number): EditableSection[] {
  return list.map((s, k) =>
    k === i
      ? {
          ...s,
          bars,
          chords: s.chords.slice(0, Math.max(0, bars)),
          cues: s.cues.filter((c) => (c.bar ?? 1) <= Math.max(1, bars)),
        }
      : s,
  );
}

export function addCue(list: EditableSection[], i: number, cue: SectionCue): EditableSection[] {
  return list.map((s, k) => (k === i ? { ...s, cues: [...s.cues, cue] } : s));
}

/** One chord per bar from text like "Am F C G" (fewer chords than bars repeat the last). */
export function parseChordLine(text: string, bars: number): string[] {
  const tokens = text
    .split(/[\s|,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [];
  return Array.from({ length: bars }, (_, i) => tokens[Math.min(i, tokens.length - 1)]!);
}

/** "Am Am F F" -> "Am F": a section's progression without repeats. */
export const progression = (chords: string[]) =>
  chords.filter((c, i) => c !== "N" && c !== chords[i - 1]);

export function transposeChordLabel(chord: string, semitones: number, flats: boolean): string {
  if (!semitones || chord === "N") return chord;
  const parsed = parseChord(chord);
  return parsed ? formatChord(transposeChord(parsed, semitones), { flats }) : chord;
}

export const totalBars = (list: EditableSection[]) => list.reduce((a, s) => a + s.bars, 0);

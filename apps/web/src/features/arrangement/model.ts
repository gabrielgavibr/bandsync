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

/* ------------------------------------------------------------------ */
/* Limits of a section in the recording, edited while listening        */
/* ------------------------------------------------------------------ */

/** Shortest stretch a section may be given. */
export const MIN_SECTION_MS = 500;
/** Two limits this close are the same boundary (one section ends where the next starts). */
const SHARED_MS = 60;

/** Bars that fit a stretch of the recording, from the length of a bar when it is known. */
export function barsFor(startMs: number, endMs: number, barSeconds: number | null): number | null {
  if (!barSeconds || barSeconds <= 0) return null;
  return Math.max(1, Math.round((endMs - startMs) / 1000 / barSeconds));
}

/** Keeps the section's harmony when its length changes: cut, or carried on in its own cycle. */
function resize(s: EditableSection, bars: number | null): EditableSection {
  if (bars === null || bars === s.bars) return s;
  const chords =
    s.chords.length === 0
      ? []
      : Array.from({ length: bars }, (_, k) => s.chords[k % s.chords.length]!);
  return { ...s, bars, chords, cues: s.cues.filter((c) => (c.bar ?? 1) <= bars) };
}

/**
 * Moves the start and/or the end of a section in the recording. A neighbour that shared the
 * limit moves with it, so no gap or overlap appears; bars follow the new lengths when the bar
 * length is known. Limits never cross: a section keeps at least half a second.
 */
export function setTimes(
  list: EditableSection[],
  i: number,
  patch: { startMs?: number; endMs?: number },
  barSeconds: number | null,
): EditableSection[] {
  const s = list[i];
  if (!s || s.startMs === null || s.endMs === null) return list;
  const prev = list[i - 1];
  const next = list[i + 1];
  const sharesStart =
    !!prev && prev.endMs !== null && Math.abs(prev.endMs - s.startMs) <= SHARED_MS;
  const sharesEnd =
    !!next && next.startMs !== null && Math.abs(next.startMs - s.endMs) <= SHARED_MS;
  // The edge that is not being moved stays where it is; the moved one stops short of it.
  let start = s.startMs;
  let end = s.endMs;
  if (patch.endMs !== undefined) end = Math.round(patch.endMs);
  if (patch.startMs !== undefined) {
    const floor = sharesStart && prev!.startMs !== null ? prev!.startMs + MIN_SECTION_MS : 0;
    const limit = (patch.endMs === undefined ? s.endMs : end) - MIN_SECTION_MS;
    start = Math.max(floor, Math.min(Math.round(patch.startMs), limit));
  }
  const ceil =
    sharesEnd && next!.endMs !== null ? next!.endMs - MIN_SECTION_MS : Number.POSITIVE_INFINITY;
  end = Math.min(ceil, Math.max(end, start + MIN_SECTION_MS));
  if (start === s.startMs && end === s.endMs) return list;
  return list.map((x, k) => {
    if (k === i)
      return resize({ ...x, startMs: start, endMs: end }, barsFor(start, end, barSeconds));
    if (k === i - 1 && sharesStart && start !== s.startMs)
      return resize({ ...x, endMs: start }, barsFor(x.startMs ?? 0, start, barSeconds));
    if (k === i + 1 && sharesEnd && end !== s.endMs)
      return resize({ ...x, startMs: end }, barsFor(end, x.endMs ?? end, barSeconds));
    return x;
  });
}

/** Splits a section at a moment of the recording (e.g. where playback is). */
export function splitAtTime(
  list: EditableSection[],
  i: number,
  ms: number,
  barSeconds: number | null,
): EditableSection[] {
  const s = list[i];
  if (!s || s.startMs === null || s.endMs === null) return list;
  const at = Math.round(ms);
  if (at - s.startMs < MIN_SECTION_MS || s.endMs - at < MIN_SECTION_MS) return list;
  const ratio = (at - s.startMs) / (s.endMs - s.startMs);
  const firstBars = barsFor(s.startMs, at, barSeconds) ?? Math.max(1, Math.round(s.bars * ratio));
  const secondBars =
    barsFor(at, s.endMs, barSeconds) ?? Math.max(1, s.bars - Math.round(s.bars * ratio));
  const cut = Math.min(s.chords.length, firstBars);
  const first: EditableSection = {
    ...s,
    bars: firstBars,
    chords: s.chords.slice(0, cut),
    cues: s.cues.filter((c) => (c.bar ?? 1) <= firstBars),
    endMs: at,
  };
  const second: EditableSection = {
    ...s,
    key: nextKey(),
    name: `${s.name} (2)`,
    bars: secondBars,
    chords: s.chords.slice(cut, cut + secondBars),
    cues: s.cues
      .filter((c) => (c.bar ?? 1) > firstBars)
      .map((c) => ({ ...c, bar: (c.bar ?? 1) - firstBars })),
    startMs: at,
  };
  return [...list.slice(0, i), first, second, ...list.slice(i + 1)];
}

/**
 * A section that is the same loop played several times: the loop's progression and how many
 * times it goes round. Null when the chords are not a whole number of equal loops.
 */
export function loopSummary(
  chords: string[],
  loopBars: number | null | undefined,
): { chords: string[]; times: number } | null {
  if (!loopBars || chords.length < 2 * loopBars || chords.length % loopBars !== 0) return null;
  const rounds: string[] = [];
  for (let i = 0; i < chords.length; i += loopBars)
    rounds.push(progression(chords.slice(i, i + loopBars)).join(" "));
  // Unclear bars ("N") may hide a chord in one round: the most common reading is the loop.
  const counts = new Map<string, number>();
  for (const r of rounds) counts.set(r, (counts.get(r) ?? 0) + 1);
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  if (!best || n < Math.ceil(rounds.length * 0.6)) return null;
  // Every round must be that reading, or the same reading with chords missing.
  const full = best.split(" ");
  const fits = (r: string) => {
    let k = 0;
    for (const c of r.split(" ").filter(Boolean)) {
      k = full.indexOf(c, k);
      if (k < 0) return false;
      k += 1;
    }
    return true;
  };
  return rounds.every(fits) ? { chords: full, times: rounds.length } : null;
}

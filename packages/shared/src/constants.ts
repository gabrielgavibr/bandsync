/**
 * Stable, language-independent identifiers used across API, database and UI.
 * Human-readable labels for these live in the web app's locale files.
 */
export const INSTRUMENTS = [
  "vocals",
  "guitar",
  "bass",
  "drums",
  "keys",
  "percussion",
  "violin",
  "cello",
  "sax",
  "trumpet",
  "trombone",
  "flute",
  "harmonica",
  "dj",
  "other",
] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export const MATERIAL_TYPES = [
  "lyrics",
  "chords",
  "guitar_tab",
  "bass_tab",
  "sheet_music",
  "drum_map",
  "arrangement_map",
  "pdf",
  "audio",
  "video_reference",
  "notes",
] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];

/** Material types whose body is stored as text (vs. a file in R2 or an external URL). */
export const TEXT_MATERIAL_TYPES: readonly MaterialType[] = [
  "lyrics",
  "chords",
  "guitar_tab",
  "bass_tab",
  "drum_map",
  "arrangement_map",
  "notes",
];

/**
 * Default material preference per instrument, used when a member has no explicit preference.
 * Order matters: the first available type wins.
 */
export const DEFAULT_MATERIAL_PREFERENCE: Record<Instrument, MaterialType[]> = {
  vocals: ["lyrics", "chords", "notes"],
  guitar: ["chords", "guitar_tab", "sheet_music", "notes"],
  bass: ["bass_tab", "chords", "sheet_music", "notes"],
  drums: ["drum_map", "arrangement_map", "notes"],
  keys: ["chords", "sheet_music", "notes"],
  percussion: ["arrangement_map", "drum_map", "notes"],
  violin: ["sheet_music", "chords", "notes"],
  cello: ["sheet_music", "chords", "notes"],
  sax: ["sheet_music", "chords", "notes"],
  trumpet: ["sheet_music", "chords", "notes"],
  trombone: ["sheet_music", "chords", "notes"],
  flute: ["sheet_music", "chords", "notes"],
  harmonica: ["chords", "lyrics", "notes"],
  dj: ["arrangement_map", "notes"],
  other: ["chords", "lyrics", "arrangement_map", "notes"],
};

export const BAND_ROLES = ["admin", "member"] as const;
export type BandRole = (typeof BAND_ROLES)[number];

export const REPERTOIRE_KINDS = [
  "general",
  "rehearsal",
  "setlist",
  "in_preparation",
  "custom",
] as const;
export type RepertoireKind = (typeof REPERTOIRE_KINDS)[number];

export const NOTATIONS = ["english", "latin"] as const;
export type Notation = (typeof NOTATIONS)[number];

export const LOCALES = ["pt-BR", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const LIMITS = {
  displayNameMax: 60,
  bandNameMax: 80,
  songTitleMax: 160,
  materialBodyMax: 60_000,
  passwordMin: 8,
  passwordMax: 200,
  bpmMin: 20,
  bpmMax: 400,
  countInBarsMax: 4,
  inviteCodeLength: 8,
  inviteDefaultTtlHours: 72,
  sessionTtlDays: 30,
} as const;

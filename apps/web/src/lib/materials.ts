import {
  DEFAULT_MATERIAL_PREFERENCE,
  INSTRUMENTS,
  type Instrument,
  type SongMaterialDto,
  TEXT_MATERIAL_TYPES,
} from "@bandsync/shared";

/**
 * Resolve the material a musician should see for a song.
 * Walk the instrument's preference order (explicit user preference, then the instrument default):
 * for each type, a material tagged with the musician's instrument wins (ready before pending), then an
 * untagged ready one. So a pending slot for the musician's own part is shown as "pending" instead of
 * being hidden behind shared notes, while ready material of a more preferred type still comes first.
 * Fallbacks: anything tagged for the instrument, any ready lyrics/chords, any ready material, anything.
 */
export function resolvePreferredMaterial(
  materials: SongMaterialDto[],
  instrument: string | null,
  preferences: Record<string, string[]> | undefined,
): SongMaterialDto | null {
  if (materials.length === 0) return null;
  const inst = (INSTRUMENTS as readonly string[]).includes(instrument ?? "")
    ? (instrument as Instrument)
    : "other";
  const isReady = (m: SongMaterialDto) => m.status !== "pending";
  const order = [...(preferences?.[inst] ?? []), ...DEFAULT_MATERIAL_PREFERENCE[inst]];
  for (const type of order) {
    const tagged = materials.filter((m) => m.type === type && m.instrument === inst);
    const best = tagged.find(isReady) ?? tagged[0];
    if (best) return best;
    const generic = materials.find((m) => m.type === type && !m.instrument && isReady(m));
    if (generic) return generic;
  }
  return (
    materials.find((m) => m.instrument === inst) ??
    materials.find((m) => isReady(m) && (m.type === "lyrics" || m.type === "chords")) ??
    materials.find(isReady) ??
    materials[0] ??
    null
  );
}

export function isTextMaterial(type: string): boolean {
  return (TEXT_MATERIAL_TYPES as readonly string[]).includes(type);
}

/** Monospace for anything where column alignment matters. */
export function isMonospaceMaterial(type: string): boolean {
  return (
    type === "chords" ||
    type === "guitar_tab" ||
    type === "bass_tab" ||
    type === "drum_map" ||
    type === "arrangement_map"
  );
}

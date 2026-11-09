import {
  DEFAULT_MATERIAL_PREFERENCE,
  INSTRUMENTS,
  type Instrument,
  type SongMaterialDto,
  TEXT_MATERIAL_TYPES,
} from "@bandsync/shared";

/**
 * Resolve the material a musician should see for a song.
 * Order: explicit user preference for the instrument → default preference for the instrument →
 * any material tagged for the instrument → any lyrics/chords → first material.
 * Materials tagged with the musician's instrument win over untagged ones of the same type.
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
  const order = [...(preferences?.[inst] ?? []), ...DEFAULT_MATERIAL_PREFERENCE[inst]];
  for (const type of order) {
    const tagged = materials.find((m) => m.type === type && m.instrument === inst);
    if (tagged) return tagged;
    const generic = materials.find((m) => m.type === type && !m.instrument);
    if (generic) return generic;
  }
  const anyTagged = materials.find((m) => m.instrument === inst);
  if (anyTagged) return anyTagged;
  const fallback = materials.find((m) => m.type === "lyrics" || m.type === "chords");
  return fallback ?? materials[0] ?? null;
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

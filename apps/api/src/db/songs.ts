import type {
  FactStatus,
  MaterialStatus,
  MetadataSource,
  SectionCue,
  SongDto,
  SongMaterialDto,
  SongReferenceDto,
  SongSectionDto,
} from "@bandsync/shared";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";

interface SongRow {
  id: string;
  band_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  external_id: string | null;
  duration_seconds: number | null;
  original_bpm: number | null;
  original_key: string | null;
  composer: string | null;
  work_mbid: string | null;
  reference_recording: string | null;
  reference_year: number | null;
  original_time_signature: string | null;
  original_bpm_status: FactStatus;
  original_key_status: FactStatus;
  metadata_sources: string;
  created_at: string;
  updated_at: string;
  version_id: string;
  bpm: number | null;
  key: string | null;
  beats_per_bar: number;
  beat_unit: number;
  notes: string | null;
  reference_url: string | null;
  meter_confirmed: number;
}

const SONG_SELECT = `SELECT s.id, s.band_id, s.title, s.artist, s.album, s.external_id, s.duration_seconds, s.original_bpm,
  s.original_key, s.composer, s.work_mbid, s.reference_recording, s.reference_year, s.original_time_signature, s.original_bpm_status,
  s.original_key_status, s.metadata_sources, s.created_at, s.updated_at, v.id AS version_id, v.bpm, v.key, v.beats_per_bar,
  v.beat_unit, v.notes, v.reference_url, v.meter_confirmed
  FROM songs s JOIN song_versions v ON v.song_id = s.id AND v.is_current = 1`;

function parseSources(text: string | null): MetadataSource[] {
  try {
    const v = JSON.parse(text ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function toSongDto(
  r: SongRow,
  sections: SongSectionDto[],
  summary: SongDto["materialSummary"],
  references: SongReferenceDto[] = [],
): SongDto {
  return {
    id: r.id,
    bandId: r.band_id,
    title: r.title,
    artist: r.artist,
    composer: r.composer,
    workMbid: r.work_mbid,
    album: r.album,
    referenceRecording: r.reference_recording,
    referenceYear: r.reference_year,
    externalId: r.external_id,
    durationSeconds: r.duration_seconds,
    originalBpm: r.original_bpm,
    originalBpmStatus: r.original_bpm_status ?? "unknown",
    originalKey: r.original_key,
    originalKeyStatus: r.original_key_status ?? "unknown",
    originalTimeSignature: r.original_time_signature,
    metadataSources: parseSources(r.metadata_sources),
    version: {
      id: r.version_id,
      bpm: r.bpm,
      key: r.key,
      beatsPerBar: r.beats_per_bar,
      beatUnit: r.beat_unit,
      notes: r.notes,
      referenceUrl: r.reference_url,
      meterConfirmed: r.meter_confirmed !== 0,
    },
    sections,
    materialSummary: summary,
    references,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listSongs(db: D1Database, bandId: string): Promise<SongDto[]> {
  const { results } = await db
    .prepare(
      `${SONG_SELECT} WHERE s.band_id = ? AND s.deleted_at IS NULL ORDER BY s.title COLLATE NOCASE`,
    )
    .bind(bandId)
    .all<SongRow>();
  if (results.length === 0) return [];
  const { results: summaries } = await db
    .prepare(
      `SELECT m.song_id, m.type, m.instrument, m.status, COUNT(*) AS count FROM song_materials m
       JOIN songs s ON s.id = m.song_id WHERE s.band_id = ? AND m.deleted_at IS NULL
       GROUP BY m.song_id, m.type, m.instrument, m.status`,
    )
    .bind(bandId)
    .all<{
      song_id: string;
      type: string;
      instrument: string | null;
      status: MaterialStatus;
      count: number;
    }>();
  const byId = new Map<string, SongDto["materialSummary"]>();
  for (const s of summaries) {
    const arr = byId.get(s.song_id) ?? [];
    arr.push({ type: s.type, instrument: s.instrument, status: s.status, count: s.count });
    byId.set(s.song_id, arr);
  }
  return results.map((r) => toSongDto(r, [], byId.get(r.id) ?? []));
}

export async function getSong(
  db: D1Database,
  bandId: string,
  songId: string,
): Promise<SongDto | null> {
  const row = await db
    .prepare(`${SONG_SELECT} WHERE s.band_id = ? AND s.id = ? AND s.deleted_at IS NULL`)
    .bind(bandId, songId)
    .first<SongRow>();
  if (!row) return null;
  const [sections, summary, references] = await Promise.all([
    listSections(db, row.version_id),
    materialSummary(db, songId),
    listReferences(db, songId),
  ]);
  return toSongDto(row, sections, summary, references);
}

/** Minimal song info for the live session (loaded by the Durable Object). */
export async function getSongForSession(db: D1Database, bandId: string, songId: string) {
  const row = await db
    .prepare(`${SONG_SELECT} WHERE s.band_id = ? AND s.id = ? AND s.deleted_at IS NULL`)
    .bind(bandId, songId)
    .first<SongRow>();
  if (!row) return null;
  return {
    songId: row.id,
    versionId: row.version_id,
    title: row.title,
    artist: row.artist,
    bpm: row.bpm,
    originalBpm: row.original_bpm,
    originalBpmStatus: row.original_bpm_status ?? "unknown",
    beatsPerBar: row.beats_per_bar,
    beatUnit: row.beat_unit,
    meterConfirmed: row.meter_confirmed !== 0,
    key: row.key,
  };
}

interface SectionRow {
  id: string;
  name: string;
  position: number;
  bars: number;
  notes: string | null;
  kind: string | null;
  start_ms: number | null;
  end_ms: number | null;
  cues: string;
  origin: string;
}

async function listSections(db: D1Database, versionId: string): Promise<SongSectionDto[]> {
  const { results } = await db
    .prepare(
      "SELECT id, name, position, bars, notes, kind, start_ms, end_ms, cues, origin FROM song_sections WHERE version_id = ? ORDER BY position",
    )
    .bind(versionId)
    .all<SectionRow>();
  return results.map((r) => {
    let cues: SectionCue[] = [];
    try {
      const parsed = JSON.parse(r.cues ?? "[]");
      if (Array.isArray(parsed)) cues = parsed;
    } catch {
      cues = [];
    }
    return {
      id: r.id,
      name: r.name,
      position: r.position,
      bars: r.bars,
      notes: r.notes,
      kind: r.kind,
      startMs: r.start_ms,
      endMs: r.end_ms,
      cues,
      origin: r.origin ?? "band",
    };
  });
}

type SectionInput = NonNullable<SongInput["sections"]>[number];

function insertSection(db: D1Database, versionId: string, s: SectionInput, position: number) {
  return db
    .prepare(
      `INSERT INTO song_sections (id, version_id, name, position, bars, notes, kind, start_ms, end_ms, cues, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'band')`,
    )
    .bind(
      newId(),
      versionId,
      s.name,
      position,
      s.bars,
      s.notes ?? null,
      s.kind ?? null,
      s.startMs ?? null,
      s.endMs ?? null,
      JSON.stringify(s.cues ?? []),
    );
}

async function materialSummary(db: D1Database, songId: string) {
  const { results } = await db
    .prepare(
      "SELECT type, instrument, status, COUNT(*) AS count FROM song_materials WHERE song_id = ? AND deleted_at IS NULL GROUP BY type, instrument, status",
    )
    .bind(songId)
    .all<{ type: string; instrument: string | null; status: MaterialStatus; count: number }>();
  return results;
}

export interface SongInput {
  title: string;
  artist?: string | null;
  composer?: string | null;
  workMbid?: string | null;
  referenceRecording?: string | null;
  referenceYear?: number | null;
  originalBpmStatus?: FactStatus;
  originalKeyStatus?: FactStatus;
  originalTimeSignature?: string | null;
  metadataSources?: MetadataSource[];
  album?: string | null;
  externalId?: string | null;
  durationSeconds?: number | null;
  originalBpm?: number | null;
  originalKey?: string | null;
  version: {
    bpm?: number | null;
    key?: string | null;
    beatsPerBar: number;
    beatUnit: number;
    notes?: string | null;
    referenceUrl?: string | null;
    meterConfirmed?: boolean;
  };
  sections?: {
    name: string;
    bars: number;
    notes?: string | null;
    kind?: string | null;
    startMs?: number | null;
    endMs?: number | null;
    cues?: SectionCue[];
  }[];
}

export async function createSong(
  db: D1Database,
  bandId: string,
  userId: string,
  input: SongInput,
): Promise<string> {
  const id = newId();
  const versionId = newId();
  const ts = nowIso();
  const stmts = [
    db
      .prepare(
        `INSERT INTO songs (id, band_id, title, artist, album, external_id, duration_seconds, original_bpm, original_key,
           composer, reference_recording, reference_year, original_time_signature, original_bpm_status, original_key_status,
           metadata_sources, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        bandId,
        input.title,
        input.artist ?? null,
        input.album ?? null,
        input.externalId ?? null,
        input.durationSeconds ?? null,
        input.originalBpm ?? null,
        input.originalKey ?? null,
        input.composer ?? null,
        input.referenceRecording ?? null,
        input.referenceYear ?? null,
        input.originalTimeSignature ?? null,
        input.originalBpmStatus ?? (input.originalBpm ? "confirmed" : "unknown"),
        input.originalKeyStatus ?? (input.originalKey ? "confirmed" : "unknown"),
        JSON.stringify(input.metadataSources ?? []),
        userId,
        ts,
        ts,
      ),
    db
      .prepare(
        `INSERT INTO song_versions (id, song_id, label, bpm, key, beats_per_bar, beat_unit, notes, reference_url, meter_confirmed,
           is_current, created_at, updated_at)
         VALUES (?, ?, 'band', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        versionId,
        id,
        input.version.bpm ?? null,
        input.version.key ?? null,
        input.version.beatsPerBar,
        input.version.beatUnit,
        input.version.notes ?? null,
        input.version.referenceUrl ?? null,
        input.version.meterConfirmed === false ? 0 : 1,
        ts,
        ts,
      ),
  ];
  (input.sections ?? []).forEach((s, i) => {
    stmts.push(insertSection(db, versionId, s, i));
  });
  await db.batch(stmts);
  return id;
}

export async function updateSong(
  db: D1Database,
  bandId: string,
  songId: string,
  patch: Partial<SongInput>,
): Promise<boolean> {
  const current = await db
    .prepare(`${SONG_SELECT} WHERE s.band_id = ? AND s.id = ? AND s.deleted_at IS NULL`)
    .bind(bandId, songId)
    .first<SongRow>();
  if (!current) return false;
  const ts = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const songSets: string[] = [];
  const songVals: unknown[] = [];
  const fields: [keyof SongInput, string][] = [
    ["title", "title"],
    ["artist", "artist"],
    ["album", "album"],
    ["externalId", "external_id"],
    ["durationSeconds", "duration_seconds"],
    ["originalBpm", "original_bpm"],
    ["originalKey", "original_key"],
    ["composer", "composer"],
    ["workMbid", "work_mbid"],
    ["referenceRecording", "reference_recording"],
    ["referenceYear", "reference_year"],
    ["originalTimeSignature", "original_time_signature"],
    ["originalBpmStatus", "original_bpm_status"],
    ["originalKeyStatus", "original_key_status"],
  ];
  for (const [k, col] of fields) {
    if (patch[k] !== undefined) {
      songSets.push(`${col} = ?`);
      songVals.push(patch[k] ?? null);
    }
  }
  if (patch.metadataSources !== undefined) {
    songSets.push("metadata_sources = ?");
    songVals.push(JSON.stringify(patch.metadataSources));
  }
  songSets.push("updated_at = ?");
  songVals.push(ts, songId);
  stmts.push(db.prepare(`UPDATE songs SET ${songSets.join(", ")} WHERE id = ?`).bind(...songVals));

  if (patch.version) {
    const v = patch.version;
    const vSets: string[] = [];
    const vVals: unknown[] = [];
    if (v.bpm !== undefined) {
      vSets.push("bpm = ?");
      vVals.push(v.bpm);
    }
    if (v.key !== undefined) {
      vSets.push("key = ?");
      vVals.push(v.key);
    }
    if (v.beatsPerBar !== undefined) {
      vSets.push("beats_per_bar = ?");
      vVals.push(v.beatsPerBar);
    }
    if (v.beatUnit !== undefined) {
      vSets.push("beat_unit = ?");
      vVals.push(v.beatUnit);
    }
    if (v.notes !== undefined) {
      vSets.push("notes = ?");
      vVals.push(v.notes);
    }
    if (v.referenceUrl !== undefined) {
      vSets.push("reference_url = ?");
      vVals.push(v.referenceUrl);
    }
    if (v.meterConfirmed !== undefined) {
      vSets.push("meter_confirmed = ?");
      vVals.push(v.meterConfirmed ? 1 : 0);
    }
    if (vSets.length > 0) {
      vSets.push("updated_at = ?");
      vVals.push(ts, current.version_id);
      stmts.push(
        db.prepare(`UPDATE song_versions SET ${vSets.join(", ")} WHERE id = ?`).bind(...vVals),
      );
    }
  }
  if (patch.sections) {
    stmts.push(
      db.prepare("DELETE FROM song_sections WHERE version_id = ?").bind(current.version_id),
    );
    patch.sections.forEach((s, i) => {
      stmts.push(insertSection(db, current.version_id, s, i));
    });
  }
  await db.batch(stmts);
  return true;
}

export async function deleteSong(db: D1Database, bandId: string, songId: string): Promise<boolean> {
  const res = await db
    .prepare(
      "UPDATE songs SET deleted_at = ?, updated_at = ? WHERE band_id = ? AND id = ? AND deleted_at IS NULL",
    )
    .bind(nowIso(), nowIso(), bandId, songId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/* ---------------- materials ---------------- */

interface MaterialRow {
  id: string;
  song_id: string;
  version_id: string;
  type: string;
  title: string;
  instrument: string | null;
  body: string | null;
  external_url: string | null;
  file_id: string | null;
  key: string | null;
  status: MaterialStatus;
  is_example: number;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function toMaterialDto(r: MaterialRow, bandId: string): SongMaterialDto {
  return {
    id: r.id,
    songId: r.song_id,
    versionId: r.version_id,
    type: r.type,
    title: r.title,
    instrument: r.instrument,
    body: r.body,
    externalUrl: r.external_url,
    fileId: r.file_id,
    fileUrl: r.file_id ? `/api/bands/${bandId}/files/${r.file_id}` : null,
    key: r.key,
    status: r.status ?? "ready",
    isExample: r.is_example === 1,
    version: r.version,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listMaterials(
  db: D1Database,
  bandId: string,
  songId: string,
): Promise<SongMaterialDto[]> {
  const { results } = await db
    .prepare(
      `SELECT m.* FROM song_materials m JOIN songs s ON s.id = m.song_id
       WHERE s.band_id = ? AND m.song_id = ? AND m.deleted_at IS NULL ORDER BY m.type, m.instrument, m.title`,
    )
    .bind(bandId, songId)
    .all<MaterialRow>();
  return results.map((r) => toMaterialDto(r, bandId));
}

export async function getMaterial(
  db: D1Database,
  bandId: string,
  songId: string,
  materialId: string,
) {
  const row = await db
    .prepare(
      `SELECT m.* FROM song_materials m JOIN songs s ON s.id = m.song_id
       WHERE s.band_id = ? AND m.song_id = ? AND m.id = ? AND m.deleted_at IS NULL`,
    )
    .bind(bandId, songId, materialId)
    .first<MaterialRow>();
  return row ? toMaterialDto(row, bandId) : null;
}

export interface MaterialInput {
  type: string;
  title: string;
  instrument?: string | null;
  body?: string | null;
  externalUrl?: string | null;
  fileId?: string | null;
  key?: string | null;
  status?: MaterialStatus;
  isExample?: boolean;
  /** "band" (default) or "autoarrange" for slots and drafts created by a preparation job. */
  origin?: "band" | "autoarrange";
  originJobId?: string | null;
}

export async function createMaterial(
  db: D1Database,
  songId: string,
  versionId: string,
  userId: string,
  input: MaterialInput,
): Promise<string> {
  const id = newId();
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO song_materials (id, song_id, version_id, type, title, instrument, body, external_url, file_id, key, status,
         is_example, origin, origin_job_id, version, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(
      id,
      songId,
      versionId,
      input.type,
      input.title,
      input.instrument ?? null,
      input.body ?? null,
      input.externalUrl ?? null,
      input.fileId ?? null,
      input.key ?? null,
      input.status ?? "ready",
      input.isExample ? 1 : 0,
      input.origin ?? "band",
      input.originJobId ?? null,
      userId,
      ts,
      ts,
    )
    .run();
  return id;
}

export async function updateMaterial(
  db: D1Database,
  materialId: string,
  patch: Partial<MaterialInput>,
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const map: [keyof MaterialInput, string][] = [
    ["type", "type"],
    ["title", "title"],
    ["instrument", "instrument"],
    ["body", "body"],
    ["externalUrl", "external_url"],
    ["fileId", "file_id"],
    ["key", "key"],
    ["status", "status"],
  ];
  for (const [k, col] of map) {
    if (patch[k] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(patch[k] ?? null);
    }
  }
  if (patch.isExample !== undefined) {
    sets.push("is_example = ?");
    vals.push(patch.isExample ? 1 : 0);
  }
  if (sets.length === 0) return true;
  sets.push("version = version + 1", "updated_at = ?");
  vals.push(nowIso(), materialId);
  const res = await db
    .prepare(`UPDATE song_materials SET ${sets.join(", ")} WHERE id = ? AND deleted_at IS NULL`)
    .bind(...vals)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteMaterial(db: D1Database, materialId: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE song_materials SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(nowIso(), materialId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/* ---------------- external references ---------------- */

interface ReferenceRow {
  id: string;
  song_id: string;
  kind: string;
  title: string;
  url: string;
  note: string | null;
  position: number;
  created_at: string;
}

function toReferenceDto(r: ReferenceRow): SongReferenceDto {
  return {
    id: r.id,
    songId: r.song_id,
    kind: r.kind,
    title: r.title,
    url: r.url,
    note: r.note,
    position: r.position,
    createdAt: r.created_at,
  };
}

export async function listReferences(db: D1Database, songId: string): Promise<SongReferenceDto[]> {
  const { results } = await db
    .prepare("SELECT * FROM song_references WHERE song_id = ? ORDER BY position, created_at")
    .bind(songId)
    .all<ReferenceRow>();
  return results.map(toReferenceDto);
}

/** Adds a link; the same URL is stored once per song (returns the existing row on repeats). */
export async function addReference(
  db: D1Database,
  songId: string,
  userId: string,
  input: { kind: string; title: string; url: string; note?: string | null },
): Promise<{ reference: SongReferenceDto; created: boolean }> {
  const existing = await db
    .prepare("SELECT * FROM song_references WHERE song_id = ? AND url = ?")
    .bind(songId, input.url)
    .first<ReferenceRow>();
  if (existing) return { reference: toReferenceDto(existing), created: false };
  const max = await db
    .prepare("SELECT COALESCE(MAX(position), -1) AS m FROM song_references WHERE song_id = ?")
    .bind(songId)
    .first<{ m: number }>();
  const row: ReferenceRow = {
    id: newId(),
    song_id: songId,
    kind: input.kind,
    title: input.title,
    url: input.url,
    note: input.note ?? null,
    position: (max?.m ?? -1) + 1,
    created_at: nowIso(),
  };
  await db
    .prepare(
      "INSERT INTO song_references (id, song_id, kind, title, url, note, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      row.id,
      row.song_id,
      row.kind,
      row.title,
      row.url,
      row.note,
      row.position,
      userId,
      row.created_at,
    )
    .run();
  return { reference: toReferenceDto(row), created: true };
}

export async function deleteReference(
  db: D1Database,
  songId: string,
  referenceId: string,
): Promise<boolean> {
  const res = await db
    .prepare("DELETE FROM song_references WHERE song_id = ? AND id = ?")
    .bind(songId, referenceId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

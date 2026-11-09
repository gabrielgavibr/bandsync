import type { SongDto, SongMaterialDto, SongSectionDto } from "@bandsync/shared";
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
  created_at: string;
  updated_at: string;
  version_id: string;
  bpm: number | null;
  key: string | null;
  beats_per_bar: number;
  beat_unit: number;
  notes: string | null;
  reference_url: string | null;
}

const SONG_SELECT = `SELECT s.id, s.band_id, s.title, s.artist, s.album, s.external_id, s.duration_seconds, s.original_bpm,
  s.original_key, s.created_at, s.updated_at, v.id AS version_id, v.bpm, v.key, v.beats_per_bar, v.beat_unit, v.notes, v.reference_url
  FROM songs s JOIN song_versions v ON v.song_id = s.id AND v.is_current = 1`;

function toSongDto(
  r: SongRow,
  sections: SongSectionDto[],
  summary: SongDto["materialSummary"],
): SongDto {
  return {
    id: r.id,
    bandId: r.band_id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    externalId: r.external_id,
    durationSeconds: r.duration_seconds,
    originalBpm: r.original_bpm,
    originalKey: r.original_key,
    version: {
      id: r.version_id,
      bpm: r.bpm,
      key: r.key,
      beatsPerBar: r.beats_per_bar,
      beatUnit: r.beat_unit,
      notes: r.notes,
      referenceUrl: r.reference_url,
    },
    sections,
    materialSummary: summary,
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
      `SELECT m.song_id, m.type, m.instrument, COUNT(*) AS count FROM song_materials m
       JOIN songs s ON s.id = m.song_id WHERE s.band_id = ? AND m.deleted_at IS NULL GROUP BY m.song_id, m.type, m.instrument`,
    )
    .bind(bandId)
    .all<{ song_id: string; type: string; instrument: string | null; count: number }>();
  const byId = new Map<string, SongDto["materialSummary"]>();
  for (const s of summaries) {
    const arr = byId.get(s.song_id) ?? [];
    arr.push({ type: s.type, instrument: s.instrument, count: s.count });
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
  const [sections, summary] = await Promise.all([
    listSections(db, row.version_id),
    materialSummary(db, songId),
  ]);
  return toSongDto(row, sections, summary);
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
    beatsPerBar: row.beats_per_bar,
    beatUnit: row.beat_unit,
    key: row.key,
  };
}

async function listSections(db: D1Database, versionId: string): Promise<SongSectionDto[]> {
  const { results } = await db
    .prepare(
      "SELECT id, name, position, bars, notes FROM song_sections WHERE version_id = ? ORDER BY position",
    )
    .bind(versionId)
    .all<SongSectionDto>();
  return results;
}

async function materialSummary(db: D1Database, songId: string) {
  const { results } = await db
    .prepare(
      "SELECT type, instrument, COUNT(*) AS count FROM song_materials WHERE song_id = ? AND deleted_at IS NULL GROUP BY type, instrument",
    )
    .bind(songId)
    .all<{ type: string; instrument: string | null; count: number }>();
  return results;
}

export interface SongInput {
  title: string;
  artist?: string | null;
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
  };
  sections?: { name: string; bars: number; notes?: string | null }[];
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
        `INSERT INTO songs (id, band_id, title, artist, album, external_id, duration_seconds, original_bpm, original_key, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        userId,
        ts,
        ts,
      ),
    db
      .prepare(
        `INSERT INTO song_versions (id, song_id, label, bpm, key, beats_per_bar, beat_unit, notes, reference_url, is_current, created_at, updated_at)
         VALUES (?, ?, 'band', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
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
        ts,
        ts,
      ),
  ];
  (input.sections ?? []).forEach((s, i) => {
    stmts.push(
      db
        .prepare(
          "INSERT INTO song_sections (id, version_id, name, position, bars, notes) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(newId(), versionId, s.name, i, s.bars, s.notes ?? null),
    );
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
  ];
  for (const [k, col] of fields) {
    if (patch[k] !== undefined) {
      songSets.push(`${col} = ?`);
      songVals.push(patch[k] ?? null);
    }
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
      stmts.push(
        db
          .prepare(
            "INSERT INTO song_sections (id, version_id, name, position, bars, notes) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(newId(), current.version_id, s.name, i, s.bars, s.notes ?? null),
      );
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
      `INSERT INTO song_materials (id, song_id, version_id, type, title, instrument, body, external_url, file_id, key, version, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
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
  ];
  for (const [k, col] of map) {
    if (patch[k] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(patch[k] ?? null);
    }
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

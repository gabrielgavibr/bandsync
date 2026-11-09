import type { RepertoireDto, RepertoireItemDto } from "@bandsync/shared";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";

interface RepRow {
  id: string;
  band_id: string;
  name: string;
  kind: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
}

function toDto(r: RepRow): RepertoireDto {
  return {
    id: r.id,
    bandId: r.band_id,
    name: r.name,
    kind: r.kind,
    description: r.description,
    itemCount: r.item_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const REP_SELECT = `SELECT r.id, r.band_id, r.name, r.kind, r.description, r.created_at, r.updated_at,
  (SELECT COUNT(*) FROM repertoire_items i JOIN songs s ON s.id = i.song_id WHERE i.repertoire_id = r.id AND s.deleted_at IS NULL) AS item_count
  FROM repertoires r`;

export async function listRepertoires(db: D1Database, bandId: string): Promise<RepertoireDto[]> {
  const { results } = await db
    .prepare(`${REP_SELECT} WHERE r.band_id = ? AND r.deleted_at IS NULL ORDER BY r.created_at`)
    .bind(bandId)
    .all<RepRow>();
  return results.map(toDto);
}

export async function getRepertoire(
  db: D1Database,
  bandId: string,
  id: string,
): Promise<RepertoireDto | null> {
  const row = await db
    .prepare(`${REP_SELECT} WHERE r.band_id = ? AND r.id = ? AND r.deleted_at IS NULL`)
    .bind(bandId, id)
    .first<RepRow>();
  if (!row) return null;
  return { ...toDto(row), items: await listItems(db, id) };
}

export async function listItems(
  db: D1Database,
  repertoireId: string,
): Promise<RepertoireItemDto[]> {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.song_id, i.position, i.notes, s.title, s.artist, v.bpm, v.key
       FROM repertoire_items i JOIN songs s ON s.id = i.song_id
       JOIN song_versions v ON v.song_id = s.id AND v.is_current = 1
       WHERE i.repertoire_id = ? AND s.deleted_at IS NULL ORDER BY i.position`,
    )
    .bind(repertoireId)
    .all<{
      id: string;
      song_id: string;
      position: number;
      notes: string | null;
      title: string;
      artist: string | null;
      bpm: number | null;
      key: string | null;
    }>();
  return results.map((r) => ({
    id: r.id,
    songId: r.song_id,
    position: r.position,
    notes: r.notes,
    song: { id: r.song_id, title: r.title, artist: r.artist, bpm: r.bpm, key: r.key },
  }));
}

/** Ordered song ids, used by the live session for next/previous navigation. */
export async function listSongIds(
  db: D1Database,
  bandId: string,
  repertoireId: string,
): Promise<string[] | null> {
  const rep = await db
    .prepare("SELECT id FROM repertoires WHERE id = ? AND band_id = ? AND deleted_at IS NULL")
    .bind(repertoireId, bandId)
    .first();
  if (!rep) return null;
  const { results } = await db
    .prepare(
      `SELECT i.song_id FROM repertoire_items i JOIN songs s ON s.id = i.song_id
       WHERE i.repertoire_id = ? AND s.deleted_at IS NULL ORDER BY i.position`,
    )
    .bind(repertoireId)
    .all<{ song_id: string }>();
  return results.map((r) => r.song_id);
}

export async function createRepertoire(
  db: D1Database,
  bandId: string,
  userId: string,
  input: { name: string; kind: string; description?: string | null },
): Promise<string> {
  const id = newId();
  const ts = nowIso();
  await db
    .prepare(
      "INSERT INTO repertoires (id, band_id, name, kind, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, bandId, input.name, input.kind, input.description ?? null, userId, ts, ts)
    .run();
  return id;
}

export async function updateRepertoire(
  db: D1Database,
  bandId: string,
  id: string,
  patch: { name?: string; kind?: string; description?: string | null },
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name);
  }
  if (patch.kind !== undefined) {
    sets.push("kind = ?");
    vals.push(patch.kind);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    vals.push(patch.description);
  }
  sets.push("updated_at = ?");
  vals.push(nowIso(), bandId, id);
  const res = await db
    .prepare(
      `UPDATE repertoires SET ${sets.join(", ")} WHERE band_id = ? AND id = ? AND deleted_at IS NULL`,
    )
    .bind(...vals)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteRepertoire(
  db: D1Database,
  bandId: string,
  id: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      "UPDATE repertoires SET deleted_at = ? WHERE band_id = ? AND id = ? AND deleted_at IS NULL",
    )
    .bind(nowIso(), bandId, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function addItem(
  db: D1Database,
  repertoireId: string,
  songId: string,
  position: number | undefined,
  notes: string | null,
): Promise<void> {
  const max = await db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) AS m FROM repertoire_items WHERE repertoire_id = ?",
    )
    .bind(repertoireId)
    .first<{ m: number }>();
  const pos = position ?? (max?.m ?? -1) + 1;
  await db
    .prepare(
      `INSERT INTO repertoire_items (id, repertoire_id, song_id, position, notes) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(repertoire_id, song_id) DO UPDATE SET notes = excluded.notes`,
    )
    .bind(newId(), repertoireId, songId, pos, notes)
    .run();
  await db
    .prepare("UPDATE repertoires SET updated_at = ? WHERE id = ?")
    .bind(nowIso(), repertoireId)
    .run();
}

export async function removeItem(
  db: D1Database,
  repertoireId: string,
  songId: string,
): Promise<boolean> {
  const res = await db
    .prepare("DELETE FROM repertoire_items WHERE repertoire_id = ? AND song_id = ?")
    .bind(repertoireId, songId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function reorderItems(
  db: D1Database,
  repertoireId: string,
  songIds: string[],
): Promise<void> {
  const stmts = songIds.map((songId, i) =>
    db
      .prepare("UPDATE repertoire_items SET position = ? WHERE repertoire_id = ? AND song_id = ?")
      .bind(i, repertoireId, songId),
  );
  stmts.push(
    db.prepare("UPDATE repertoires SET updated_at = ? WHERE id = ?").bind(nowIso(), repertoireId),
  );
  await db.batch(stmts);
}

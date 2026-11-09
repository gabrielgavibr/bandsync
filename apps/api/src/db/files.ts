import type { FileDto } from "@bandsync/shared";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";

interface FileRow {
  id: string;
  band_id: string;
  r2_key: string;
  name: string;
  content_type: string;
  size: number;
  created_by: string;
  created_at: string;
}

export function toFileDto(r: FileRow): FileDto {
  return {
    id: r.id,
    bandId: r.band_id,
    name: r.name,
    contentType: r.content_type,
    size: r.size,
    createdBy: r.created_by,
    createdAt: r.created_at,
    url: `/api/bands/${r.band_id}/files/${r.id}`,
  };
}

export async function insertFile(
  db: D1Database,
  input: { bandId: string; name: string; contentType: string; size: number; createdBy: string },
): Promise<FileRow> {
  const id = newId();
  const row: FileRow = {
    id,
    band_id: input.bandId,
    r2_key: `bands/${input.bandId}/${id}`,
    name: input.name,
    content_type: input.contentType,
    size: input.size,
    created_by: input.createdBy,
    created_at: nowIso(),
  };
  await db
    .prepare(
      "INSERT INTO files (id, band_id, r2_key, name, content_type, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      row.id,
      row.band_id,
      row.r2_key,
      row.name,
      row.content_type,
      row.size,
      row.created_by,
      row.created_at,
    )
    .run();
  return row;
}

export async function getFile(
  db: D1Database,
  bandId: string,
  fileId: string,
): Promise<FileRow | null> {
  return db
    .prepare("SELECT * FROM files WHERE band_id = ? AND id = ? AND deleted_at IS NULL")
    .bind(bandId, fileId)
    .first<FileRow>();
}

export async function listFiles(db: D1Database, bandId: string): Promise<FileDto[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM files WHERE band_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200",
    )
    .bind(bandId)
    .all<FileRow>();
  return results.map(toFileDto);
}

export async function softDeleteFile(
  db: D1Database,
  bandId: string,
  fileId: string,
): Promise<boolean> {
  const res = await db
    .prepare("UPDATE files SET deleted_at = ? WHERE band_id = ? AND id = ? AND deleted_at IS NULL")
    .bind(nowIso(), bandId, fileId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

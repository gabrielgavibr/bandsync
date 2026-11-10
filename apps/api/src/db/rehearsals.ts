import type { RehearsalSessionDto } from "@bandsync/shared";
import { nowIso } from "../lib/time";

interface Row {
  id: string;
  band_id: string;
  title: string | null;
  status: string;
  repertoire_id: string | null;
  created_by: string;
  created_at: string;
  ended_at: string | null;
  event_id: string | null;
}

function toDto(r: Row): RehearsalSessionDto {
  return {
    id: r.id,
    bandId: r.band_id,
    title: r.title,
    status: r.status,
    repertoireId: r.repertoire_id,
    eventId: r.event_id ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    endedAt: r.ended_at,
  };
}

export async function insertSession(
  db: D1Database,
  input: {
    id: string;
    bandId: string;
    title: string | null;
    repertoireId: string | null;
    createdBy: string;
    eventId?: string | null;
  },
) {
  await db
    .prepare(
      "INSERT INTO rehearsal_sessions (id, band_id, title, status, repertoire_id, created_by, created_at, event_id) VALUES (?, ?, ?, 'created', ?, ?, ?, ?)",
    )
    .bind(
      input.id,
      input.bandId,
      input.title,
      input.repertoireId,
      input.createdBy,
      nowIso(),
      input.eventId ?? null,
    )
    .run();
}

/** Ties a session that was opened on its own to the rehearsal on the agenda it belongs to. */
export async function linkSessionToEvent(db: D1Database, sessionId: string, eventId: string) {
  await db
    .prepare("UPDATE rehearsal_sessions SET event_id = ? WHERE id = ? AND event_id IS NULL")
    .bind(eventId, sessionId)
    .run();
}

export async function getSession(
  db: D1Database,
  bandId: string,
  id: string,
): Promise<RehearsalSessionDto | null> {
  const row = await db
    .prepare("SELECT * FROM rehearsal_sessions WHERE band_id = ? AND id = ?")
    .bind(bandId, id)
    .first<Row>();
  return row ? toDto(row) : null;
}

export async function listSessions(db: D1Database, bandId: string): Promise<RehearsalSessionDto[]> {
  const { results } = await db
    .prepare("SELECT * FROM rehearsal_sessions WHERE band_id = ? ORDER BY created_at DESC LIMIT 20")
    .bind(bandId)
    .all<Row>();
  return results.map(toDto);
}

export async function findActiveSession(
  db: D1Database,
  bandId: string,
): Promise<RehearsalSessionDto | null> {
  const row = await db
    .prepare(
      "SELECT * FROM rehearsal_sessions WHERE band_id = ? AND status != 'ended' ORDER BY created_at DESC LIMIT 1",
    )
    .bind(bandId)
    .first<Row>();
  return row ? toDto(row) : null;
}

export async function setSessionStatus(db: D1Database, id: string, status: string, ended: boolean) {
  await db
    .prepare(
      "UPDATE rehearsal_sessions SET status = ?, ended_at = CASE WHEN ? THEN ? ELSE ended_at END WHERE id = ?",
    )
    .bind(status, ended ? 1 : 0, nowIso(), id)
    .run();
}

export async function touchParticipant(db: D1Database, sessionId: string, userId: string) {
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO rehearsal_participants (session_id, user_id, first_joined_at, last_seen_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
    .bind(sessionId, userId, ts, ts)
    .run();
}

export async function appendEvent(
  db: D1Database,
  sessionId: string,
  seq: number,
  type: string,
  payload: unknown,
  actorUserId: string | null,
) {
  await db
    .prepare(
      "INSERT INTO rehearsal_events (session_id, seq, type, payload, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      sessionId,
      seq,
      type,
      payload === undefined ? null : JSON.stringify(payload),
      actorUserId,
      nowIso(),
    )
    .run();
}

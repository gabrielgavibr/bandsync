import {
  type AttendanceEntryDto,
  type AttendanceStatus,
  type BoardCommentDto,
  localParts,
  nextWeeklyDates,
  type OccurrenceDto,
  type ScheduleDto,
  zonedToUtc,
} from "@bandsync/shared";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";

/** How many rehearsals of a series exist as rows ahead of time. The rest is the rule. */
export const OCCURRENCES_AHEAD = 4;
/** A rehearsal stays "current" this long after it starts when it has no end time. */
const CURRENT_WINDOW_MS = 6 * 3600 * 1000;

interface ScheduleRow {
  id: string;
  band_id: string;
  title: string;
  weekday: number;
  local_time: string;
  timezone: string;
  start_date: string;
  duration_minutes: number | null;
  location: string | null;
  address: string | null;
  notes: string | null;
  repertoire_id: string | null;
  active: number;
  created_by: string;
}

export function toScheduleDto(r: ScheduleRow): ScheduleDto {
  return {
    id: r.id,
    bandId: r.band_id,
    title: r.title,
    weekday: r.weekday,
    time: r.local_time,
    timezone: r.timezone,
    startDate: r.start_date,
    durationMinutes: r.duration_minutes,
    location: r.location,
    address: r.address,
    notes: r.notes,
    repertoireId: r.repertoire_id,
  };
}

export async function listSchedules(db: D1Database, bandId: string): Promise<ScheduleRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM rehearsal_schedules WHERE band_id = ? AND active = 1 ORDER BY created_at",
    )
    .bind(bandId)
    .all<ScheduleRow>();
  return results;
}

export async function getSchedule(db: D1Database, bandId: string, id: string) {
  return db
    .prepare("SELECT * FROM rehearsal_schedules WHERE band_id = ? AND id = ? AND active = 1")
    .bind(bandId, id)
    .first<ScheduleRow>();
}

export async function insertSchedule(
  db: D1Database,
  bandId: string,
  userId: string,
  input: Omit<ScheduleDto, "id" | "bandId">,
): Promise<string> {
  const id = newId();
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO rehearsal_schedules (id, band_id, title, weekday, local_time, timezone, start_date, duration_minutes,
         location, address, notes, repertoire_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      bandId,
      input.title,
      input.weekday,
      input.time,
      input.timezone,
      input.startDate,
      input.durationMinutes,
      input.location,
      input.address,
      input.notes,
      input.repertoireId,
      userId,
      ts,
      ts,
    )
    .run();
  return id;
}

function instants(date: string, time: string, tz: string, minutes: number | null) {
  const start = zonedToUtc(date, time, tz);
  return {
    startsAt: start.toISOString(),
    endsAt: minutes ? new Date(start.getTime() + minutes * 60_000).toISOString() : null,
  };
}

/** Creates the rows for the next few dates of each series (idempotent). */
export async function materialise(db: D1Database, schedules: ScheduleRow[], now = new Date()) {
  const stmts: D1PreparedStatement[] = [];
  for (const s of schedules) {
    const today = localParts(now, s.timezone).date;
    for (const date of nextWeeklyDates(s.start_date, s.weekday, today, OCCURRENCES_AHEAD)) {
      const { startsAt, endsAt } = instants(date, s.local_time, s.timezone, s.duration_minutes);
      stmts.push(
        db
          .prepare(
            `INSERT INTO events (id, band_id, type, title, starts_at, ends_at, location, description, repertoire_id,
               created_by, created_at, updated_at, schedule_id, series_date, local_date, local_time, timezone)
             VALUES (?, ?, 'rehearsal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(schedule_id, series_date) DO NOTHING`,
          )
          .bind(
            newId(),
            s.band_id,
            s.title,
            startsAt,
            endsAt,
            s.location,
            s.notes,
            s.repertoire_id,
            s.created_by,
            nowIso(),
            nowIso(),
            s.id,
            date,
            date,
            s.local_time,
            s.timezone,
          ),
      );
    }
  }
  if (stmts.length) await db.batch(stmts);
}

/**
 * A change to the series reaches the rehearsals still to come that were not changed on their own.
 * A rehearsal that already has a board, answers or a live session keeps its date; the others
 * follow the rule (removed and created again from it when the weekday or start moved).
 */
export async function applyScheduleToFuture(db: D1Database, s: ScheduleRow, dateMoved: boolean) {
  const now = nowIso();
  const { results } = await db
    .prepare(
      `SELECT e.id, e.series_date,
         (SELECT COUNT(*) FROM rehearsal_comments c WHERE c.event_id = e.id) +
         (SELECT COUNT(*) FROM event_attendance a WHERE a.event_id = e.id) +
         (SELECT COUNT(*) FROM rehearsal_sessions r WHERE r.event_id = e.id) AS activity
       FROM events e WHERE e.schedule_id = ? AND e.detached = 0 AND e.deleted_at IS NULL AND e.starts_at > ?`,
    )
    .bind(s.id, now)
    .all<{ id: string; series_date: string; activity: number }>();
  const stmts: D1PreparedStatement[] = [];
  for (const e of results) {
    if (dateMoved && e.activity === 0) {
      stmts.push(db.prepare("DELETE FROM events WHERE id = ?").bind(e.id));
      continue;
    }
    if (dateMoved) {
      stmts.push(db.prepare("UPDATE events SET detached = 1 WHERE id = ?").bind(e.id));
      continue;
    }
    const { startsAt, endsAt } = instants(
      e.series_date,
      s.local_time,
      s.timezone,
      s.duration_minutes,
    );
    stmts.push(
      db
        .prepare(
          `UPDATE events SET title = ?, starts_at = ?, ends_at = ?, location = ?, description = ?, repertoire_id = ?,
             local_date = ?, local_time = ?, timezone = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(
          s.title,
          startsAt,
          endsAt,
          s.location,
          s.notes,
          s.repertoire_id,
          e.series_date,
          s.local_time,
          s.timezone,
          now,
          e.id,
        ),
    );
  }
  if (stmts.length) await db.batch(stmts);
}

export async function updateSchedule(
  db: D1Database,
  id: string,
  s: Omit<ScheduleDto, "id" | "bandId">,
) {
  await db
    .prepare(
      `UPDATE rehearsal_schedules SET title = ?, weekday = ?, local_time = ?, timezone = ?, start_date = ?,
         duration_minutes = ?, location = ?, address = ?, notes = ?, repertoire_id = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      s.title,
      s.weekday,
      s.time,
      s.timezone,
      s.startDate,
      s.durationMinutes,
      s.location,
      s.address,
      s.notes,
      s.repertoireId,
      nowIso(),
      id,
    )
    .run();
}

/* ---------------- occurrences ---------------- */

interface OccurrenceRow {
  id: string;
  band_id: string;
  schedule_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string | null;
  timezone: string | null;
  local_date: string | null;
  local_time: string | null;
  location: string | null;
  description: string | null;
  repertoire_id: string | null;
  detached: number;
  cancelled_at: string | null;
  session_id: string | null;
  session_status: string | null;
  confirmed: number;
  declined: number;
  answered: number;
  my_status: string | null;
  comment_count: number;
  member_count: number;
}

const OCCURRENCE_SELECT = `SELECT e.*,
  (SELECT r.id FROM rehearsal_sessions r WHERE r.event_id = e.id ORDER BY r.created_at DESC LIMIT 1) AS session_id,
  (SELECT r.status FROM rehearsal_sessions r WHERE r.event_id = e.id ORDER BY r.created_at DESC LIMIT 1) AS session_status,
  (SELECT COUNT(*) FROM event_attendance a JOIN band_members m ON m.user_id = a.user_id AND m.band_id = e.band_id
     WHERE a.event_id = e.id AND a.status = 'confirmed') AS confirmed,
  (SELECT COUNT(*) FROM event_attendance a JOIN band_members m ON m.user_id = a.user_id AND m.band_id = e.band_id
     WHERE a.event_id = e.id AND a.status = 'declined') AS declined,
  (SELECT COUNT(*) FROM event_attendance a JOIN band_members m ON m.user_id = a.user_id AND m.band_id = e.band_id
     WHERE a.event_id = e.id AND a.status != 'pending') AS answered,
  (SELECT a.status FROM event_attendance a WHERE a.event_id = e.id AND a.user_id = ?) AS my_status,
  (SELECT COUNT(*) FROM rehearsal_comments c WHERE c.event_id = e.id AND c.deleted_at IS NULL) AS comment_count,
  (SELECT COUNT(*) FROM band_members m WHERE m.band_id = e.band_id) AS member_count
  FROM events e`;

function toOccurrenceDto(r: OccurrenceRow): OccurrenceDto {
  const tz = r.timezone ?? "America/Sao_Paulo";
  const local = localParts(new Date(r.starts_at), tz);
  return {
    id: r.id,
    bandId: r.band_id,
    scheduleId: r.schedule_id,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    timezone: tz,
    localDate: r.local_date ?? local.date,
    localTime: r.local_time ?? local.time,
    location: r.location,
    notes: r.description,
    repertoireId: r.repertoire_id,
    cancelled: !!r.cancelled_at,
    detached: r.detached === 1,
    session: r.session_id ? { id: r.session_id, status: r.session_status ?? "created" } : null,
    attendance: {
      confirmed: r.confirmed,
      declined: r.declined,
      pending: Math.max(0, r.member_count - r.answered),
    },
    myAttendance: (r.my_status as AttendanceStatus | null) ?? "pending",
    commentCount: r.comment_count,
  };
}

export async function listOccurrences(db: D1Database, bandId: string, userId: string) {
  const boundary = new Date(Date.now() - CURRENT_WINDOW_MS).toISOString();
  const [up, past] = await Promise.all([
    db
      .prepare(
        `${OCCURRENCE_SELECT} WHERE e.band_id = ? AND e.type = 'rehearsal' AND e.deleted_at IS NULL
           AND COALESCE(e.ends_at, e.starts_at) >= ? ORDER BY e.starts_at LIMIT 8`,
      )
      .bind(userId, bandId, boundary)
      .all<OccurrenceRow>(),
    db
      .prepare(
        `${OCCURRENCE_SELECT} WHERE e.band_id = ? AND e.type = 'rehearsal' AND e.deleted_at IS NULL
           AND COALESCE(e.ends_at, e.starts_at) < ? ORDER BY e.starts_at DESC LIMIT 12`,
      )
      .bind(userId, bandId, boundary)
      .all<OccurrenceRow>(),
  ]);
  return { upcoming: up.results.map(toOccurrenceDto), past: past.results.map(toOccurrenceDto) };
}

export async function getOccurrence(
  db: D1Database,
  bandId: string,
  eventId: string,
  userId: string,
): Promise<OccurrenceDto | null> {
  const row = await db
    .prepare(`${OCCURRENCE_SELECT} WHERE e.band_id = ? AND e.id = ? AND e.deleted_at IS NULL`)
    .bind(userId, bandId, eventId)
    .first<OccurrenceRow>();
  return row ? toOccurrenceDto(row) : null;
}

export async function updateOccurrence(
  db: D1Database,
  o: OccurrenceDto,
  patch: {
    title?: string;
    date?: string;
    time?: string;
    durationMinutes?: number | null;
    location?: string | null;
    notes?: string | null;
    repertoireId?: string | null;
    cancelled?: boolean;
  },
) {
  const date = patch.date ?? o.localDate;
  const time = patch.time ?? o.localTime;
  const prevMinutes = o.endsAt
    ? Math.round((new Date(o.endsAt).getTime() - new Date(o.startsAt).getTime()) / 60_000)
    : null;
  const minutes = patch.durationMinutes !== undefined ? patch.durationMinutes : prevMinutes;
  const { startsAt, endsAt } = instants(date, time, o.timezone, minutes);
  await db
    .prepare(
      `UPDATE events SET title = ?, starts_at = ?, ends_at = ?, local_date = ?, local_time = ?, location = ?,
         description = ?, repertoire_id = ?, cancelled_at = ?, detached = 1, updated_at = ? WHERE id = ?`,
    )
    .bind(
      patch.title ?? o.title,
      startsAt,
      endsAt,
      date,
      time,
      patch.location !== undefined ? patch.location : o.location,
      patch.notes !== undefined ? patch.notes : o.notes,
      patch.repertoireId !== undefined ? patch.repertoireId : o.repertoireId,
      patch.cancelled === undefined
        ? o.cancelled
          ? nowIso()
          : null
        : patch.cancelled
          ? nowIso()
          : null,
      nowIso(),
      o.id,
    )
    .run();
}

/* ---------------- attendance ---------------- */

export async function setAttendance(
  db: D1Database,
  eventId: string,
  userId: string,
  status: AttendanceStatus,
) {
  await db
    .prepare(
      `INSERT INTO event_attendance (event_id, user_id, status, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    )
    .bind(eventId, userId, status, nowIso())
    .run();
}

export async function listAttendance(
  db: D1Database,
  bandId: string,
  eventId: string,
): Promise<AttendanceEntryDto[]> {
  const { results } = await db
    .prepare(
      `SELECT m.user_id, u.display_name, m.instrument, COALESCE(a.status, 'pending') AS status
       FROM band_members m JOIN users u ON u.id = m.user_id
       LEFT JOIN event_attendance a ON a.event_id = ? AND a.user_id = m.user_id
       WHERE m.band_id = ? ORDER BY u.display_name COLLATE NOCASE`,
    )
    .bind(eventId, bandId)
    .all<{ user_id: string; display_name: string; instrument: string | null; status: string }>();
  return results.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    instrument: r.instrument,
    status: r.status as AttendanceStatus,
  }));
}

/* ---------------- board ---------------- */

interface CommentRow {
  id: string;
  event_id: string;
  author_id: string;
  body: string;
  song_id: string | null;
  created_at: string;
  edited_at: string | null;
  author_name: string;
  author_avatar: string | null;
  song_title: string | null;
}

export async function listComments(
  db: D1Database,
  bandId: string,
  eventId: string,
  viewer: { userId: string; isAdmin: boolean },
): Promise<BoardCommentDto[]> {
  const { results } = await db
    .prepare(
      `SELECT c.*, u.display_name AS author_name, u.avatar_url AS author_avatar, s.title AS song_title
       FROM rehearsal_comments c JOIN users u ON u.id = c.author_id
       LEFT JOIN songs s ON s.id = c.song_id AND s.deleted_at IS NULL
       WHERE c.band_id = ? AND c.event_id = ? AND c.deleted_at IS NULL
       ORDER BY c.created_at, c.id LIMIT 500`,
    )
    .bind(bandId, eventId)
    .all<CommentRow>();
  return results.map((r) => toCommentDto(r, viewer));
}

function toCommentDto(
  r: CommentRow,
  viewer: { userId: string; isAdmin: boolean },
): BoardCommentDto {
  const mine = r.author_id === viewer.userId;
  return {
    id: r.id,
    eventId: r.event_id,
    author: { id: r.author_id, displayName: r.author_name, avatarUrl: r.author_avatar },
    body: r.body,
    song: r.song_id && r.song_title ? { id: r.song_id, title: r.song_title } : null,
    createdAt: r.created_at,
    editedAt: r.edited_at,
    canEdit: mine,
    canDelete: mine || viewer.isAdmin,
  };
}

export async function insertComment(
  db: D1Database,
  input: { bandId: string; eventId: string; authorId: string; body: string; songId: string | null },
): Promise<string> {
  const id = newId();
  await db
    .prepare(
      `INSERT INTO rehearsal_comments (id, event_id, band_id, author_id, body, song_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.eventId, input.bandId, input.authorId, input.body, input.songId, nowIso())
    .run();
  return id;
}

export async function getComment(db: D1Database, bandId: string, eventId: string, id: string) {
  return db
    .prepare(
      `SELECT c.*, u.display_name AS author_name, u.avatar_url AS author_avatar, s.title AS song_title
       FROM rehearsal_comments c JOIN users u ON u.id = c.author_id
       LEFT JOIN songs s ON s.id = c.song_id AND s.deleted_at IS NULL
       WHERE c.band_id = ? AND c.event_id = ? AND c.id = ? AND c.deleted_at IS NULL`,
    )
    .bind(bandId, eventId, id)
    .first<CommentRow>();
}

export const commentDto = toCommentDto;

export async function editComment(db: D1Database, id: string, body: string, songId: string | null) {
  await db
    .prepare("UPDATE rehearsal_comments SET body = ?, song_id = ?, edited_at = ? WHERE id = ?")
    .bind(body, songId, nowIso(), id)
    .run();
}

/** Hidden, not erased: the row stays for the band's history and audit. */
export async function hideComment(db: D1Database, id: string, by: string) {
  await db
    .prepare("UPDATE rehearsal_comments SET deleted_at = ?, deleted_by = ? WHERE id = ?")
    .bind(nowIso(), by, id)
    .run();
}

export async function songBelongsToBand(db: D1Database, bandId: string, songId: string) {
  const row = await db
    .prepare("SELECT 1 AS ok FROM songs WHERE id = ? AND band_id = ? AND deleted_at IS NULL")
    .bind(songId, bandId)
    .first<{ ok: number }>();
  return !!row;
}

export async function repertoireBelongsToBand(db: D1Database, bandId: string, id: string) {
  const row = await db
    .prepare("SELECT 1 AS ok FROM repertoires WHERE id = ? AND band_id = ? AND deleted_at IS NULL")
    .bind(id, bandId)
    .first<{ ok: number }>();
  return !!row;
}

/** The band's rehearsal happening around now (to tie a session opened from the lobby to it). */
export async function currentOccurrenceId(db: D1Database, bandId: string, now = Date.now()) {
  const row = await db
    .prepare(
      `SELECT id FROM events WHERE band_id = ? AND type = 'rehearsal' AND deleted_at IS NULL AND cancelled_at IS NULL
         AND starts_at BETWEEN ? AND ? ORDER BY ABS(julianday(starts_at) - julianday(?)) LIMIT 1`,
    )
    .bind(
      bandId,
      new Date(now - CURRENT_WINDOW_MS).toISOString(),
      new Date(now + 3 * 3600 * 1000).toISOString(),
      new Date(now).toISOString(),
    )
    .first<{ id: string }>();
  return row?.id ?? null;
}

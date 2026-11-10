import {
  boardCommentSchema,
  createScheduleSchema,
  isValidTimeZone,
  setAttendanceSchema,
  updateOccurrenceSchema,
  updateScheduleSchema,
} from "@bandsync/shared";
import { type Context, Hono } from "hono";
import {
  applyScheduleToFuture,
  commentDto,
  editComment,
  getComment,
  getOccurrence,
  getSchedule,
  hideComment,
  insertComment,
  insertSchedule,
  listAttendance,
  listComments,
  listOccurrences,
  listSchedules,
  materialise,
  repertoireBelongsToBand,
  setAttendance,
  songBelongsToBand,
  toScheduleDto,
  updateOccurrence,
  updateSchedule,
} from "../db/agenda";
import { audit } from "../db/audit";
import { findActiveSession, getSession, insertSession, linkSessionToEvent } from "../db/rehearsals";
import type { AppEnv } from "../env";
import { ApiError, forbidden, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { p } from "../lib/params";
import { rateLimit } from "../lib/ratelimit";
import { parseBody } from "../lib/validate";
import { requireAuth, requireMembership, requirePermission } from "../middleware/auth";

/**
 * The band's agenda: weekly rehearsals (a rule plus the next few dates), attendance and the
 * rehearsal board. Every route checks band membership on the server; changing the agenda needs
 * the "manage events" permission (admins have it), and a comment can be changed only by its
 * author and hidden by its author or an admin.
 */
export const agendaRoutes = new Hono<AppEnv>();
agendaRoutes.use("*", requireAuth, requireMembership);

const requireEvents = requirePermission((m) => m.canManageEvents, "agenda permission required");

async function checkRepertoire(c: Context<AppEnv>, id: string | null | undefined) {
  if (id && !(await repertoireBelongsToBand(c.env.DB, p(c, "bandId"), id))) {
    throw new ApiError("validation_error", "repertoire not found in this band");
  }
}

agendaRoutes.get("/", async (c) => {
  const bandId = p(c, "bandId");
  const schedules = await listSchedules(c.env.DB, bandId);
  await materialise(c.env.DB, schedules);
  const { upcoming, past } = await listOccurrences(c.env.DB, bandId, c.get("user").id);
  return c.json({ schedules: schedules.map(toScheduleDto), upcoming, past });
});

agendaRoutes.post("/schedules", requireEvents, async (c) => {
  const bandId = p(c, "bandId");
  const input = await parseBody(c, createScheduleSchema);
  if (!isValidTimeZone(input.timezone)) throw new ApiError("validation_error", "unknown time zone");
  await checkRepertoire(c, input.repertoireId);
  const id = await insertSchedule(c.env.DB, bandId, c.get("user").id, {
    title: input.title,
    weekday: input.weekday,
    time: input.time,
    timezone: input.timezone,
    startDate: input.startDate,
    durationMinutes: input.durationMinutes ?? null,
    location: input.location ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
    repertoireId: input.repertoireId ?? null,
  });
  const row = (await getSchedule(c.env.DB, bandId, id))!;
  await materialise(c.env.DB, [row]);
  await audit(c.env.DB, {
    bandId,
    actorUserId: c.get("user").id,
    action: "schedule.created",
    targetType: "schedule",
    targetId: id,
  });
  return c.json({ schedule: toScheduleDto(row) }, 201);
});

/** Changes the series: the rehearsals to come follow, unless changed on their own. */
agendaRoutes.patch("/schedules/:scheduleId", requireEvents, async (c) => {
  const bandId = p(c, "bandId");
  const row = await getSchedule(c.env.DB, bandId, p(c, "scheduleId"));
  if (!row) throw notFound("schedule");
  const input = await parseBody(c, updateScheduleSchema);
  if (input.timezone && !isValidTimeZone(input.timezone))
    throw new ApiError("validation_error", "unknown time zone");
  await checkRepertoire(c, input.repertoireId);
  const cur = toScheduleDto(row);
  const next = {
    title: input.title ?? cur.title,
    weekday: input.weekday ?? cur.weekday,
    time: input.time ?? cur.time,
    timezone: input.timezone ?? cur.timezone,
    startDate: input.startDate ?? cur.startDate,
    durationMinutes:
      input.durationMinutes !== undefined ? input.durationMinutes : cur.durationMinutes,
    location: input.location !== undefined ? input.location : cur.location,
    address: input.address !== undefined ? input.address : cur.address,
    notes: input.notes !== undefined ? input.notes : cur.notes,
    repertoireId: input.repertoireId !== undefined ? input.repertoireId : cur.repertoireId,
  };
  await updateSchedule(c.env.DB, row.id, {
    ...next,
    durationMinutes: next.durationMinutes ?? null,
    location: next.location ?? null,
    address: next.address ?? null,
    notes: next.notes ?? null,
    repertoireId: next.repertoireId ?? null,
  });
  const updated = (await getSchedule(c.env.DB, bandId, row.id))!;
  const dateMoved = next.weekday !== cur.weekday || next.startDate !== cur.startDate;
  await applyScheduleToFuture(c.env.DB, updated, dateMoved);
  await materialise(c.env.DB, [updated]);
  await audit(c.env.DB, {
    bandId,
    actorUserId: c.get("user").id,
    action: "schedule.updated",
    targetType: "schedule",
    targetId: row.id,
    metadata: input,
  });
  return c.json({ schedule: toScheduleDto(updated) });
});

/* ---------------- one rehearsal ---------------- */

async function loadOccurrence(c: Context<AppEnv>) {
  const o = await getOccurrence(c.env.DB, p(c, "bandId"), p(c, "eventId"), c.get("user").id);
  if (!o) throw notFound("rehearsal");
  return o;
}

agendaRoutes.get("/occurrences/:eventId", async (c) => {
  const o = await loadOccurrence(c);
  return c.json({
    occurrence: o,
    attendance: await listAttendance(c.env.DB, p(c, "bandId"), o.id),
  });
});

/** Changes this rehearsal only. */
agendaRoutes.patch("/occurrences/:eventId", requireEvents, async (c) => {
  const o = await loadOccurrence(c);
  const input = await parseBody(c, updateOccurrenceSchema);
  await checkRepertoire(c, input.repertoireId);
  await updateOccurrence(c.env.DB, o, input);
  await audit(c.env.DB, {
    bandId: o.bandId,
    actorUserId: c.get("user").id,
    action: "rehearsal.occurrence_updated",
    targetType: "event",
    targetId: o.id,
    metadata: input,
  });
  return c.json({ occurrence: await loadOccurrence(c) });
});

/** Each member answers for themself only. */
agendaRoutes.put("/occurrences/:eventId/attendance", async (c) => {
  const o = await loadOccurrence(c);
  const { status } = await parseBody(c, setAttendanceSchema);
  await setAttendance(c.env.DB, o.id, c.get("user").id, status);
  return c.json({
    occurrence: await loadOccurrence(c),
    attendance: await listAttendance(c.env.DB, o.bandId, o.id),
  });
});

/**
 * Opens (or joins) the live session of this rehearsal. Nothing starts playing and nobody is
 * made conductor for good: the room works as before; the first person with rehearsal control who
 * connects conducts, and an admin or authorised member can take over.
 */
agendaRoutes.post("/occurrences/:eventId/session", async (c) => {
  const m = c.get("membership");
  if (!m.canControlRehearsal) throw forbidden("rehearsal control permission required");
  const o = await loadOccurrence(c);
  if (o.cancelled) throw new ApiError("conflict", "this rehearsal was cancelled");
  const bandId = o.bandId;
  const active = await findActiveSession(c.env.DB, bandId);
  if (active) {
    if (!active.eventId) await linkSessionToEvent(c.env.DB, active.id, o.id);
    return c.json({ session: await getSession(c.env.DB, bandId, active.id), reused: true });
  }
  const id = newId();
  const repertoireId = o.repertoireId;
  await insertSession(c.env.DB, {
    id,
    bandId,
    title: `${o.title}`,
    repertoireId,
    createdBy: m.userId,
    eventId: o.id,
  });
  const stub = c.env.REHEARSAL.get(c.env.REHEARSAL.idFromName(id));
  const res = await stub.fetch("https://do/init", {
    method: "POST",
    body: JSON.stringify({ sessionId: id, bandId, repertoireId, createdBy: m.userId }),
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) throw new ApiError("internal_error", "could not start session");
  await audit(c.env.DB, {
    bandId,
    actorUserId: m.userId,
    action: "rehearsal.created",
    targetType: "session",
    targetId: id,
    metadata: { eventId: o.id },
  });
  return c.json({ session: await getSession(c.env.DB, bandId, id), reused: false }, 201);
});

/* ---------------- the rehearsal board ---------------- */

const viewerOf = (c: Context<AppEnv>) => ({
  userId: c.get("user").id,
  isAdmin: c.get("membership").role === "admin",
});

agendaRoutes.get("/occurrences/:eventId/comments", async (c) => {
  const o = await loadOccurrence(c);
  return c.json({ comments: await listComments(c.env.DB, o.bandId, o.id, viewerOf(c)) });
});

agendaRoutes.post("/occurrences/:eventId/comments", async (c) => {
  await rateLimit(c, "board-post", 60, 10 * 60 * 1000);
  const o = await loadOccurrence(c);
  const input = await parseBody(c, boardCommentSchema);
  if (input.songId && !(await songBelongsToBand(c.env.DB, o.bandId, input.songId))) {
    throw new ApiError("validation_error", "song not found in this band");
  }
  const id = await insertComment(c.env.DB, {
    bandId: o.bandId,
    eventId: o.id,
    authorId: c.get("user").id,
    body: input.body,
    songId: input.songId ?? null,
  });
  const row = (await getComment(c.env.DB, o.bandId, o.id, id))!;
  return c.json({ comment: commentDto(row, viewerOf(c)) }, 201);
});

agendaRoutes.patch("/occurrences/:eventId/comments/:commentId", async (c) => {
  const o = await loadOccurrence(c);
  const row = await getComment(c.env.DB, o.bandId, o.id, p(c, "commentId"));
  if (!row) throw notFound("comment");
  if (row.author_id !== c.get("user").id) throw forbidden("only the author can edit a comment");
  const input = await parseBody(c, boardCommentSchema);
  if (input.songId && !(await songBelongsToBand(c.env.DB, o.bandId, input.songId))) {
    throw new ApiError("validation_error", "song not found in this band");
  }
  await editComment(c.env.DB, row.id, input.body, input.songId ?? null);
  const updated = (await getComment(c.env.DB, o.bandId, o.id, row.id))!;
  return c.json({ comment: commentDto(updated, viewerOf(c)) });
});

agendaRoutes.delete("/occurrences/:eventId/comments/:commentId", async (c) => {
  const o = await loadOccurrence(c);
  const row = await getComment(c.env.DB, o.bandId, o.id, p(c, "commentId"));
  if (!row) throw notFound("comment");
  const v = viewerOf(c);
  if (row.author_id !== v.userId && !v.isAdmin)
    throw forbidden("not allowed to remove this comment");
  await hideComment(c.env.DB, row.id, v.userId);
  if (row.author_id !== v.userId) {
    await audit(c.env.DB, {
      bandId: o.bandId,
      actorUserId: v.userId,
      action: "board.comment_hidden",
      targetType: "comment",
      targetId: row.id,
    });
  }
  return c.json({ ok: true });
});

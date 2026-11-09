import { createRehearsalSchema } from "@bandsync/shared";
import { Hono } from "hono";
import { audit } from "../db/audit";
import { findActiveSession, getSession, insertSession, listSessions } from "../db/rehearsals";
import { identityHeaders } from "../durable/RehearsalSessionDO";
import type { AppEnv } from "../env";
import { ApiError, forbidden, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { p } from "../lib/params";
import { parseBody } from "../lib/validate";
import { requireAuth, requireMembership } from "../middleware/auth";

export const rehearsalRoutes = new Hono<AppEnv>();
rehearsalRoutes.use("*", requireAuth, requireMembership);

rehearsalRoutes.get("/", async (c) => {
  const bandId = p(c, "bandId");
  const [active, recent] = await Promise.all([
    findActiveSession(c.env.DB, bandId),
    listSessions(c.env.DB, bandId),
  ]);
  return c.json({ active, recent });
});

rehearsalRoutes.post("/", async (c) => {
  const bandId = p(c, "bandId");
  const m = c.get("membership");
  if (!m.canControlRehearsal) throw forbidden("rehearsal control permission required");
  const input = await parseBody(c, createRehearsalSchema);
  const existing = await findActiveSession(c.env.DB, bandId);
  if (existing) return c.json({ session: existing, reused: true });
  const id = newId();
  await insertSession(c.env.DB, {
    id,
    bandId,
    title: input.title ?? null,
    repertoireId: input.repertoireId ?? null,
    createdBy: m.userId,
  });
  const stub = c.env.REHEARSAL.get(c.env.REHEARSAL.idFromName(id));
  const res = await stub.fetch("https://do/init", {
    method: "POST",
    body: JSON.stringify({
      sessionId: id,
      bandId,
      repertoireId: input.repertoireId ?? null,
      createdBy: m.userId,
    }),
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) throw new ApiError("internal_error", "could not start session");
  await audit(c.env.DB, {
    bandId,
    actorUserId: m.userId,
    action: "rehearsal.created",
    targetType: "session",
    targetId: id,
  });
  return c.json({ session: await getSession(c.env.DB, bandId, id), reused: false }, 201);
});

rehearsalRoutes.get("/:sessionId", async (c) => {
  const bandId = p(c, "bandId");
  const session = await getSession(c.env.DB, bandId, p(c, "sessionId"));
  if (!session) throw notFound("session");
  const stub = c.env.REHEARSAL.get(c.env.REHEARSAL.idFromName(session.id));
  const res = await stub.fetch("https://do/state");
  const live = res.ok ? await res.json() : null;
  return c.json({ session, live });
});

/** WebSocket upgrade. Authentication happens here (cookie); identity is forwarded to the Durable Object. */
rehearsalRoutes.get("/:sessionId/ws", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    return c.text("expected websocket upgrade", 426);
  }
  const bandId = p(c, "bandId");
  const session = await getSession(c.env.DB, bandId, p(c, "sessionId"));
  if (!session) throw notFound("session");
  if (session.status === "ended") throw new ApiError("conflict", "session has ended");
  const user = c.get("user");
  const m = c.get("membership");
  const stub = c.env.REHEARSAL.get(c.env.REHEARSAL.idFromName(session.id));
  const headers = new Headers(c.req.raw.headers);
  for (const [k, v] of Object.entries(
    identityHeaders({
      userId: user.id,
      displayName: user.displayName,
      instrument: m.instrument ?? user.primaryInstrument,
      avatarUrl: user.avatarUrl,
      isAdmin: m.role === "admin",
      canControl: m.canControlRehearsal,
    }),
  )) {
    headers.set(k, v);
  }
  return stub.fetch("https://do/ws", { headers, method: "GET" });
});

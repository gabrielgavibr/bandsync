import {
  acceptInviteSchema,
  createBandSchema,
  createInviteSchema,
  updateBandSchema,
  updateMemberSchema,
} from "@bandsync/shared";
import { Hono } from "hono";
import { audit } from "../db/audit";
import {
  addMember,
  consumeInvite,
  countAdmins,
  createBand,
  createInvite,
  findInviteByCode,
  getBand,
  getMembership,
  inviteStatus,
  listBandsForUser,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
  toInviteDto,
  updateBand,
  updateMember,
} from "../db/bands";
import type { AppEnv } from "../env";
import { ApiError, forbidden, notFound } from "../lib/errors";
import { createMailer, inviteMail } from "../lib/mailer";
import { p } from "../lib/params";
import { enforceRateLimit, rateLimit } from "../lib/ratelimit";
import { parseBody } from "../lib/validate";
import { requireAdmin, requireAuth, requireMembership } from "../middleware/auth";

export const bandRoutes = new Hono<AppEnv>();
bandRoutes.use("*", requireAuth);

bandRoutes.get("/", async (c) =>
  c.json({ bands: await listBandsForUser(c.env.DB, c.get("user").id) }),
);

bandRoutes.post("/", async (c) => {
  const input = await parseBody(c, createBandSchema);
  const user = c.get("user");
  const id = await createBand(c.env.DB, user.id, input, user.primaryInstrument);
  const m = await getMembership(c.env.DB, id, user.id);
  await audit(c.env.DB, {
    bandId: id,
    actorUserId: user.id,
    action: "band.created",
    targetType: "band",
    targetId: id,
  });
  return c.json({ band: await getBand(c.env.DB, id, m!) }, 201);
});

bandRoutes.get("/:bandId", requireMembership, async (c) => {
  const band = await getBand(c.env.DB, p(c, "bandId"), c.get("membership"));
  if (!band) throw notFound("band");
  return c.json({ band });
});

bandRoutes.patch("/:bandId", requireMembership, requireAdmin, async (c) => {
  const input = await parseBody(c, updateBandSchema);
  const bandId = p(c, "bandId");
  await updateBand(c.env.DB, bandId, input);
  await audit(c.env.DB, {
    bandId,
    actorUserId: c.get("user").id,
    action: "band.updated",
    metadata: input,
  });
  return c.json({ band: await getBand(c.env.DB, bandId, c.get("membership")) });
});

/* ---------------- members ---------------- */

bandRoutes.get("/:bandId/members", requireMembership, async (c) =>
  c.json({ members: await listMembers(c.env.DB, p(c, "bandId")) }),
);

bandRoutes.patch("/:bandId/members/:userId", requireMembership, async (c) => {
  const bandId = p(c, "bandId");
  const targetId = p(c, "userId");
  const me = c.get("membership");
  const input = await parseBody(c, updateMemberSchema);
  const isSelfInstrumentOnly =
    targetId === me.userId && input.role === undefined && input.permissions === undefined;
  if (me.role !== "admin" && !isSelfInstrumentOnly) throw forbidden("admin role required");
  const target = await getMembership(c.env.DB, bandId, targetId);
  if (!target) throw notFound("member");
  if (
    input.role === "member" &&
    target.role === "admin" &&
    (await countAdmins(c.env.DB, bandId)) <= 1
  ) {
    throw new ApiError("conflict", "a band needs at least one admin");
  }
  await updateMember(c.env.DB, bandId, targetId, input);
  await audit(c.env.DB, {
    bandId,
    actorUserId: me.userId,
    action: "member.updated",
    targetType: "user",
    targetId,
    metadata: input,
  });
  return c.json({ members: await listMembers(c.env.DB, bandId) });
});

bandRoutes.delete("/:bandId/members/:userId", requireMembership, async (c) => {
  const bandId = p(c, "bandId");
  const targetId = p(c, "userId");
  const me = c.get("membership");
  if (me.role !== "admin" && targetId !== me.userId) throw forbidden("admin role required");
  const target = await getMembership(c.env.DB, bandId, targetId);
  if (!target) throw notFound("member");
  if (target.role === "admin" && (await countAdmins(c.env.DB, bandId)) <= 1) {
    throw new ApiError("conflict", "a band needs at least one admin");
  }
  await removeMember(c.env.DB, bandId, targetId);
  await audit(c.env.DB, {
    bandId,
    actorUserId: me.userId,
    action: targetId === me.userId ? "member.left" : "member.removed",
    targetType: "user",
    targetId,
  });
  return c.json({ ok: true });
});

/* ---------------- invitations ---------------- */

bandRoutes.get("/:bandId/invites", requireMembership, requireAdmin, async (c) =>
  c.json({ invites: await listInvites(c.env.DB, p(c, "bandId")) }),
);

bandRoutes.post("/:bandId/invites", requireMembership, requireAdmin, async (c) => {
  const bandId = p(c, "bandId");
  await enforceRateLimit(c.env.DB, `invite:${bandId}`, 30, 60 * 60 * 1000);
  const input = await parseBody(c, createInviteSchema);
  if (input.kind === "email" && !input.email)
    throw new ApiError("validation_error", "email is required");
  const user = c.get("user");
  const row = await createInvite(c.env.DB, bandId, user.id, input);
  const band = await getBand(c.env.DB, bandId, c.get("membership"));
  const url = `${c.env.APP_URL}/join/${row.code}`;
  let emailSent = false;
  if (input.kind === "email" && input.email) {
    const mailer = createMailer(c.env);
    await mailer.send(
      inviteMail(input.locale ?? user.locale, input.email, band?.name ?? "BandSync", url),
    );
    emailSent = mailer.configured;
  }
  await audit(c.env.DB, {
    bandId,
    actorUserId: user.id,
    action: "invite.created",
    targetType: "invite",
    targetId: row.id,
    metadata: { kind: input.kind },
  });
  return c.json({ invite: toInviteDto(row), url, emailSent }, 201);
});

bandRoutes.delete("/:bandId/invites/:inviteId", requireMembership, requireAdmin, async (c) => {
  const bandId = p(c, "bandId");
  const ok = await revokeInvite(c.env.DB, bandId, p(c, "inviteId"));
  if (!ok) throw notFound("invite");
  await audit(c.env.DB, {
    bandId,
    actorUserId: c.get("user").id,
    action: "invite.revoked",
    targetType: "invite",
    targetId: p(c, "inviteId"),
  });
  return c.json({ ok: true });
});

/* ---------------- accepting invites (not band-scoped) ---------------- */

export const inviteRoutes = new Hono<AppEnv>();
inviteRoutes.use("*", requireAuth);

inviteRoutes.get("/:code", async (c) => {
  await rateLimit(c, "invite-lookup", 30, 10 * 60 * 1000);
  const inv = await findInviteByCode(c.env.DB, p(c, "code"));
  if (!inv) throw new ApiError("invite_invalid");
  const status = inviteStatus(inv);
  return c.json({
    invite: {
      code: inv.code,
      status,
      role: inv.role,
      instrument: inv.instrument,
      band: { id: inv.band_id, name: inv.band_name, imageUrl: inv.band_image_url },
      invitedBy: inv.inviter_name,
      expiresAt: inv.expires_at,
    },
  });
});

inviteRoutes.post("/accept", async (c) => {
  await rateLimit(c, "invite-accept", 20, 10 * 60 * 1000);
  const { code } = await parseBody(c, acceptInviteSchema);
  const user = c.get("user");
  const inv = await findInviteByCode(c.env.DB, code);
  if (!inv) throw new ApiError("invite_invalid");
  const status = inviteStatus(inv);
  if (status === "revoked") throw new ApiError("invite_revoked");
  if (status === "expired") throw new ApiError("invite_expired");
  if (status === "used") throw new ApiError("invite_used");
  if (inv.email && inv.email.toLowerCase() !== user.email.toLowerCase()) {
    throw forbidden("this invitation was sent to a different e-mail address");
  }
  if (await getMembership(c.env.DB, inv.band_id, user.id)) throw new ApiError("already_member");
  await addMember(
    c.env.DB,
    inv.band_id,
    user.id,
    inv.role,
    inv.instrument ?? user.primaryInstrument,
  );
  await consumeInvite(c.env.DB, inv.id);
  await audit(c.env.DB, {
    bandId: inv.band_id,
    actorUserId: user.id,
    action: "invite.accepted",
    targetType: "invite",
    targetId: inv.id,
  });
  const m = await getMembership(c.env.DB, inv.band_id, user.id);
  return c.json({ band: await getBand(c.env.DB, inv.band_id, m!) });
});

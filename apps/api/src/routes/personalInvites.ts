import { createPersonalInviteSchema, LIMITS, registerByInviteSchema } from "@bandsync/shared";
import { type Context, Hono } from "hono";
import { audit } from "../db/audit";
import { addMember, getBand, getMembership } from "../db/bands";
import {
  claimPersonalInvite,
  createPersonalInvite,
  findPersonalInvite,
  listPersonalInvites,
  type PersonalInviteRow,
  personalStatus,
  releasePersonalInvite,
  revokePersonalInvite,
  toPersonalInviteDto,
  toPreview,
  transferOwnership,
} from "../db/personalInvites";
import {
  createAuthSession,
  createUser,
  findUserByEmail,
  getPreferences,
  toUserDto,
  updateUserProfile,
} from "../db/users";
import type { AppEnv, AuthUser } from "../env";
import { appUrl } from "../lib/appUrl";
import { sessionCookie } from "../lib/cookies";
import { ApiError, notFound } from "../lib/errors";
import { p } from "../lib/params";
import { hashPassword } from "../lib/password";
import { clientIp, enforceRateLimit, rateLimit } from "../lib/ratelimit";
import { parseBody } from "../lib/validate";
import { requireAdmin, requireAuth, requireMembership } from "../middleware/auth";

/** The page a personal link opens (also the path the staging gate lets a valid token through). */
export const personalInvitePath = (token: string) => `/convite/${token}`;

/* ---------------- admin side: /api/bands/:bandId/personal-invites ---------------- */

export const personalInviteAdminRoutes = new Hono<AppEnv>();
personalInviteAdminRoutes.use("*", requireAuth, requireMembership, requireAdmin);

personalInviteAdminRoutes.get("/", async (c) =>
  c.json({ invites: await listPersonalInvites(c.env.DB, p(c, "bandId")) }),
);

personalInviteAdminRoutes.post("/", async (c) => {
  const bandId = p(c, "bandId");
  await enforceRateLimit(c.env.DB, `invite:${bandId}`, 30, 60 * 60 * 1000);
  const input = await parseBody(c, createPersonalInviteSchema);
  const user = c.get("user");
  const { row, token } = await createPersonalInvite(c.env.DB, bandId, user.id, input);
  await audit(c.env.DB, {
    bandId,
    actorUserId: user.id,
    action: "invite.created",
    targetType: "invite",
    targetId: row.id,
    metadata: { kind: "personal", inviteeName: input.inviteeName },
  });
  // The link is returned here and nowhere else: only a hash of its token is kept.
  return c.json(
    { invite: toPersonalInviteDto(row), url: `${appUrl(c)}${personalInvitePath(token)}` },
    201,
  );
});

personalInviteAdminRoutes.delete("/:inviteId", async (c) => {
  const bandId = p(c, "bandId");
  const ok = await revokePersonalInvite(c.env.DB, bandId, p(c, "inviteId"));
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

/* ---------------- invited person: /api/personal-invites/:token ---------------- */

export const personalInviteRoutes = new Hono<AppEnv>();

function assertUsable(inv: PersonalInviteRow) {
  const status = personalStatus(inv);
  if (status === "revoked") throw new ApiError("invite_revoked");
  if (status === "expired") throw new ApiError("invite_expired");
  if (status === "used") throw new ApiError("invite_used");
}

/** Joins the band with what the invitation says, and nothing the client says about roles. */
async function join(
  c: Context<AppEnv>,
  inv: PersonalInviteRow,
  user: AuthUser,
  instrument?: string | null,
) {
  const db = c.env.DB;
  if (await getMembership(db, inv.band_id, user.id)) throw new ApiError("already_member");
  if (!(await claimPersonalInvite(db, inv.id, user.id))) throw new ApiError("invite_used");
  try {
    await addMember(
      db,
      inv.band_id,
      user.id,
      inv.role,
      instrument ?? inv.instrument ?? user.primaryInstrument,
    );
    if (inv.grants_ownership === 1) {
      await transferOwnership(db, inv.band_id, inv.created_by, user.id);
    }
  } catch (err) {
    await releasePersonalInvite(db, inv.id, user.id);
    throw err;
  }
  await audit(db, {
    bandId: inv.band_id,
    actorUserId: user.id,
    action: "invite.accepted",
    targetType: "invite",
    targetId: inv.id,
    metadata: { kind: "personal", ownership: inv.grants_ownership === 1 },
  });
  const m = await getMembership(db, inv.band_id, user.id);
  return getBand(db, inv.band_id, m!);
}

personalInviteRoutes.get("/:token", async (c) => {
  await rateLimit(c, "pinvite-lookup", 60, 10 * 60 * 1000);
  const inv = await findPersonalInvite(c.env.DB, p(c, "token"));
  if (!inv) throw new ApiError("invite_invalid");
  return c.json({ invite: toPreview(inv) });
});

/** Someone who already has an account (and is signed in) takes the invitation. */
personalInviteRoutes.post("/:token/accept", requireAuth, async (c) => {
  await rateLimit(c, "pinvite-accept", 20, 10 * 60 * 1000);
  const inv = await findPersonalInvite(c.env.DB, p(c, "token"));
  if (!inv) throw new ApiError("invite_invalid");
  assertUsable(inv);
  const band = await join(c, inv, c.get("user"));
  return c.json({ band });
});

/** Someone new creates their own account (their e-mail, their password) and joins in one step. */
personalInviteRoutes.post("/:token/register", async (c) => {
  await rateLimit(c, "pinvite-register", 20, 60 * 60 * 1000);
  const inv = await findPersonalInvite(c.env.DB, p(c, "token"));
  if (!inv) throw new ApiError("invite_invalid");
  assertUsable(inv);
  const input = await parseBody(c, registerByInviteSchema);
  if (await findUserByEmail(c.env.DB, input.email)) {
    throw new ApiError("email_in_use", "e-mail already registered");
  }
  const iterations = Number(c.env.PBKDF2_ITERATIONS ?? "100000") || 100000;
  const instrument = input.instrument ?? inv.instrument;
  const user = await createUser(c.env.DB, {
    email: input.email,
    passwordHash: await hashPassword(input.password, iterations),
    displayName: input.displayName ?? inv.invitee_name,
    primaryInstrument: instrument,
    locale: input.locale ?? "pt-BR",
  });
  const secondary = toPreview({
    ...inv,
    band_name: "",
    band_image_url: null,
  }).secondaryInstruments.filter((i) => i !== instrument);
  if (secondary.length > 0) {
    await updateUserProfile(c.env.DB, user.id, { secondaryInstruments: secondary });
    user.secondaryInstruments = secondary;
  }
  await audit(c.env.DB, { bandId: null, actorUserId: user.id, action: "user.registered" });
  const band = await join(c, inv, user, instrument);
  const session = await createAuthSession(
    c.env.DB,
    user.id,
    { userAgent: c.req.header("user-agent") ?? null, ip: clientIp(c.req.raw) },
    LIMITS.sessionTtlDays,
  );
  c.header(
    "set-cookie",
    sessionCookie(
      session.token,
      LIMITS.sessionTtlDays * 24 * 3600,
      c.req.url.startsWith("https://"),
    ),
  );
  return c.json(
    { user: toUserDto(user), preferences: await getPreferences(c.env.DB, user.id), band },
    201,
  );
});

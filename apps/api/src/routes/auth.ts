import {
  forgotPasswordSchema,
  LIMITS,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@bandsync/shared";
import { type Context, Hono } from "hono";
import { audit } from "../db/audit";
import {
  consumePasswordReset,
  createAuthSession,
  createPasswordReset,
  createUser,
  deleteAllUserSessions,
  deleteAuthSession,
  findUserByEmail,
  getPreferences,
  toAuthUser,
  toUserDto,
  updatePasswordHash,
} from "../db/users";
import type { AppEnv } from "../env";
import { appUrl, exposesDevLinks } from "../lib/appUrl";
import { clearSessionCookie, sessionCookie } from "../lib/cookies";
import { ApiError } from "../lib/errors";
import { log } from "../lib/logger";
import { createMailer, resetPasswordMail } from "../lib/mailer";
import { hashPassword, verifyPassword } from "../lib/password";
import { clientIp, rateLimit } from "../lib/ratelimit";
import { parseBody } from "../lib/validate";
import { requireAuth } from "../middleware/auth";

export const authRoutes = new Hono<AppEnv>();

const iterationsOf = (env: AppEnv["Bindings"]) =>
  Number(env.PBKDF2_ITERATIONS ?? "100000") || 100000;
const isSecure = (url: string) => url.startsWith("https://");

async function issueSession(c: Context<AppEnv>, userId: string) {
  const session = await createAuthSession(
    c.env.DB,
    userId,
    { userAgent: c.req.header("user-agent") ?? null, ip: clientIp(c.req.raw) },
    LIMITS.sessionTtlDays,
  );
  c.header(
    "set-cookie",
    sessionCookie(session.token, LIMITS.sessionTtlDays * 24 * 3600, isSecure(c.req.url)),
  );
}

authRoutes.post("/register", async (c) => {
  await rateLimit(c, "register", 30, 60 * 60 * 1000);
  const input = await parseBody(c, registerSchema);
  const existing = await findUserByEmail(c.env.DB, input.email);
  if (existing) throw new ApiError("email_in_use", "e-mail already registered");
  const passwordHash = await hashPassword(input.password, iterationsOf(c.env));
  const user = await createUser(c.env.DB, {
    email: input.email,
    passwordHash,
    displayName: input.displayName,
    primaryInstrument: input.primaryInstrument ?? null,
    locale: input.locale ?? "en",
  });
  await issueSession(c, user.id);
  await audit(c.env.DB, { bandId: null, actorUserId: user.id, action: "user.registered" });
  return c.json(
    { user: toUserDto(user), preferences: await getPreferences(c.env.DB, user.id) },
    201,
  );
});

authRoutes.post("/login", async (c) => {
  await rateLimit(c, "login", 20, 15 * 60 * 1000);
  const input = await parseBody(c, loginSchema);
  const row = await findUserByEmail(c.env.DB, input.email);
  // Verify against a dummy hash when the user is unknown so timing does not leak existence.
  const ok = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw new ApiError("invalid_credentials", "invalid e-mail or password");
  const user = toAuthUser(row);
  await issueSession(c, user.id);
  return c.json({ user: toUserDto(user), preferences: await getPreferences(c.env.DB, user.id) });
});

authRoutes.post("/logout", requireAuth, async (c) => {
  await deleteAuthSession(c.env.DB, c.get("sessionId"));
  c.header("set-cookie", clearSessionCookie(isSecure(c.req.url)));
  return c.json({ ok: true });
});

authRoutes.post("/forgot-password", async (c) => {
  await rateLimit(c, "forgot", 5, 60 * 60 * 1000);
  const input = await parseBody(c, forgotPasswordSchema);
  const row = await findUserByEmail(c.env.DB, input.email);
  let devResetUrl: string | undefined;
  if (row) {
    const token = await createPasswordReset(c.env.DB, row.id);
    const url = `${appUrl(c)}/reset-password?token=${encodeURIComponent(token)}`;
    const mailer = createMailer(c.env);
    await mailer.send(resetPasswordMail(row.locale, row.email, url));
    // Never on shared environments: anyone could reset anyone else's password from the screen.
    if (!mailer.configured && exposesDevLinks(c.env.APP_ENV)) devResetUrl = url;
    log("info", "auth.reset_requested", { userId: row.id });
  }
  // Always the same answer so e-mail addresses cannot be probed.
  return c.json({ ok: true, ...(devResetUrl ? { devResetUrl } : {}) });
});

authRoutes.post("/reset-password", async (c) => {
  await rateLimit(c, "reset", 10, 60 * 60 * 1000);
  const input = await parseBody(c, resetPasswordSchema);
  const userId = await consumePasswordReset(c.env.DB, input.token);
  if (!userId) throw new ApiError("invite_invalid", "reset link is invalid or expired");
  await updatePasswordHash(
    c.env.DB,
    userId,
    await hashPassword(input.password, iterationsOf(c.env)),
  );
  await deleteAllUserSessions(c.env.DB, userId);
  await audit(c.env.DB, { bandId: null, actorUserId: userId, action: "user.password_reset" });
  return c.json({ ok: true });
});

// A valid PBKDF2 hash of a random password, used to equalise timing for unknown e-mails.
const DUMMY_HASH =
  "pbkdf2$sha256$1000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

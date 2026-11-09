import type { MiddlewareHandler } from "hono";
import { getMembership } from "../db/bands";
import { findAuthSession } from "../db/users";
import type { AppEnv, Membership } from "../env";
import { parseCookies, SESSION_COOKIE } from "../lib/cookies";
import { forbidden, notFound, unauthorized } from "../lib/errors";

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = parseCookies(c.req.header("cookie"))[SESSION_COOKIE];
  if (!token) throw unauthorized();
  const found = await findAuthSession(c.env.DB, token);
  if (!found) throw unauthorized();
  c.set("user", found.user);
  c.set("sessionId", found.sessionId);
  await next();
};

/** Loads the caller's membership for `:bandId`; non-members get 404 so band ids are not enumerable. */
export const requireMembership: MiddlewareHandler<AppEnv> = async (c, next) => {
  const bandId = c.req.param("bandId");
  if (!bandId) throw notFound("band");
  const m = await getMembership(c.env.DB, bandId, c.get("user").id);
  if (!m) throw notFound("band");
  c.set("membership", m);
  await next();
};

export function requirePermission(
  check: (m: Membership) => boolean,
  why: string,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!check(c.get("membership"))) throw forbidden(why);
    await next();
  };
}

export const requireAdmin = requirePermission((m) => m.role === "admin", "admin role required");
export const requireRepertoireEditor = requirePermission(
  (m) => m.canEditRepertoire,
  "repertoire permission required",
);

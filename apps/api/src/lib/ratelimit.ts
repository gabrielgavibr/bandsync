import type { Context } from "hono";
import type { AppEnv } from "../env";
import { ApiError } from "./errors";

/**
 * Fixed-window rate limiter backed by D1. Good enough for login/register/invite abuse protection;
 * a Durable Object or Cloudflare's Rate Limiting binding can replace it later without API changes.
 */
export async function enforceRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const row = await db
    .prepare("SELECT window_start, count FROM rate_limits WHERE key = ?")
    .bind(key)
    .first<{ window_start: number; count: number }>();
  if (!row || row.window_start !== windowStart) {
    await db
      .prepare(
        "INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1",
      )
      .bind(key, windowStart)
      .run();
    return;
  }
  if (row.count >= limit) {
    throw new ApiError("rate_limited", "too many requests, try again later");
  }
  await db.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
}

/**
 * Route-level helper.
 * - `RATE_LIMITS=off` (local development, where every client arrives through the Vite proxy as
 *   127.0.0.1) disables limiting entirely. Production must keep it on.
 * - Under APP_ENV=test the limiter is skipped unless the request opts in with `x-test-ratelimit: 1`,
 *   so functional tests can create many users while one test still covers limiting.
 */
export async function rateLimit(
  c: Context<AppEnv>,
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  if (c.env.RATE_LIMITS === "off") return;
  if (c.env.APP_ENV === "test" && c.req.header("x-test-ratelimit") !== "1") return;
  await enforceRateLimit(c.env.DB, `${bucket}:${clientIp(c.req.raw)}`, limit, windowMs);
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}

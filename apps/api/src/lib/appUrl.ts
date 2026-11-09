import type { Context } from "hono";
import type { AppEnv } from "../env";

/**
 * Public base URL used in invitation and password-reset links.
 * Falls back to the request's own origin when APP_URL is empty, which is the case for
 * environments whose URL is only known after the first deploy (e.g. *.workers.dev staging).
 */
export function appUrl(c: Context<AppEnv>): string {
  const configured = (c.env.APP_URL ?? "").trim().replace(/\/$/, "");
  return configured || new URL(c.req.url).origin;
}

/** Reset links are shown on screen only where e-mail is impossible AND nobody else uses the data. */
export function exposesDevLinks(appEnv: string): boolean {
  return appEnv === "development" || appEnv === "test";
}

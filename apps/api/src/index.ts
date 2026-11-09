import { Hono } from "hono";
import type { AppEnv } from "./env";
import { appUrl } from "./lib/appUrl";
import { ApiError } from "./lib/errors";
import { newId } from "./lib/ids";
import { log } from "./lib/logger";
import { stagingGate } from "./middleware/stagingGate";
import { authRoutes } from "./routes/auth";
import { bandRoutes, inviteRoutes } from "./routes/bands";
import { fileRoutes } from "./routes/files";
import { meRoutes } from "./routes/me";
import { rehearsalRoutes } from "./routes/rehearsals";
import { repertoireRoutes } from "./routes/repertoires";
import { songRoutes } from "./routes/songs";

export { RehearsalSessionDO } from "./durable/RehearsalSessionDO";

const app = new Hono<AppEnv>();

/* Request id + structured access log */
app.use("*", async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? newId();
  c.set("requestId", requestId);
  const started = Date.now();
  await next();
  c.header("x-request-id", requestId);
  if (c.req.path.startsWith("/api/") && c.env.APP_ENV !== "test") {
    log("info", "http.request", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    });
  }
});

/* Pre-production access gate (no-op unless STAGING_ACCESS_KEY is set). */
app.use("*", stagingGate);

/* Same-origin guard for state-changing requests (defence in depth on top of SameSite cookies). */
app.use("/api/*", async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("origin");
    if (origin) {
      const expected = new URL(c.req.url).origin;
      const allowed = new Set([expected, appUrl(c)]);
      if (!allowed.has(origin)) throw new ApiError("forbidden", "cross-origin request rejected");
    }
  }
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "same-origin");
  await next();
});

app.get("/api/health", (c) =>
  c.json({ ok: true, env: c.env.APP_ENV, time: new Date().toISOString() }),
);

app.route("/api/auth", authRoutes);
app.route("/api/me", meRoutes);
app.route("/api/bands", bandRoutes);
app.route("/api/invites", inviteRoutes);
app.route("/api/bands/:bandId/songs", songRoutes);
app.route("/api/bands/:bandId/repertoires", repertoireRoutes);
app.route("/api/bands/:bandId/rehearsals", rehearsalRoutes);
app.route("/api/bands/:bandId/files", fileRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/") && c.env.APP_ENV !== "test") {
    return c.json({ error: { code: "not_found", message: "route not found" } }, 404);
  }
  // Non-API paths are served by the static assets binding (SPA). Without it (tests), 404.
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text("not found", 404);
});

app.onError((err, c) => {
  if (err instanceof ApiError) {
    if (err.status >= 500)
      log("error", "http.error", { requestId: c.get("requestId"), error: err.message });
    return c.json(err.toBody(), err.status as 400);
  }
  log("error", "http.unhandled", {
    requestId: c.get("requestId"),
    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return c.json({ error: { code: "internal_error", message: "unexpected error" } }, 500);
});

export default app;

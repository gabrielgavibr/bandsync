import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../src/env";
import { stagingGate } from "../src/middleware/stagingGate";
import { api, json, register } from "./helpers";

const KEY = "ABCD-EFGH-JKLM-NPQR";

function gated() {
  const app = new Hono<AppEnv>();
  app.use("*", stagingGate);
  app.get("/api/ping", (c) => c.json({ ok: true }));
  app.get("*", (c) => c.text("app shell"));
  const bindings = {
    ...env,
    STAGING_ACCESS_KEY: KEY,
    RATE_LIMITS: "off",
  } as unknown as AppEnv["Bindings"];
  return (path: string, init?: RequestInit) =>
    app.request(`https://stg.example${path}`, init, bindings);
}

describe("staging access gate", () => {
  it("redirects pages and blocks the API without the access cookie", async () => {
    const req = gated();
    const page = await req("/bands?x=1");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/__access?next=%2Fbands%3Fx%3D1");
    expect(page.headers.get("x-robots-tag")).toContain("noindex");
    const apiRes = await req("/api/ping");
    expect(apiRes.status).toBe(403);
    const form = await req("/__access", { headers: { "accept-language": "pt-BR" } });
    expect(form.status).toBe(200);
    expect(await form.text()).toContain("Chave de acesso");
  });

  it("rejects a wrong key and accepts the right one (case-insensitive), then lets everything through", async () => {
    const req = gated();
    const bad = await req("/__access", {
      method: "POST",
      body: new URLSearchParams({ key: "WRONG-KEY", next: "/bands" }),
    });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();

    const good = await req("/__access", {
      method: "POST",
      body: new URLSearchParams({ key: KEY.toLowerCase(), next: "/bands" }),
    });
    expect(good.status).toBe(303);
    expect(good.headers.get("location")).toBe("/bands");
    const setCookie = good.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).not.toContain(KEY);
    const cookie = setCookie.split(";")[0]!;
    expect((await req("/api/ping", { headers: { cookie } })).status).toBe(200);
    expect(await (await req("/songs", { headers: { cookie } })).text()).toBe("app shell");
  });

  it("never redirects to another site after login", async () => {
    const req = gated();
    const res = await req("/__access", {
      method: "POST",
      body: new URLSearchParams({ key: KEY, next: "//evil.example/x" }),
    });
    expect(res.headers.get("location")).toBe("/");
  });

  it("is inactive when no access key is configured", async () => {
    const res = await api("GET", "/api/health");
    expect(res.status).toBe(200);
  });
});

describe("password reset links on shared environments", () => {
  it("are shown only in development and test", async () => {
    const s = await register();
    const res = await api("POST", "/api/auth/forgot-password", { email: s.email });
    expect((await json(res)).devResetUrl).toContain("/reset-password?token=");
    const { exposesDevLinks } = await import("../src/lib/appUrl");
    expect(exposesDevLinks("staging")).toBe(false);
    expect(exposesDevLinks("production")).toBe(false);
    expect(exposesDevLinks("development")).toBe(true);
  });
});

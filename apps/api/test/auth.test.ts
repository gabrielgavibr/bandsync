import { describe, expect, it } from "vitest";
import { api, cookieOf, json, register } from "./helpers";

describe("auth", () => {
  it("registers, returns the user and sets an HttpOnly session cookie", async () => {
    const res = await api("POST", "/api/auth/register", {
      email: "Ana@Example.com",
      password: "a-strong-password",
      displayName: "Ana",
      locale: "pt-BR",
      primaryInstrument: "drums",
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.user.email).toBe("ana@example.com");
    expect(body.user.primaryInstrument).toBe("drums");
    expect(body.preferences.locale).toBe("pt-BR");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("bs_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    const me = await api("GET", "/api/me", undefined, cookieOf(res));
    expect(me.status).toBe(200);
    expect((await json(me)).user.displayName).toBe("Ana");
  });

  it("rejects weak input with a stable error code", async () => {
    const res = await api("POST", "/api/auth/register", {
      email: "nope",
      password: "123",
      displayName: "",
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe("validation_error");
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it("refuses duplicate e-mails", async () => {
    const s = await register();
    const res = await api("POST", "/api/auth/register", {
      email: s.email,
      password: "another-password",
      displayName: "Dup",
    });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("email_in_use");
  });

  it("logs in with the right password and rejects the wrong one", async () => {
    const s = await register();
    const bad = await api("POST", "/api/auth/login", {
      email: s.email,
      password: "wrong-password-here",
    });
    expect(bad.status).toBe(401);
    expect((await json(bad)).error.code).toBe("invalid_credentials");
    const unknown = await api("POST", "/api/auth/login", {
      email: "ghost@example.com",
      password: "whatever-pass",
    });
    expect(unknown.status).toBe(401);
    const good = await api("POST", "/api/auth/login", {
      email: s.email,
      password: "correct-horse-battery",
    });
    expect(good.status).toBe(200);
    expect(cookieOf(good)).toContain("bs_session=");
  });

  it("logs out and invalidates the session", async () => {
    const s = await register();
    const out = await api("POST", "/api/auth/logout", undefined, s.cookie);
    expect(out.status).toBe(200);
    const me = await api("GET", "/api/me", undefined, s.cookie);
    expect(me.status).toBe(401);
  });

  it("requires authentication for protected routes", async () => {
    const res = await api("GET", "/api/bands");
    expect(res.status).toBe(401);
    expect((await json(res)).error.code).toBe("unauthorized");
  });

  it("resets a password through the e-mail link flow (dev mode exposes the link)", async () => {
    const s = await register();
    const forgot = await api("POST", "/api/auth/forgot-password", { email: s.email });
    expect(forgot.status).toBe(200);
    const { devResetUrl } = await json(forgot);
    expect(typeof devResetUrl).toBe("string");
    const token = new URL(devResetUrl).searchParams.get("token")!;
    const reset = await api("POST", "/api/auth/reset-password", {
      token,
      password: "brand-new-password",
    });
    expect(reset.status).toBe(200);
    // Old sessions are revoked, new password works.
    expect((await api("GET", "/api/me", undefined, s.cookie)).status).toBe(401);
    const login = await api("POST", "/api/auth/login", {
      email: s.email,
      password: "brand-new-password",
    });
    expect(login.status).toBe(200);
    // Token is single use.
    const again = await api("POST", "/api/auth/reset-password", {
      token,
      password: "yet-another-password",
    });
    expect(again.status).toBe(404);
  });

  it("does not reveal whether an e-mail exists on forgot-password", async () => {
    const res = await api("POST", "/api/auth/forgot-password", { email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect((await json(res)).devResetUrl).toBeUndefined();
  });

  it("updates profile and preferences", async () => {
    const s = await register();
    const patch = await api(
      "PATCH",
      "/api/me",
      { displayName: "New Name", secondaryInstruments: ["bass"] },
      s.cookie,
    );
    expect(patch.status).toBe(200);
    expect((await json(patch)).user.secondaryInstruments).toEqual(["bass"]);
    const prefs = await api(
      "PATCH",
      "/api/me/preferences",
      {
        locale: "pt-BR",
        notation: "latin",
        materialPreferences: { guitar: ["guitar_tab", "chords"] },
      },
      s.cookie,
    );
    expect(prefs.status).toBe(200);
    const body = await json(prefs);
    expect(body.preferences.locale).toBe("pt-BR");
    expect(body.preferences.notation).toBe("latin");
    expect(body.preferences.materialPreferences.guitar).toEqual(["guitar_tab", "chords"]);
  });

  it("keeps tuner settings per person, with defaults, and refuses values out of range", async () => {
    const ana = await register();
    const bruno = await register();
    const me = async (cookie: string) =>
      (await json(await api("GET", "/api/me", undefined, cookie))).preferences;
    expect(await me(ana.cookie)).toMatchObject({ tunerSensitivity: 50, tunerA4: 440 });
    const saved = await api(
      "PATCH",
      "/api/me/preferences",
      { tunerSensitivity: 85, tunerA4: 442 },
      ana.cookie,
    );
    expect(saved.status).toBe(200);
    expect((await json(saved)).preferences).toMatchObject({ tunerSensitivity: 85, tunerA4: 442 });
    // Another setting saved later leaves them alone; another person is not affected.
    await api("PATCH", "/api/me/preferences", { notation: "latin" }, ana.cookie);
    expect(await me(ana.cookie)).toMatchObject({
      tunerSensitivity: 85,
      tunerA4: 442,
      notation: "latin",
    });
    expect(await me(bruno.cookie)).toMatchObject({ tunerSensitivity: 50, tunerA4: 440 });
    for (const bad of [
      { tunerSensitivity: 101 },
      { tunerSensitivity: 2.5 },
      { tunerA4: 300 },
      { tunerA4: 500 },
    ])
      expect((await api("PATCH", "/api/me/preferences", bad, ana.cookie)).status).toBe(400);
  });

  it("rejects cross-origin state-changing requests", async () => {
    const res = await api(
      "POST",
      "/api/auth/login",
      { email: "x@example.com", password: "password123" },
      undefined,
      {
        origin: "https://evil.example",
      },
    );
    expect(res.status).toBe(403);
  });
});

describe("rate limiting", () => {
  it("limits repeated login attempts from one address", async () => {
    let last = 0;
    for (let i = 0; i < 25; i += 1) {
      const res = await api(
        "POST",
        "/api/auth/login",
        { email: "ghost@example.com", password: "whatever-pass" },
        undefined,
        { "x-test-ratelimit": "1", "cf-connecting-ip": "203.0.113.7" },
      );
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

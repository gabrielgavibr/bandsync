import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  request,
} from "@playwright/test";

export const API = process.env.E2E_BASE_URL ?? "http://localhost:5173";
export const PASSWORD = "e2e-password-123";

export interface User {
  email: string;
  displayName: string;
  instrument: string;
  id: string;
  api: APIRequestContext;
}

export async function registerUser(
  displayName: string,
  instrument: string,
  locale = "en",
): Promise<User> {
  // Each simulated musician comes from its own address so the per-IP registration limiter is not shared.
  const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  const api = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { "x-forwarded-for": ip },
  });
  const email = `${displayName.toLowerCase().replace(/\s+/g, ".")}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.test`;
  const res = await api.post("/api/auth/register", {
    data: { email, password: PASSWORD, displayName, primaryInstrument: instrument, locale },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { email, displayName, instrument, id: body.user.id, api };
}

/** Opens a browser context already signed in as the user (cookie copied from the API context). */
export async function contextFor(
  browser: Browser,
  user: User,
  options: Parameters<Browser["newContext"]>[0] = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(options);
  const { cookies } = await user.api.storageState();
  await context.addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      url: API,
      httpOnly: c.httpOnly,
      secure: false,
      sameSite: c.sameSite,
    })),
  );
  const page = await context.newPage();
  return { context, page };
}

export async function createBand(owner: User, name: string): Promise<string> {
  const res = await owner.api.post("/api/bands", { data: { name } });
  expect(res.status()).toBe(201);
  return (await res.json()).band.id;
}

export async function inviteCode(
  owner: User,
  bandId: string,
  instrument?: string,
): Promise<string> {
  const res = await owner.api.post(`/api/bands/${bandId}/invites`, {
    data: { kind: "code", instrument },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).invite.code;
}

export async function join(user: User, code: string) {
  const res = await user.api.post("/api/invites/accept", { data: { code } });
  expect(res.status(), await res.text()).toBe(200);
}

export async function createSong(
  owner: User,
  bandId: string,
  title: string,
  bpm: number,
  materials: { type: string; instrument: string | null; body: string }[],
): Promise<string> {
  const res = await owner.api.post(`/api/bands/${bandId}/songs`, {
    data: {
      title,
      artist: "E2E Band",
      version: { bpm, key: "C", beatsPerBar: 4, beatUnit: 4 },
      sections: [
        { name: "Intro", bars: 4 },
        { name: "Verse", bars: 8 },
      ],
    },
  });
  expect(res.status()).toBe(201);
  const songId = (await res.json()).song.id as string;
  for (const m of materials) {
    const r = await owner.api.post(`/api/bands/${bandId}/songs/${songId}/materials`, {
      data: { type: m.type, title: m.type, instrument: m.instrument, body: m.body },
    });
    expect(r.status()).toBe(201);
  }
  return songId;
}

export async function createRepertoire(
  owner: User,
  bandId: string,
  name: string,
  songIds: string[],
): Promise<string> {
  const res = await owner.api.post(`/api/bands/${bandId}/repertoires`, {
    data: { name, kind: "rehearsal" },
  });
  expect(res.status()).toBe(201);
  const id = (await res.json()).repertoire.id as string;
  for (const songId of songIds)
    await owner.api.post(`/api/bands/${bandId}/repertoires/${id}/items`, { data: { songId } });
  return id;
}

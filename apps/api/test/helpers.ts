import { SELF } from "cloudflare:test";

export const BASE = "http://bandsync.test";

export interface Session {
  cookie: string;
  userId: string;
  email: string;
}

let counter = 0;

export async function api(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export function cookieOf(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}

export async function register(
  overrides: Partial<{
    email: string;
    displayName: string;
    primaryInstrument: string;
    locale: string;
  }> = {},
): Promise<Session> {
  counter += 1;
  const email = overrides.email ?? `user${counter}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const res = await api("POST", "/api/auth/register", {
    email,
    password: "correct-horse-battery",
    displayName: overrides.displayName ?? `User ${counter}`,
    primaryInstrument: overrides.primaryInstrument ?? "guitar",
    locale: overrides.locale ?? "en",
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const body = await json(res);
  return { cookie: cookieOf(res), userId: body.user.id, email };
}

export async function createBand(s: Session, name = "Test Band"): Promise<string> {
  const res = await api("POST", "/api/bands", { name }, s.cookie);
  if (res.status !== 201) throw new Error(`createBand failed: ${res.status} ${await res.text()}`);
  return (await json(res)).band.id as string;
}

export async function joinByCode(
  admin: Session,
  bandId: string,
  joiner: Session,
  instrument?: string,
) {
  const inv = await api(
    "POST",
    `/api/bands/${bandId}/invites`,
    { kind: "code", instrument },
    admin.cookie,
  );
  const { invite } = await json(inv);
  const acc = await api("POST", "/api/invites/accept", { code: invite.code }, joiner.cookie);
  if (acc.status !== 200) throw new Error(`accept failed: ${acc.status} ${await acc.text()}`);
}

export async function createSong(
  s: Session,
  bandId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const res = await api("POST", `/api/bands/${bandId}/songs`, input, s.cookie);
  if (res.status !== 201) throw new Error(`createSong failed: ${res.status} ${await res.text()}`);
  return (await json(res)).song.id as string;
}

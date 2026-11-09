/**
 * Minimal BandSync REST client for the maintenance scripts: staging access gate, login and a
 * cookie jar. Reads its target and credentials from the environment, never from the source.
 *
 *   BANDSYNC_URL, BANDSYNC_EMAIL, BANDSYNC_PASSWORD
 *   BANDSYNC_BAND (default "Sala 3"), BANDSYNC_ACCESS_KEY (staging gate),
 *   BANDSYNC_CREDENTIALS=path to .staging/credentials.txt (reads the access key and Ana's password)
 */
import { readFileSync } from "node:fs";

export async function connect() {
  const base = process.env.BANDSYNC_URL?.replace(/\/$/, "");
  let email = process.env.BANDSYNC_EMAIL;
  let password = process.env.BANDSYNC_PASSWORD;
  let accessKey = process.env.BANDSYNC_ACCESS_KEY;
  const bandName = process.env.BANDSYNC_BAND ?? "Sala 3";
  if (process.env.BANDSYNC_CREDENTIALS) {
    const text = readFileSync(process.env.BANDSYNC_CREDENTIALS, "utf8");
    accessKey ??= /Access key[^:]*:\s*(\S+)/.exec(text)?.[1];
    email ??= "ana@bandsync.demo";
    password ??= new RegExp(`${email.replace(/\./g, "\\.")}\\s+(\\S+)`).exec(text)?.[1];
  }
  if (!base || !email || !password) {
    console.error(
      "Set BANDSYNC_URL, BANDSYNC_EMAIL and BANDSYNC_PASSWORD (or BANDSYNC_CREDENTIALS).",
    );
    process.exit(2);
  }

  const jar = new Map();
  const remember = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  /** Calls the API; throws on a non-2xx answer unless `allow` lists that status. */
  async function call(method, path, body, allow = []) {
    const res = await fetch(`${base}${path}`, {
      method,
      redirect: "manual",
      headers: {
        cookie: cookie(),
        origin: base,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    remember(res);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok && !allow.includes(res.status))
      throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return allow.length ? { status: res.status, body: json } : json;
  }

  // Staging gate (only when a key is given), then login.
  if (accessKey) {
    const res = await fetch(`${base}/__access`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key: accessKey, next: "/" }),
    });
    remember(res);
    if (res.status !== 303) throw new Error(`access gate refused the key (${res.status})`);
  }
  await call("POST", "/api/auth/login", { email, password });

  const { bands } = await call("GET", "/api/bands");
  const band = bands.find((b) => b.name === bandName);
  if (!band) throw new Error(`band "${bandName}" not found for ${email}`);
  if (!band.myPermissions.canEditRepertoire)
    throw new Error(`${email} cannot edit the repertoire of "${bandName}"`);

  return { base, email, bandName, band, call, bandPath: `/api/bands/${band.id}` };
}

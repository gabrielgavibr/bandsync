import type { MiddlewareHandler } from "hono";
import { findPersonalInvite, personalStatus } from "../db/personalInvites";
import type { AppEnv } from "../env";
import { parseCookies } from "../lib/cookies";
import { clientIp, enforceRateLimit } from "../lib/ratelimit";

/**
 * Pre-production access gate.
 *
 * Active only when the STAGING_ACCESS_KEY secret is set. Every request (pages, assets, API and
 * WebSocket upgrades) must carry the `bs_access` cookie, obtained once by typing the access key on
 * /__access. The cookie holds an HMAC of a fixed label keyed with the access key, so the key itself
 * never travels after the first form post, and rotating the secret invalidates every cookie.
 * This sits in front of the normal BandSync login; it does not replace it.
 */
export const ACCESS_COOKIE = "bs_access";
const ACCESS_PATH = "/__access";
const COOKIE_MAX_AGE = 30 * 24 * 3600;

async function accessToken(key: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    k,
    new TextEncoder().encode("bandsync-staging-access-v1"),
  );
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const INVITE_PATH = /^\/convite\/([A-Za-z0-9_-]{32,64})$/;

function accessCookie(token: string, secure: boolean): string {
  return [
    `${ACCESS_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function safeNext(raw: string | null | undefined): string {
  if (!raw?.startsWith("/") || raw.startsWith("//") || raw.startsWith(ACCESS_PATH)) return "/";
  return raw;
}

function page(lang: "pt-BR" | "en", next: string, failed: boolean): string {
  const t =
    lang === "pt-BR"
      ? {
          title: "BandSync · Homologação",
          body: "Este é um ambiente de homologação privado. Digite a chave de acesso que você recebeu.",
          label: "Chave de acesso",
          submit: "Entrar",
          error: "Chave inválida. Tente de novo.",
        }
      : {
          title: "BandSync · Staging",
          body: "This is a private staging environment. Enter the access key you were given.",
          label: "Access key",
          submit: "Continue",
          error: "Invalid key. Try again.",
        };
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${t.title}</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0f14;color:#e9edf1}
main{width:min(92vw,24rem);padding:1.5rem;border:1px solid #212a35;border-radius:1rem;background:#121820}
h1{font-size:1.25rem;margin:.75rem 0 .25rem}p{color:#94a1b0;margin:.25rem 0 1rem;line-height:1.4}
label{display:block;font-size:.9rem;margin-bottom:.4rem}input{box-sizing:border-box;width:100%;height:3rem;border-radius:.75rem;border:1px solid #212a35;background:#070a0e;color:inherit;padding:0 .9rem;font:inherit;font-family:ui-monospace,Menlo,monospace;letter-spacing:.05em}
button{margin-top:1rem;width:100%;height:3rem;border:0;border-radius:.75rem;background:#14b8a6;color:#04221f;font:inherit;font-weight:600}.err{color:#f87171}</style></head>
<body><main><svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#070a0e"/><g stroke="#2dd4bf" stroke-width="5" stroke-linecap="round"><line x1="14" y1="26" x2="14" y2="38"/><line x1="26" y1="18" x2="26" y2="46"/><line x1="38" y1="22" x2="38" y2="42"/><line x1="50" y1="28" x2="50" y2="36"/></g></svg>
<h1>${t.title}</h1><p>${t.body}</p>${failed ? `<p class="err" role="alert">${t.error}</p>` : ""}
<form method="post" action="${ACCESS_PATH}"><input type="hidden" name="next" value="${esc(next)}"><label for="k">${t.label}</label>
<input id="k" name="key" autocomplete="off" autocapitalize="characters" spellcheck="false" required autofocus><button type="submit">${t.submit}</button></form></main></body></html>`;
}

function langOf(acceptLanguage: string | undefined): "pt-BR" | "en" {
  return (acceptLanguage ?? "").toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

export const stagingGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = c.env.STAGING_ACCESS_KEY?.trim();
  if (!key) return next();
  c.header("x-robots-tag", "noindex, nofollow");
  const expected = await accessToken(key);
  const url = new URL(c.req.url);
  const lang = langOf(c.req.header("accept-language"));
  const secure = url.protocol === "https:";

  if (url.pathname === ACCESS_PATH) {
    if (c.req.method === "POST") {
      if (c.env.RATE_LIMITS !== "off") {
        await enforceRateLimit(
          c.env.DB,
          `staging-access:${clientIp(c.req.raw)}`,
          10,
          15 * 60 * 1000,
        );
      }
      const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
      const given = typeof form.key === "string" ? form.key.trim().toUpperCase() : "";
      const target = safeNext(typeof form.next === "string" ? form.next : null);
      if (given && safeEqual(await accessToken(given), expected)) {
        return new Response(null, {
          status: 303,
          headers: { location: target, "set-cookie": accessCookie(expected, secure) },
        });
      }
      return c.html(page(lang, target, true), 401);
    }
    return c.html(page(lang, safeNext(url.searchParams.get("next")), false));
  }

  const presented = parseCookies(c.req.header("cookie"))[ACCESS_COOKIE] ?? "";
  if (presented && safeEqual(presented, expected)) return next();

  // A personal invitation link is its own key: the invited musician opens it on their phone and
  // reaches the sign-up page without knowing the shared key. Only links that exist, were not
  // revoked and are still valid (or were already accepted, so the same person can come back on
  // another device) open the gate; the gate then works as if the key had been typed. Data stays
  // behind the normal login and band membership.
  const invite = INVITE_PATH.exec(url.pathname);
  if (invite && (c.req.method === "GET" || c.req.method === "HEAD")) {
    if (c.env.RATE_LIMITS !== "off") {
      await enforceRateLimit(c.env.DB, `staging-invite:${clientIp(c.req.raw)}`, 30, 15 * 60 * 1000);
    }
    const row = await findPersonalInvite(c.env.DB, invite[1]!);
    const status = row ? personalStatus(row) : null;
    if (status === "active" || status === "used") {
      return new Response(null, {
        status: 302,
        headers: {
          location: url.pathname,
          "set-cookie": accessCookie(expected, secure),
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      });
    }
  }

  if (url.pathname.startsWith("/api/")) {
    return c.json({ error: { code: "forbidden", message: "staging access required" } }, 403);
  }
  // Pages and assets: send people to the access form, remembering where they were going.
  return c.redirect(`${ACCESS_PATH}?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
};

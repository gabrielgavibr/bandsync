import { DurableObject } from "cloudflare:workers";
import { MUSICBRAINZ_BASE_URL } from "@bandsync/shared";
import type { Env } from "../env";
import { sha256Hex } from "../lib/ids";
import { log } from "../lib/logger";

const DEFAULT_MIN_INTERVAL_MS = 1100;
const MAX_UPSTREAM_ATTEMPTS = 3;
const CACHE_PREFIX = "c:";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;

interface CacheEntry {
  at: number;
  body: string;
}

/**
 * Single gateway for every MusicBrainz request made by BandSync.
 *
 * MusicBrainz asks clients to stay at or below one request per second and to identify themselves
 * (https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting). One Durable Object instance
 * ("global") serialises the calls with a minimum gap, retries the service's 503 throttling
 * responses with a growing delay, and caches successful answers so repeated searches and the
 * preview → prepare sequence do not hit the service again.
 */
export class MusicBrainzGatewayDO extends DurableObject<Env> {
  private chain: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const target = url.searchParams.get("target");
    const ttlMs = Math.min(
      CACHE_MAX_AGE_MS,
      Math.max(0, Number(url.searchParams.get("ttl") ?? "0") * 1000),
    );
    const base = (this.env.MUSICBRAINZ_BASE_URL || MUSICBRAINZ_BASE_URL).replace(/\/$/, "");
    if (!target || !target.startsWith(`${base}/ws/2/`))
      return new Response("bad target", { status: 400 });

    const key = `${CACHE_PREFIX}${await sha256Hex(target)}`;
    if (ttlMs > 0) {
      const hit = await this.ctx.storage.get<CacheEntry>(key);
      if (hit && Date.now() - hit.at < ttlMs) {
        return new Response(hit.body, {
          headers: { "content-type": "application/json", "x-bs-cache": "hit" },
        });
      }
    }

    const run = this.chain.then(
      () => this.call(target),
      () => this.call(target),
    );
    this.chain = run.catch(() => undefined);
    const result = await run;
    if (result.status === 200 && ttlMs > 0) {
      await this.ctx.storage.put<CacheEntry>(key, { at: Date.now(), body: result.body });
      if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now() + CACHE_MAX_AGE_MS);
    }
    return new Response(result.body, {
      status: result.status,
      headers: { "content-type": "application/json", "x-bs-cache": "miss" },
    });
  }

  /** Drops expired cache entries. */
  override async alarm(): Promise<void> {
    const entries = await this.ctx.storage.list<CacheEntry>({ prefix: CACHE_PREFIX, limit: 500 });
    const stale: string[] = [];
    for (const [k, v] of entries) if (Date.now() - v.at >= CACHE_MAX_AGE_MS) stale.push(k);
    if (stale.length > 0) await this.ctx.storage.delete(stale);
    if (entries.size > stale.length)
      await this.ctx.storage.setAlarm(Date.now() + CACHE_MAX_AGE_MS / 4);
  }

  private async call(target: string): Promise<{ status: number; body: string }> {
    const minInterval = Number(this.env.MUSICBRAINZ_MIN_INTERVAL_MS ?? DEFAULT_MIN_INTERVAL_MS);
    const contact = this.env.MUSICBRAINZ_CONTACT || "https://github.com/gabrielgavibr/bandsync";
    let last = { status: 503, body: JSON.stringify({ error: "unavailable" }) };
    for (let attempt = 1; attempt <= MAX_UPSTREAM_ATTEMPTS; attempt += 1) {
      const wait = this.lastCallAt + minInterval * attempt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCallAt = Date.now();
      try {
        const res = await fetch(target, {
          headers: { "user-agent": `BandSync/0.1 ( ${contact} )`, accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const body = await res.text();
        if (res.status === 503 || res.status === 429) {
          log("warn", "musicbrainz.throttled", { status: res.status, attempt });
          last = { status: 503, body };
          continue;
        }
        return { status: res.status, body };
      } catch (err) {
        log("warn", "musicbrainz.request_failed", { attempt, error: String(err) });
        last = { status: 503, body: JSON.stringify({ error: String(err) }) };
      }
    }
    return last;
  }
}

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Stand-in for the external services during tests (runs in Node, outside the Worker).
 * It serves real MusicBrainz, YouTube and Spotify oEmbed responses captured from the live services
 * (packages/shared/test/fixtures/musicbrainz) and can be told to fail, so the gateway's retry
 * logic and the job's failure handling are exercised without any network access.
 *
 *   GET https://musicbrainz.org/__test/fail?n=3   -> the next 3 MusicBrainz requests answer 503
 *   GET https://musicbrainz.org/__test/calls      -> { calls: <number of MusicBrainz requests so far> }
 */
const FIXTURES = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "packages",
  "shared",
  "test",
  "fixtures",
  "musicbrainz",
);
const read = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

const LOOKUPS: Record<string, string> = {
  "0dea3c9a-ef6b-4707-90d8-685b2f4a2cd8": "lookup-perola-negra.json",
  "8379142a-fe4e-4da2-8edf-fb493665a54f": "lookup-esoterico-um-banda-um.json",
  "d72d41dd-fb12-4775-8188-d95c1fdabfe3": "lookup-esoterico-doces-barbaros.json",
  "790c0007-1df2-4d2e-bd34-8a772894e800": "lookup-o-segundo-sol-gil.json",
};

/** A made-up id standing for "exists, but the owner does not allow embedding". */
export const RESTRICTED_VIDEO_ID = "RESTRICTED1";
/** The track of the captured Spotify oEmbed answer (spotify-oembed-track.json). */
export const SPOTIFY_TRACK_ID = "4cOdK2wGLETKBW3PvgPWqT";

let failNext = 0;
/** Simulates Deezer being down (set through https://api.deezer.com/__test/down?on=1). */
let failDeezer = false;
let calls = 0;

const json = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

export async function outboundService(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.hostname === "musicbrainz.org") {
    if (url.pathname === "/__test/fail") {
      failNext = Number(url.searchParams.get("n") ?? "0");
      return json(JSON.stringify({ failNext }));
    }
    if (url.pathname === "/__test/calls") return json(JSON.stringify({ calls }));
    calls += 1;
    // MusicBrainz requires an identifying User-Agent; a missing one must fail loudly in tests.
    if (!(request.headers.get("user-agent") ?? "").startsWith("BandSync/"))
      return json('{"error":"user-agent"}', 403);
    if (failNext > 0) {
      failNext -= 1;
      return json('{"error":"Your requests are exceeding the allowable rate limit."}', 503);
    }
    if (url.pathname === "/ws/2/recording") {
      const q = url.searchParams.get("query") ?? "";
      if (/Pérola/i.test(q)) return json(read("search-perola-negra.json"));
      if (/Esot/i.test(q)) return json(read("search-esoterico.json"));
      if (/Segundo Sol/i.test(q)) return json(read("search-o-segundo-sol.json"));
      return json(
        JSON.stringify({ created: new Date().toISOString(), count: 0, offset: 0, recordings: [] }),
      );
    }
    const m = /^\/ws\/2\/recording\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (m) {
      const file = LOOKUPS[m[1]!];
      return file ? json(read(file)) : json('{"error":"Not Found"}', 404);
    }
    return json('{"error":"Not Found"}', 404);
  }

  if (url.hostname === "www.youtube.com" && url.pathname === "/oembed") {
    const target = url.searchParams.get("url") ?? "";
    if (target.includes("JZqFoTIAJj8")) return json(read("youtube-oembed-perola-negra.json"));
    // YouTube answers 401 for a video that exists but is private or not embeddable.
    if (target.includes(RESTRICTED_VIDEO_ID)) return new Response("Unauthorized", { status: 401 });
    return new Response("Not Found", { status: 404 });
  }

  if (url.hostname === "api.deezer.com" && url.pathname === "/__test/down") {
    failDeezer = url.searchParams.get("on") === "1";
    return json(JSON.stringify({ failDeezer }));
  }
  if (url.hostname === "api.deezer.com") {
    if (failDeezer) return json('{"error":"down"}', 503);
    if (url.pathname === "/track/isrc:BR4W41200009")
      return json(read("deezer-isrc-perola-negra.json"));
    if (url.pathname.startsWith("/track/isrc:"))
      return json('{"error":{"type":"DataException","message":"no data","code":800}}');
    if (url.pathname === "/track/876104442")
      return json(read("deezer-track-esoterico-um-banda-um.json"));
    if (url.pathname === "/track/1802312637") return json(read("deezer-track-o-segundo-sol.json"));
    if (url.pathname === "/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      if (q.includes("esot")) return json(read("deezer-search-esoterico.json"));
      if (q.includes("segundo sol")) return json(read("deezer-search-o-segundo-sol.json"));
      return json('{"data":[],"total":0}');
    }
    return json('{"error":{"type":"DataException","message":"no data","code":800}}');
  }

  if (url.hostname === "open.spotify.com" && url.pathname === "/oembed") {
    const target = url.searchParams.get("url") ?? "";
    if (target.includes(SPOTIFY_TRACK_ID)) return json(read("spotify-oembed-track.json"));
    return new Response("", { status: 404 });
  }

  return new Response(`outbound request to ${url.hostname} is not allowed in tests`, {
    status: 599,
  });
}

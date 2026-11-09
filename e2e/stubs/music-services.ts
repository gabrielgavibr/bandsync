/**
 * Local stand-in for MusicBrainz and the YouTube / Spotify oEmbed endpoints, used only by the local end-to-end tests.
 * It replays the real responses captured in packages/shared/test/fixtures/musicbrainz through the
 * same fake the API integration tests use, so the browser flow can run without internet access.
 *
 *   node e2e/stubs/music-services.ts        (listens on http://localhost:8790)
 */
import { createServer } from "node:http";
import { outboundService } from "../../apps/api/test/outbound.ts";

const PORT = Number(process.env.MUSIC_STUB_PORT ?? 8790);

createServer(async (req, res) => {
  const path = req.url ?? "/";
  // Both platforms use /oembed; the recording they are asked about tells them apart.
  const host = !path.startsWith("/oembed")
    ? "musicbrainz.org"
    : decodeURIComponent(path).includes("open.spotify.com")
      ? "open.spotify.com"
      : "www.youtube.com";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const out = await outboundService(new Request(`https://${host}${path}`, { headers }));
  res.writeHead(out.status, { "content-type": out.headers.get("content-type") ?? "text/plain" });
  res.end(await out.text());
}).listen(PORT, () => console.log(`music service stub on http://localhost:${PORT}`));

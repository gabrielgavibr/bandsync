import {
  MUSICBRAINZ_BASE_URL,
  normalizeRecordingLookup,
  normalizeSearchResponse,
  parseYouTubeUrl,
  type RecordingCandidate,
  type RecordingDetails,
  recordingLookupUrl,
  recordingSearchUrl,
  type YouTubeVideoInfo,
  youtubeOEmbedUrl,
  youtubeWatchUrl,
} from "@bandsync/shared";
import type { Env } from "../env";
import { ApiError } from "../lib/errors";

const SEARCH_TTL_SECONDS = 6 * 60 * 60;
const LOOKUP_TTL_SECONDS = 24 * 60 * 60;

/** MusicBrainz through the rate-limiting gateway. Returns BandSync's normalised shapes. */
export function musicBrainz(env: Env) {
  const base = (env.MUSICBRAINZ_BASE_URL || MUSICBRAINZ_BASE_URL).replace(/\/$/, "");
  const stub = env.MB_GATEWAY.get(env.MB_GATEWAY.idFromName("global"));

  async function get(target: string, ttl: number): Promise<{ status: number; json: unknown }> {
    const res = await stub.fetch(
      `https://gateway/get?ttl=${ttl}&target=${encodeURIComponent(target)}`,
    );
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  return {
    async search(input: { title: string; artist?: string | null }): Promise<RecordingCandidate[]> {
      const { status, json } = await get(recordingSearchUrl(base, input), SEARCH_TTL_SECONDS);
      if (status !== 200)
        throw new ApiError("upstream_unavailable", `MusicBrainz answered ${status}`);
      return normalizeSearchResponse(json);
    },
    /** null when the recording does not exist. */
    async lookup(mbid: string): Promise<RecordingDetails | null> {
      const { status, json } = await get(recordingLookupUrl(base, mbid), LOOKUP_TTL_SECONDS);
      if (status === 404 || status === 400) return null;
      if (status !== 200)
        throw new ApiError("upstream_unavailable", `MusicBrainz answered ${status}`);
      return normalizeRecordingLookup(json);
    },
  };
}
export type MusicBrainzClient = ReturnType<typeof musicBrainz>;

/**
 * Confirms a YouTube video exists (and can be embedded) through oEmbed and reads its title and
 * channel. Nothing is downloaded: the video is only ever played in YouTube's own player.
 * Returns null when the link is not a YouTube video or the video is unavailable.
 */
export async function youtubeVideoInfo(env: Env, url: string): Promise<YouTubeVideoInfo | null> {
  const videoId = parseYouTubeUrl(url);
  if (!videoId) return null;
  const base = env.YOUTUBE_OEMBED_BASE || "https://www.youtube.com";
  let res: Response;
  try {
    res = await fetch(youtubeOEmbedUrl(base, videoId), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiError("upstream_unavailable", "YouTube did not answer");
  }
  // 404: unknown video. 401/403: private or embedding disabled, so it cannot be a reference here.
  if (res.status === 404 || res.status === 401 || res.status === 403 || res.status === 400)
    return null;
  if (!res.ok) throw new ApiError("upstream_unavailable", `YouTube answered ${res.status}`);
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const title = typeof j?.title === "string" ? j.title : null;
  const channel = typeof j?.author_name === "string" ? j.author_name : null;
  if (!title || !channel) return null;
  const http = (v: unknown) => (typeof v === "string" && /^https:\/\//.test(v) ? v : null);
  return {
    videoId,
    url: youtubeWatchUrl(videoId),
    title,
    channelName: channel,
    channelUrl: http(j?.author_url),
    thumbnailUrl: http(j?.thumbnail_url),
  };
}

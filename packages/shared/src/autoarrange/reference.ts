/**
 * Reference links: the recording a band chooses to study, given as a link to a platform.
 *
 * Only platforms with a connector here are accepted. A link is parsed into (platform, id) and
 * every URL the app later uses (original link, embedded player, metadata endpoint, thumbnail) is
 * rebuilt from those two values, so nothing a user typed is ever placed in an iframe or a link.
 * A link identifies a recording; it never gives BandSync the right to download or analyse it.
 */

export const REFERENCE_PLATFORMS = ["youtube", "youtube_music", "spotify"] as const;
export type ReferencePlatform = (typeof REFERENCE_PLATFORMS)[number];

/**
 * invalid_url          – not a link at all, or a link with a scheme, port or credentials we refuse
 * unsupported_platform – a real link, but to a site without a connector
 * unsupported_link     – a supported site, but not a link to one recording (playlist, album, channel, short link)
 */
export type ReferenceLinkProblem = "invalid_url" | "unsupported_platform" | "unsupported_link";

export interface ParsedReferenceLink {
  platform: ReferencePlatform;
  /** The platform's own identifier of the video or track. */
  externalId: string;
  /** Canonical link, rebuilt from platform and id. */
  url: string;
}

export type ParseReferenceResult =
  | { ok: true; link: ParsedReferenceLink }
  | { ok: false; reason: ReferenceLinkProblem };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const YOUTUBE_MUSIC_HOST = "music.youtube.com";
const SPOTIFY_HOST = "open.spotify.com";
/** Hosts of the supported platforms whose links cannot be resolved to one recording here. */
const KNOWN_UNRESOLVABLE_HOSTS = new Set(["spotify.link", "spotify.app.link", "play.spotify.com"]);

export function referenceCanonicalUrl(platform: ReferencePlatform, externalId: string): string {
  switch (platform) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${externalId}`;
    case "youtube_music":
      return `https://music.youtube.com/watch?v=${externalId}`;
    case "spotify":
      return `https://open.spotify.com/track/${externalId}`;
  }
}

/** The platform's official embeddable player for that recording. */
export function referenceEmbedUrl(platform: ReferencePlatform, externalId: string): string {
  return platform === "spotify"
    ? `https://open.spotify.com/embed/track/${externalId}`
    : `https://www.youtube-nocookie.com/embed/${externalId}`;
}

/** Official oEmbed endpoint used to confirm the recording exists and read its public metadata. */
export function referenceOEmbedUrl(
  platform: ReferencePlatform,
  externalId: string,
  bases: { youtube: string; spotify: string },
): string {
  if (platform === "spotify") {
    const u = new URL("/oembed", bases.spotify);
    u.searchParams.set("url", referenceCanonicalUrl("spotify", externalId));
    return u.toString();
  }
  const u = new URL("/oembed", bases.youtube);
  // YouTube Music plays YouTube videos: the same id answers on the main site's endpoint.
  u.searchParams.set("url", referenceCanonicalUrl("youtube", externalId));
  u.searchParams.set("format", "json");
  return u.toString();
}

function isValidId(platform: ReferencePlatform, id: string | null | undefined): id is string {
  return !!id && (platform === "spotify" ? SPOTIFY_ID.test(id) : YOUTUBE_ID.test(id));
}

/**
 * Platforms that address the same recording with the same id: a YouTube video and its
 * YouTube Music page are one recording, so switching between them is not a replacement.
 */
export function sameRecordingPlatforms(platform: ReferencePlatform): ReferencePlatform[] {
  return platform === "spotify" ? ["spotify"] : ["youtube", "youtube_music"];
}

/** Rebuilds a stored (platform, id) pair into a link; null when the pair is not valid. */
export function referenceLinkFrom(
  platform: string | null | undefined,
  externalId: string | null | undefined,
): ParsedReferenceLink | null {
  if (!platform || !(REFERENCE_PLATFORMS as readonly string[]).includes(platform)) return null;
  const p = platform as ReferencePlatform;
  if (!isValidId(p, externalId)) return null;
  return { platform: p, externalId, url: referenceCanonicalUrl(p, externalId) };
}

function youtubeId(url: URL): string | null | "not_a_recording" {
  if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0] || "not_a_recording";
  if (url.pathname === "/watch") return url.searchParams.get("v") || "not_a_recording";
  const m = /^\/(embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
  return m?.[2] ?? "not_a_recording";
}

/** Recognises a link to one recording on a supported platform. */
export function parseReferenceLink(input: string): ParseReferenceResult {
  const text = input.trim();
  const bad = (reason: ReferenceLinkProblem): ParseReferenceResult => ({ ok: false, reason });
  const good = (platform: ReferencePlatform, externalId: string): ParseReferenceResult => ({
    ok: true,
    link: { platform, externalId, url: referenceCanonicalUrl(platform, externalId) },
  });
  // Control characters and spaces never belong in a pasted link.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  if (text === "" || text.length > 2000 || /[\u0000- \u007f]/.test(text)) return bad("invalid_url");

  // Spotify's own URI form, as copied from its apps.
  const uri = /^spotify:([a-z]+):([A-Za-z0-9]+)$/.exec(text);
  if (uri) {
    return uri[1] === "track" && isValidId("spotify", uri[2])
      ? good("spotify", uri[2])
      : bad("unsupported_link");
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return bad("invalid_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return bad("invalid_url");
  if (url.username !== "" || url.password !== "" || url.port !== "") return bad("invalid_url");
  const host = url.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(host) || host === YOUTUBE_MUSIC_HOST) {
    const platform: ReferencePlatform = host === YOUTUBE_MUSIC_HOST ? "youtube_music" : "youtube";
    const id = youtubeId(url);
    return isValidId(platform, id) ? good(platform, id) : bad("unsupported_link");
  }
  if (host === SPOTIFY_HOST) {
    // /track/<id>, with an optional locale prefix (/intl-pt/track/<id>) or the embed form.
    const m = /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/([^/?#]+)\/?$/.exec(url.pathname);
    return m && isValidId("spotify", m[1]) ? good("spotify", m[1]) : bad("unsupported_link");
  }
  if (KNOWN_UNRESOLVABLE_HOSTS.has(host)) return bad("unsupported_link");
  return bad("unsupported_platform");
}

/** Thumbnails are shown straight from the platform's own image hosts and nowhere else. */
const THUMBNAIL_HOST_SUFFIXES = [".ytimg.com", ".scdn.co", ".spotifycdn.com"];
export function safeThumbnailUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const host = u.hostname.toLowerCase();
    return THUMBNAIL_HOST_SUFFIXES.some((s) => host.endsWith(s)) ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * complete – title and artist/channel came from the platform
 * partial  – the platform gave a title only (Spotify's public endpoint does not name the artist)
 * missing  – the link is valid but the platform shared nothing (private video, embedding disabled)
 */
export type ReferenceMetadataLevel = "complete" | "partial" | "missing";

/** What a platform says about a link, through its official public endpoint. */
export interface ReferenceLinkInfo extends ParsedReferenceLink {
  /** Title as the platform shows it. A video title is not necessarily the song title. */
  title: string | null;
  /** Channel or uploader, when the platform names one. Not necessarily the artist. */
  author: string | null;
  /** Artist, only when the platform states it unambiguously (YouTube "… - Topic" channels). */
  artistGuess: string | null;
  thumbnailUrl: string | null;
  /** false when the platform refuses to embed the recording; null when unknown. */
  embeddable: boolean | null;
  metadata: ReferenceMetadataLevel;
}

/** Reads the fields BandSync uses from an oEmbed answer. Unknown or odd values become null. */
export function normalizeOEmbed(link: ParsedReferenceLink, json: unknown): ReferenceLinkInfo {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  const title = str(j.title)?.slice(0, 300) ?? null;
  const author = link.platform === "spotify" ? null : (str(j.author_name)?.slice(0, 200) ?? null);
  // YouTube's auto-generated art-track channels are named "<artist> - Topic".
  const topic = author ? /^(.+) - Topic$/.exec(author) : null;
  return {
    ...link,
    title,
    author,
    artistGuess: topic ? topic[1]!.trim() : null,
    thumbnailUrl: safeThumbnailUrl(j.thumbnail_url),
    embeddable: true,
    metadata: title && author ? "complete" : title ? "partial" : "missing",
  };
}

/** The reference of a song as every member sees it (song sheet, repertoire, live rehearsal). */
export interface SongReferenceSummary {
  recordingId: string;
  title: string;
  artist: string | null;
  releaseTitle: string | null;
  year: string | null;
  durationMs: number | null;
  platform: ReferencePlatform | null;
  externalId: string | null;
  /** Original link on the platform; null while the band has not given one. */
  url: string | null;
  thumbnailUrl: string | null;
  embeddable: boolean | null;
}

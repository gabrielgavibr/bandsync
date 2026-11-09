/**
 * YouTube links are references for listening through the official player only.
 * Nothing here downloads or extracts audio.
 */
const ID = /^[A-Za-z0-9_-]{11}$/;

/** Extracts the video id from the usual YouTube URL shapes; null for anything else. */
export function parseYouTubeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = /^\/(embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
      id = m?.[2] ?? null;
    }
  }
  return id && ID.test(id) ? id : null;
}

export const youtubeWatchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

/** Official embeddable player (privacy-enhanced domain). */
export const youtubeEmbedUrl = (videoId: string) =>
  `https://www.youtube-nocookie.com/embed/${videoId}`;

/** oEmbed endpoint used to confirm that a video exists and to read its title and channel. */
export function youtubeOEmbedUrl(base: string, videoId: string): string {
  const u = new URL("/oembed", base);
  u.searchParams.set("url", youtubeWatchUrl(videoId));
  u.searchParams.set("format", "json");
  return u.toString();
}

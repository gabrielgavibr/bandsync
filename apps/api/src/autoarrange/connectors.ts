import type { ConnectorInfo } from "@bandsync/shared";

/**
 * Reference sources BandSync knows about, each with what it may legally do with them.
 * Checked on 2026-11-09:
 *  - MusicBrainz: official JSON API, core data CC0, 1 request/second, identifying User-Agent.
 *  - YouTube / YouTube Music: oEmbed (title, channel, thumbnail) + official embedded player; no
 *    download or audio extraction. The keyless endpoint gives no duration.
 *  - Spotify: oEmbed (track title and cover only: no artist, no duration) + official embedded
 *    player; no download or audio extraction. Artist and duration would need the Web API, which
 *    requires an app registration that is not configured.
 *  - Cifra Club: no public API; legal notice forbids data extraction and framing; automated
 *    requests are refused (HTTP 403). Links only.
 *  - Cifras.com.br: no public API; robots.txt disallows /busca and /api for crawlers; content
 *    is for personal use. Links only (a person opens the search).
 *  - Songsterr: robots.txt disallows /api/; licences do not cover showing tabs elsewhere. Links only.
 * A connector is independent. Reference links are accepted only from the platforms flagged
 * `referenceLinks`; their URL handling lives in packages/shared/src/autoarrange/reference.ts.
 */
export const CONNECTORS: ConnectorInfo[] = [
  {
    id: "musicbrainz",
    name: "MusicBrainz",
    referenceLinks: false,
    provides: ["metadata"],
    access: "api",
    mayStoreContent: true,
    termsUrl: "https://musicbrainz.org/doc/About/Data_License",
    policyKey: "musicbrainz",
  },
  {
    id: "youtube",
    name: "YouTube",
    referenceLinks: true,
    provides: ["video"],
    access: "official_embed",
    mayStoreContent: false,
    termsUrl: "https://www.youtube.com/t/terms",
    policyKey: "youtube",
  },
  {
    id: "youtube_music",
    name: "YouTube Music",
    referenceLinks: true,
    provides: ["audio"],
    access: "official_embed",
    mayStoreContent: false,
    termsUrl: "https://www.youtube.com/t/terms",
    policyKey: "youtube",
  },
  {
    id: "spotify",
    name: "Spotify",
    referenceLinks: true,
    provides: ["audio"],
    access: "official_embed",
    mayStoreContent: false,
    termsUrl: "https://developer.spotify.com/terms",
    policyKey: "spotify",
  },
  {
    id: "cifraclub",
    name: "Cifra Club",
    referenceLinks: false,
    provides: ["chords", "tabs", "lyrics"],
    access: "link_only",
    mayStoreContent: false,
    termsUrl: "https://www.cifraclub.com.br/aviso-legal.html",
    policyKey: "linkOnly",
  },
  {
    id: "cifras",
    name: "Cifras.com.br",
    referenceLinks: false,
    provides: ["chords"],
    access: "link_only",
    mayStoreContent: false,
    termsUrl: "https://conta.cifras.com.br/termos",
    policyKey: "linkOnly",
  },
  {
    id: "songsterr",
    name: "Songsterr",
    referenceLinks: false,
    provides: ["tabs"],
    access: "link_only",
    mayStoreContent: false,
    termsUrl: "https://www.songsterr.com/terms",
    policyKey: "linkOnly",
  },
];

export interface SearchLink {
  connectorId: string;
  kind: "chords" | "tabs";
  title: string;
  url: string;
  host: string;
}

/**
 * Search links a person can open on each link-only site. BandSync does not request these pages
 * itself and never reads their content, so the result is unknown until someone opens the link.
 */
export function buildSearchLinks(song: { title: string; artist: string | null }): SearchLink[] {
  const q = encodeURIComponent(
    [song.title, song.artist ?? ""].join(" ").trim().replace(/\s+/g, " "),
  );
  return [
    {
      connectorId: "cifraclub",
      kind: "chords",
      title: "Cifra Club",
      url: `https://www.cifraclub.com.br/?q=${q}`,
      host: "www.cifraclub.com.br",
    },
    {
      connectorId: "cifras",
      kind: "chords",
      title: "Cifras.com.br",
      url: `https://www.cifras.com.br/busca?q=${q}`,
      host: "www.cifras.com.br",
    },
    {
      connectorId: "songsterr",
      kind: "tabs",
      title: "Songsterr",
      url: `https://www.songsterr.com/?pattern=${q}`,
      host: "www.songsterr.com",
    },
  ];
}

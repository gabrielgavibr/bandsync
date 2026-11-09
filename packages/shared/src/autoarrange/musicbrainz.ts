import type {
  RecordingCandidate,
  RecordingDetails,
  RecordingLink,
  RecordingRelease,
  RecordingWork,
} from "./types";

/**
 * Pure helpers for the MusicBrainz web service (https://musicbrainz.org/doc/MusicBrainz_API).
 * They build queries and turn the service's JSON into BandSync's own shapes; the network call
 * itself lives in the API worker. Core MusicBrainz data is CC0.
 */
export const MUSICBRAINZ_BASE_URL = "https://musicbrainz.org";

/** `inc` parameters needed to learn the composition (work), its authors and external links. */
export const RECORDING_LOOKUP_INC =
  "artist-credits+releases+release-groups+isrcs+work-rels+work-level-rels+artist-rels+url-rels";

/** Escapes text for use inside a quoted Lucene phrase. */
function phrase(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildRecordingQuery(input: { title: string; artist?: string | null }): string {
  const parts = [`recording:${phrase(input.title.trim())}`];
  const artist = input.artist?.trim();
  if (artist) parts.push(`artist:${phrase(artist)}`);
  return parts.join(" AND ");
}

export function recordingSearchUrl(
  base: string,
  input: { title: string; artist?: string | null },
  limit = 25,
): string {
  const u = new URL("/ws/2/recording", base);
  u.searchParams.set("query", buildRecordingQuery(input));
  u.searchParams.set("fmt", "json");
  u.searchParams.set("limit", String(limit));
  return u.toString();
}

export function recordingLookupUrl(base: string, mbid: string): string {
  return `${base.replace(/\/$/, "")}/ws/2/recording/${mbid}?inc=${RECORDING_LOOKUP_INC}&fmt=json`;
}

export const recordingPageUrl = (mbid: string) => `${MUSICBRAINZ_BASE_URL}/recording/${mbid}`;
export const workPageUrl = (mbid: string) => `${MUSICBRAINZ_BASE_URL}/work/${mbid}`;

/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

function artistCredit(raw: unknown): { text: string; artists: { mbid: string; name: string }[] } {
  let text = "";
  const artists: { mbid: string; name: string }[] = [];
  for (const c of arr(raw)) {
    text += `${str(c.name) ?? ""}${typeof c.joinphrase === "string" ? c.joinphrase : ""}`;
    const a = c.artist as Json | undefined;
    if (a && str(a.id) && str(a.name))
      artists.push({ mbid: a.id as string, name: a.name as string });
  }
  return { text: text.trim(), artists };
}

function releases(raw: unknown): RecordingRelease[] {
  const out: RecordingRelease[] = [];
  for (const r of arr(raw)) {
    const id = str(r.id);
    const title = str(r.title);
    if (!id || !title) continue;
    const group = (r["release-group"] ?? {}) as Json;
    out.push({
      mbid: id,
      title,
      date: str(r.date),
      country: str(r.country),
      status: str(r.status),
      primaryType: str(group["primary-type"]),
      secondaryTypes: Array.isArray(group["secondary-types"])
        ? (group["secondary-types"] as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
    });
  }
  // Oldest first; undated releases last. A year-only date sorts after the exact dates of that year,
  // so a precisely dated original release stays on top.
  const key = (d: string | null) => (d ? d.padEnd(10, "-99").slice(0, 10) : "9999-99-99");
  return out.sort((a, b) => key(a.date).localeCompare(key(b.date)));
}

function base(r: Json): Omit<RecordingCandidate, "score"> | null {
  const mbid = str(r.id);
  const title = str(r.title);
  if (!mbid || !title) return null;
  const credit = artistCredit(r["artist-credit"]);
  return {
    source: "musicbrainz",
    mbid,
    title,
    disambiguation: str(r.disambiguation),
    artistCredit: credit.text,
    artists: credit.artists,
    durationMs: typeof r.length === "number" && r.length > 0 ? r.length : null,
    firstReleaseDate: str(r["first-release-date"]),
    isVideo: r.video === true,
    isrcs: Array.isArray(r.isrcs)
      ? (r.isrcs as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    releases: releases(r.releases),
    url: recordingPageUrl(mbid),
  };
}

/** Normalises `/ws/2/recording?query=…`. Unknown or malformed entries are dropped, never guessed. */
export function normalizeSearchResponse(json: unknown): RecordingCandidate[] {
  const out: RecordingCandidate[] = [];
  for (const r of arr((json as Json | null)?.recordings)) {
    const b = base(r);
    if (!b) continue;
    out.push({ ...b, score: typeof r.score === "number" ? r.score : Number(r.score) || 0 });
  }
  return out;
}

/** Normalises `/ws/2/recording/<mbid>?inc=…`: adds the performed works with their authors, and links. */
export function normalizeRecordingLookup(json: unknown): RecordingDetails | null {
  const r = json as Json | null;
  if (!r) return null;
  const b = base(r);
  if (!b) return null;
  const works: RecordingWork[] = [];
  const links: RecordingLink[] = [];
  for (const rel of arr(r.relations)) {
    if (rel["target-type"] === "work") {
      const w = rel.work as Json | undefined;
      const id = str(w?.id);
      const title = str(w?.title);
      if (!w || !id || !title || works.some((x) => x.mbid === id)) continue;
      const names = (type: string) => {
        const list: string[] = [];
        for (const wr of arr(w.relations)) {
          const name = str((wr.artist as Json | undefined)?.name);
          if (wr.type === type && name && !list.includes(name)) list.push(name);
        }
        return list;
      };
      works.push({
        mbid: id,
        title,
        composers: names("composer"),
        lyricists: names("lyricist"),
        writers: names("writer"),
        url: workPageUrl(id),
      });
    } else if (rel["target-type"] === "url") {
      const resource = str((rel.url as Json | undefined)?.resource);
      const type = str(rel.type);
      if (resource && /^https?:\/\//i.test(resource) && !links.some((l) => l.url === resource)) {
        links.push({ type: type ?? "link", url: resource });
      }
    }
  }
  return { ...b, works, links };
}

/**
 * The release that best describes where a recording comes from: an official, non-compilation
 * release, the earliest one. Falls back to the earliest release of any kind.
 */
export function pickDefaultRelease(releaseList: RecordingRelease[]): RecordingRelease | null {
  if (releaseList.length === 0) return null;
  const original = releaseList.filter(
    (r) => (r.status ?? "Official") === "Official" && !r.secondaryTypes.includes("Compilation"),
  );
  return original[0] ?? releaseList[0] ?? null;
}

/** People credited for writing a work: composers and lyricists, or generic writers. */
export function workAuthors(works: RecordingWork[]): string[] {
  const names: string[] = [];
  for (const w of works) {
    for (const n of [...w.composers, ...w.lyricists, ...w.writers])
      if (!names.includes(n)) names.push(n);
  }
  return names;
}

/** Whether a candidate is a concert recording, from the release types or the disambiguation text. */
export function isLiveRecording(
  c: Pick<RecordingCandidate, "releases" | "disambiguation">,
): boolean {
  if (/\blive\b|ao vivo/i.test(c.disambiguation ?? "")) return true;
  return c.releases.length > 0 && c.releases.every((r) => r.secondaryTypes.includes("Live"));
}

/**
 * Deezer's public API (no key) as an AnalysisDiscovery: the BPM and duration Deezer publishes for
 * a recording. Used only to find the exact recording and read those two numbers; previews and
 * audio are never used. Deezer's BPM is its own automatic estimate (often the doubled tempo of a
 * reggae groove), so it is stored as "needs review" like any estimate.
 */
export const DEEZER_API_BASE = "https://api.deezer.com";

export interface DeezerTrack {
  id: number;
  title: string;
  artist: string | null;
  album: string | null;
  durationSec: number | null;
  /** null when Deezer has no tempo for the track (it sends 0). */
  bpm: number | null;
  isrc: string | null;
  link: string;
}

export const deezerIsrcUrl = (base: string, isrc: string) =>
  `${base.replace(/\/$/, "")}/track/isrc:${encodeURIComponent(isrc)}`;
export const deezerTrackUrl = (base: string, id: number) =>
  `${base.replace(/\/$/, "")}/track/${id}`;
export function deezerSearchUrl(base: string, artist: string | null, title: string): string {
  const u = new URL(`${base.replace(/\/$/, "")}/search`);
  u.searchParams.set("q", [artist ?? "", title].join(" ").trim());
  u.searchParams.set("limit", "15");
  return u.toString();
}

export function normalizeDeezerTrack(json: unknown): DeezerTrack | null {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  if (j.error || typeof j.id !== "number" || typeof j.title !== "string") return null;
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const bpm = num(j.bpm);
  return {
    id: j.id,
    title: j.title,
    artist: typeof obj(j.artist).name === "string" ? (obj(j.artist).name as string) : null,
    album: typeof obj(j.album).title === "string" ? (obj(j.album).title as string) : null,
    durationSec: num(j.duration),
    bpm: bpm && bpm >= 20 && bpm <= 400 ? Math.round(bpm * 10) / 10 : null,
    isrc: typeof j.isrc === "string" && j.isrc ? j.isrc : null,
    link: `https://www.deezer.com/track/${j.id}`,
  };
}

export function normalizeDeezerSearch(json: unknown): DeezerTrack[] {
  const data = (json as { data?: unknown } | null)?.data;
  return Array.isArray(data)
    ? data.map(normalizeDeezerTrack).filter((t): t is DeezerTrack => t !== null)
    : [];
}

/** Lower case, no accents, no parentheses, no "feat." part. */
export function comparableTitle(t: string): string {
  return t
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\s+-\s+.*$/, " ")
    .replace(/\b(feat|ft|part)\..*$/, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The Deezer track that is this exact recording, or null when that cannot be told apart.
 * A title match alone is not enough (a song has studio, live and re-recorded versions): the
 * duration must agree within 3 s with the duration the catalogue or the official player gave.
 */
export function pickDeezerMatch(
  tracks: DeezerTrack[],
  want: { title: string; durationSec: number | null },
): DeezerTrack | null {
  const title = comparableTitle(want.title);
  const same = tracks.filter((t) => comparableTitle(t.title) === title);
  if (want.durationSec === null) return null;
  const close = same
    .filter((t) => t.durationSec !== null && Math.abs(t.durationSec - want.durationSec!) <= 3)
    .sort(
      (a, b) =>
        Math.abs(a.durationSec! - want.durationSec!) - Math.abs(b.durationSec! - want.durationSec!),
    );
  if (close.length === 0) return null;
  // Two different versions with the same length: do not guess.
  if (close.length > 1 && Math.abs(close[0]!.durationSec! - close[1]!.durationSec!) < 1)
    return null;
  return close[0]!;
}

/* ------------------------------------------------------------------ */
/* Which version, when no length is known yet                          */
/* ------------------------------------------------------------------ */

const plain = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const words = (t: string) => new Set(plain(t).split(" ").filter((w) => w.length >= 2));

/** Words that say nothing about which version a recording is. */
const FILLER = new Set(
  "de da do das dos no na nos nas em ao aos com the of in at on and feat ft part official oficial video clipe clip audio lyric lyrics letra hd hq 4k vevo music musica full album".split(
    " ",
  ),
);

const isLive = (t: string) => /\b(ao vivo|live|en vivo|unplugged)\b/.test(plain(t));
const isAcoustic = (t: string) => /\b(acustic[oa]|acoustic|unplugged)\b/.test(plain(t));

/** What a track's own title adds to the song's name ("Primeira versão", "Regravação Take 01"). */
function qualifiers(trackTitle: string): string[] {
  const parts: string[] = [];
  for (const m of trackTitle.matchAll(/[([]([^)\]]*)[)\]]/g)) parts.push(m[1]!);
  const dash = /\s-\s(.*)$/.exec(trackTitle.replace(/[([][^)\]]*[)\]]/g, " "));
  if (dash) parts.push(dash[1]!);
  return parts
    .filter((p) => !/^\s*(feat|ft|part)\b/i.test(plain(p)))
    .flatMap((p) => [...words(p)])
    .filter((w) => !FILLER.has(w) && !["ao", "vivo", "live", "acustico", "acustica", "acoustic"].includes(w));
}

export interface DeezerVersionMatch {
  track: DeezerTrack;
  /** only_version: Deezer has one version and it agrees; version_words: told apart by the link's own words. */
  evidence: "only_version" | "version_words";
  /** The words of the link's title that point at this version's album or title. */
  words: string[];
}

/**
 * The Deezer track that is the recording behind a link, decided from what the platform's own
 * title says ("... (Acústico Ao Vivo no Rio de Janeiro)"), for when no length is known yet.
 * Returns null whenever that is not clear: the link's title does not name the song; a candidate
 * is live / acoustic / a "first version" and the link does not say so (or the other way round);
 * or several versions remain and the title's words do not single one out. Data of another
 * version is never taken.
 */
export function pickDeezerVersion(
  tracks: DeezerTrack[],
  want: { title: string; artist: string | null; linkTitle: string | null; linkAuthor?: string | null },
): DeezerVersionMatch | null {
  if (!want.linkTitle) return null;
  const song = comparableTitle(want.title);
  const link = plain(want.linkTitle);
  if (!song || !` ${link} `.includes(` ${song} `)) return null;
  const linkWords = words(want.linkTitle);
  const known = new Set([...words(want.artist ?? ""), ...linkWords, ...words(want.linkAuthor ?? "")]);
  const same = tracks.filter((t) => {
    if (comparableTitle(t.title) !== song) return false;
    const artist = [...words(t.artist ?? "")].filter((w) => w.length >= 3);
    return artist.length === 0 || artist.some((w) => known.has(w) || [...known].some((k) => k.startsWith(w)));
  });
  // The same recording appears on several albums: one version per length (within 3 s) and kind.
  const eligible = same.filter((t) => {
    const about = `${t.title} ${t.album ?? ""}`;
    if (isLive(about) !== isLive(want.linkTitle!)) return false;
    if (isAcoustic(about) !== isAcoustic(want.linkTitle!)) return false;
    return qualifiers(t.title).every((w) => linkWords.has(w));
  });
  if (eligible.length === 0) return null;
  const versions: DeezerTrack[][] = [];
  for (const t of eligible) {
    const group = versions.find(
      (g) =>
        g[0]!.durationSec !== null &&
        t.durationSec !== null &&
        Math.abs(g[0]!.durationSec - t.durationSec) <= 3,
    );
    if (group) group.push(t);
    else versions.push([t]);
  }
  const songWords = new Set([...words(want.title), ...words(want.artist ?? "")]);
  const pointing = (t: DeezerTrack) =>
    [...words(`${t.album ?? ""} ${t.title}`)].filter(
      (w) => linkWords.has(w) && !songWords.has(w) && !FILLER.has(w),
    );
  if (versions.length === 1) {
    // The only version Deezer has must be the only one at all it lists under this title.
    const others = same.length - eligible.length;
    const best = versions[0]!.map((t) => ({ t, w: pointing(t) })).sort((a, b) => b.w.length - a.w.length)[0]!;
    if (others === 0 || best.w.length >= 1)
      return { track: best.t, evidence: others === 0 ? "only_version" : "version_words", words: best.w };
    return null;
  }
  const scored = versions
    .map((g) => g.map((t) => ({ t, w: pointing(t) })).sort((a, b) => b.w.length - a.w.length)[0]!)
    .sort((a, b) => b.w.length - a.w.length);
  if (scored[0]!.w.length >= 2 && scored[0]!.w.length - scored[1]!.w.length >= 2)
    return { track: scored[0]!.t, evidence: "version_words", words: scored[0]!.w };
  return null;
}

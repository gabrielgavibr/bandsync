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

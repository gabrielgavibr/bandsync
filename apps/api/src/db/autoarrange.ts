import {
  type AnalysisJobDto,
  type AnalysisResultDto,
  type AudioAssetDto,
  type AudioRights,
  initialReviewStatus,
  isActiveJob,
  type JobStatus,
  type JobStepRecord,
  jobProgress,
  type ParsedReferenceLink,
  type RecordingLink,
  type RecordingReferenceLink,
  type RecordingWork,
  type ReferenceDependents,
  type ReferenceLinkInfo,
  type ResultKind,
  type ResultOrigin,
  type ReviewEventDto,
  type ReviewStatus,
  referenceLinkFrom,
  type SongRecordingDto,
  type SongReferenceSummary,
  safeThumbnailUrl,
} from "@bandsync/shared";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";

function parse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Recordings                                                          */
/* ------------------------------------------------------------------ */

interface RecordingRow {
  id: string;
  song_id: string;
  source: "musicbrainz" | "manual";
  mbid: string | null;
  title: string;
  artist_credit: string | null;
  disambiguation: string | null;
  release_title: string | null;
  release_mbid: string | null;
  release_date: string | null;
  duration_ms: number | null;
  isrcs: string;
  works: string;
  links: string;
  is_reference: number;
  source_url: string | null;
  fetched_at: string | null;
  created_at: string;
  platform: string | null;
  external_id: string | null;
  link_title: string | null;
  link_author: string | null;
  thumbnail_url: string | null;
  embeddable: number | null;
  link_checked_at: string | null;
  metadata_edited_by: string | null;
  metadata_edited_at: string | null;
  reference_since: string | null;
  retired_at: string | null;
}

/** The link is always rebuilt from (platform, id); a row with an unknown pair simply has no link. */
function linkOf(r: RecordingRow): RecordingReferenceLink | null {
  const parsed = referenceLinkFrom(r.platform, r.external_id);
  if (!parsed) return null;
  return {
    ...parsed,
    title: r.link_title,
    author: r.link_author,
    thumbnailUrl: safeThumbnailUrl(r.thumbnail_url),
    embeddable: r.embeddable === null ? null : r.embeddable === 1,
    checkedAt: r.link_checked_at,
  };
}

function toRecordingDto(r: RecordingRow): SongRecordingDto {
  const link = linkOf(r);
  return {
    id: r.id,
    songId: r.song_id,
    source: r.source,
    identifiedBy: r.mbid ? "musicbrainz" : link ? "link" : "manual",
    mbid: r.mbid,
    title: r.title,
    artistCredit: r.artist_credit,
    disambiguation: r.disambiguation,
    releaseTitle: r.release_title,
    releaseMbid: r.release_mbid,
    releaseDate: r.release_date,
    durationMs: r.duration_ms,
    isrcs: parse<string[]>(r.isrcs, []),
    works: parse<RecordingWork[]>(r.works, []),
    links: parse<RecordingLink[]>(r.links, []),
    link,
    isReference: r.is_reference === 1,
    referenceSince: r.reference_since,
    retiredAt: r.retired_at,
    metadataEditedBy: r.metadata_edited_by,
    metadataEditedAt: r.metadata_edited_at,
    sourceUrl: r.source_url,
    fetchedAt: r.fetched_at,
    createdAt: r.created_at,
  };
}

/** What every member sees of a song's reference: sheet, repertoire and live rehearsal. */
export function toReferenceSummary(r: SongRecordingDto): SongReferenceSummary {
  return {
    recordingId: r.id,
    title: r.title,
    artist: r.artistCredit,
    releaseTitle: r.releaseTitle,
    year: /^\d{4}/.test(r.releaseDate ?? "") ? r.releaseDate!.slice(0, 4) : null,
    durationMs: r.durationMs,
    platform: r.link?.platform ?? null,
    externalId: r.link?.externalId ?? null,
    url: r.link?.url ?? null,
    thumbnailUrl: r.link?.thumbnailUrl ?? null,
    embeddable: r.link?.embeddable ?? null,
  };
}

export async function listRecordings(db: D1Database, songId: string): Promise<SongRecordingDto[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM song_recordings WHERE song_id = ? ORDER BY is_reference DESC, created_at DESC",
    )
    .bind(songId)
    .all<RecordingRow>();
  return results.map(toRecordingDto);
}

export async function getRecording(
  db: D1Database,
  songId: string,
  id: string,
): Promise<SongRecordingDto | null> {
  const row = await db
    .prepare("SELECT * FROM song_recordings WHERE song_id = ? AND id = ?")
    .bind(songId, id)
    .first<RecordingRow>();
  return row ? toRecordingDto(row) : null;
}

export async function getReferenceRecording(
  db: D1Database,
  songId: string,
): Promise<SongRecordingDto | null> {
  const row = await db
    .prepare("SELECT * FROM song_recordings WHERE song_id = ? AND is_reference = 1")
    .bind(songId)
    .first<RecordingRow>();
  return row ? toRecordingDto(row) : null;
}

/** Reference of every song of a band, for lists (songs, repertoires). */
export async function listReferenceSummaries(
  db: D1Database,
  bandId: string,
): Promise<Map<string, SongReferenceSummary>> {
  const { results } = await db
    .prepare(
      `SELECT r.* FROM song_recordings r JOIN songs s ON s.id = r.song_id
       WHERE s.band_id = ? AND s.deleted_at IS NULL AND r.is_reference = 1`,
    )
    .bind(bandId)
    .all<RecordingRow>();
  return new Map(results.map((r) => [r.song_id, toReferenceSummary(toRecordingDto(r))]));
}

/** Reference of every song in one repertoire. */
export async function listReferenceSummariesOfRepertoire(
  db: D1Database,
  repertoireId: string,
): Promise<Map<string, SongReferenceSummary>> {
  const { results } = await db
    .prepare(
      `SELECT r.* FROM song_recordings r JOIN repertoire_items i ON i.song_id = r.song_id
       WHERE i.repertoire_id = ? AND r.is_reference = 1`,
    )
    .bind(repertoireId)
    .all<RecordingRow>();
  return new Map(results.map((r) => [r.song_id, toReferenceSummary(toRecordingDto(r))]));
}

/**
 * The row of a song that already stands for the same recording: same catalogue id, or (when
 * there is none) the same video / track on the same platform.
 */
export async function findRecordingMatch(
  db: D1Database,
  songId: string,
  key: { mbid?: string | null; link?: ParsedReferenceLink | null },
): Promise<SongRecordingDto | null> {
  let row: RecordingRow | null = null;
  if (key.mbid) {
    row = await db
      .prepare("SELECT * FROM song_recordings WHERE song_id = ? AND mbid = ?")
      .bind(songId, key.mbid)
      .first<RecordingRow>();
  }
  if (!row && key.link) {
    // With a catalogue id in hand, a row found by link only counts if nobody identified it yet
    // (the band pasted the link first and found the catalogue entry later).
    row = await db
      .prepare(
        `SELECT * FROM song_recordings WHERE song_id = ? AND platform = ? AND external_id = ?
           ${key.mbid ? "AND mbid IS NULL" : ""}
         ORDER BY is_reference DESC, created_at DESC LIMIT 1`,
      )
      .bind(songId, key.link.platform, key.link.externalId)
      .first<RecordingRow>();
  }
  return row ? toRecordingDto(row) : null;
}

export interface RecordingInput {
  source: "musicbrainz" | "manual";
  mbid?: string | null;
  title: string;
  artistCredit?: string | null;
  disambiguation?: string | null;
  releaseTitle?: string | null;
  releaseMbid?: string | null;
  releaseDate?: string | null;
  durationMs?: number | null;
  isrcs?: string[];
  works?: RecordingWork[];
  links?: RecordingLink[];
  /** undefined keeps the link the row already has; null removes it. */
  link?: ReferenceLinkInfo | null;
  /** The member typed the title / artist instead of accepting what the platform said. */
  metadataEdited?: boolean;
  sourceUrl?: string | null;
  fetched?: boolean;
}

function linkColumns(link: ReferenceLinkInfo | null, ts: string) {
  return link
    ? [
        link.platform,
        link.externalId,
        link.url,
        link.title,
        link.author,
        link.thumbnailUrl,
        link.embeddable === null ? null : link.embeddable ? 1 : 0,
        ts,
      ]
    : [null, null, null, null, null, null, null, null];
}
const LINK_SET =
  "platform = ?, external_id = ?, link_url = ?, link_title = ?, link_author = ?, thumbnail_url = ?, embeddable = ?, link_checked_at = ?";

/**
 * Attaches a recording to a song and makes it the reference. The same recording is stored once
 * per song (see findRecordingMatch): attaching it again refreshes that row. The previous
 * reference is never deleted, only retired, so its analyses and history stay reachable.
 */
export async function upsertReferenceRecording(
  db: D1Database,
  songId: string,
  userId: string,
  input: RecordingInput,
): Promise<SongRecordingDto> {
  const ts = nowIso();
  const existing = await findRecordingMatch(db, songId, { mbid: input.mbid, link: input.link });
  const id = existing?.id ?? newId();
  const stmts: D1PreparedStatement[] = [
    // Retire the previous reference first: the unique index allows only one per song.
    db
      .prepare(
        "UPDATE song_recordings SET is_reference = 0, retired_at = ? WHERE song_id = ? AND id != ? AND is_reference = 1",
      )
      .bind(ts, songId, id),
  ];
  const edited = input.metadataEdited ? [userId, ts] : [null, null];
  if (existing) {
    // A catalogue entry is refreshed from the catalogue; a row identified by link or by hand
    // only takes the title / artist the member confirmed just now.
    if (input.source === "musicbrainz") {
      stmts.push(
        db
          .prepare(
            `UPDATE song_recordings SET source = 'musicbrainz', mbid = ?, title = ?, artist_credit = ?, disambiguation = ?,
               release_title = ?, release_mbid = ?, release_date = ?, duration_ms = ?, isrcs = ?, works = ?, links = ?,
               source_url = ?, fetched_at = ? WHERE id = ?`,
          )
          .bind(
            input.mbid ?? null,
            input.title,
            input.artistCredit ?? null,
            input.disambiguation ?? null,
            input.releaseTitle ?? null,
            input.releaseMbid ?? null,
            input.releaseDate ?? null,
            input.durationMs ?? null,
            JSON.stringify(input.isrcs ?? []),
            JSON.stringify(input.works ?? []),
            JSON.stringify(input.links ?? []),
            input.sourceUrl ?? null,
            input.fetched ? ts : existing.fetchedAt,
            id,
          ),
      );
    } else if (!existing.mbid) {
      stmts.push(
        db
          .prepare(
            `UPDATE song_recordings SET title = ?, artist_credit = ?,
               metadata_edited_by = COALESCE(?, metadata_edited_by), metadata_edited_at = COALESCE(?, metadata_edited_at)
             WHERE id = ?`,
          )
          .bind(input.title, input.artistCredit ?? null, ...edited, id),
      );
    }
    if (input.link !== undefined) {
      stmts.push(
        db
          .prepare(`UPDATE song_recordings SET ${LINK_SET} WHERE id = ?`)
          .bind(...linkColumns(input.link, ts), id),
      );
    }
    stmts.push(
      db
        .prepare(
          `UPDATE song_recordings SET is_reference = 1, retired_at = NULL,
             reference_since = CASE WHEN is_reference = 1 AND reference_since IS NOT NULL THEN reference_since ELSE ? END
           WHERE id = ?`,
        )
        .bind(ts, id),
    );
  } else {
    stmts.push(
      db
        .prepare(
          `INSERT INTO song_recordings (id, song_id, source, mbid, title, artist_credit, disambiguation, release_title,
             release_mbid, release_date, duration_ms, isrcs, works, links, source_url, fetched_at,
             platform, external_id, link_url, link_title, link_author, thumbnail_url, embeddable, link_checked_at,
             metadata_edited_by, metadata_edited_at, is_reference, reference_since, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .bind(
          id,
          songId,
          input.source,
          input.mbid ?? null,
          input.title,
          input.artistCredit ?? null,
          input.disambiguation ?? null,
          input.releaseTitle ?? null,
          input.releaseMbid ?? null,
          input.releaseDate ?? null,
          input.durationMs ?? null,
          JSON.stringify(input.isrcs ?? []),
          JSON.stringify(input.works ?? []),
          JSON.stringify(input.links ?? []),
          input.sourceUrl ?? null,
          input.fetched ? ts : null,
          ...linkColumns(input.link ?? null, ts),
          ...edited,
          ts,
          userId,
          ts,
        ),
    );
  }
  await db.batch(stmts);
  return (await getRecording(db, songId, id))!;
}

/** Changes only the link of a recording (same recording, another platform or a corrected link). */
export async function setRecordingLink(db: D1Database, id: string, link: ReferenceLinkInfo | null) {
  await db
    .prepare(`UPDATE song_recordings SET ${LINK_SET} WHERE id = ?`)
    .bind(...linkColumns(link, nowIso()), id)
    .run();
}

/** A member corrects the title or artist. What the platform said stays in link_title / link_author. */
export async function editRecordingMetadata(
  db: D1Database,
  id: string,
  userId: string,
  patch: { title?: string; artistCredit?: string | null },
) {
  const sets: string[] = ["metadata_edited_by = ?", "metadata_edited_at = ?"];
  const vals: unknown[] = [userId, nowIso()];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    vals.push(patch.title);
  }
  if (patch.artistCredit !== undefined) {
    sets.push("artist_credit = ?");
    vals.push(patch.artistCredit);
  }
  await db
    .prepare(`UPDATE song_recordings SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals, id)
    .run();
}

export async function updateRecordingDetails(
  db: D1Database,
  id: string,
  patch: {
    durationMs: number | null;
    isrcs: string[];
    works: RecordingWork[];
    links: RecordingLink[];
  },
) {
  await db
    .prepare(
      "UPDATE song_recordings SET duration_ms = COALESCE(?, duration_ms), isrcs = ?, works = ?, links = ?, fetched_at = ? WHERE id = ?",
    )
    .bind(
      patch.durationMs,
      JSON.stringify(patch.isrcs),
      JSON.stringify(patch.works),
      JSON.stringify(patch.links),
      nowIso(),
      id,
    )
    .run();
}

/**
 * What already depends on a reference recording: analyses computed from it, audio declared for
 * it, values the band confirmed while it was the reference, and arrangement work.
 */
export async function referenceDependents(
  db: D1Database,
  song: { id: string; versionId: string },
  recording: SongRecordingDto,
): Promise<ReferenceDependents> {
  const since = recording.referenceSince ?? recording.createdAt;
  const [analyses, audio, confirmed, sections, materials] = await Promise.all([
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM analysis_results WHERE song_id = ? AND recording_id = ? AND origin = 'audio_analysis'",
      )
      .bind(song.id, recording.id)
      .first<{ n: number }>(),
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM audio_assets WHERE song_id = ? AND recording_id = ? AND deleted_at IS NULL",
      )
      .bind(song.id, recording.id)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT DISTINCT target FROM review_events
         WHERE song_id = ? AND target IN ('band_bpm', 'band_key', 'band_meter') AND created_at >= ?`,
      )
      .bind(song.id, since)
      .all<{ target: string }>(),
    db
      .prepare("SELECT COUNT(*) AS n FROM song_sections WHERE version_id = ?")
      .bind(song.versionId)
      .first<{ n: number }>(),
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM song_materials WHERE song_id = ? AND deleted_at IS NULL AND status != 'pending'",
      )
      .bind(song.id)
      .first<{ n: number }>(),
  ]);
  return {
    analyses: analyses?.n ?? 0,
    audioAssets: audio?.n ?? 0,
    confirmedValues: confirmed.results.map((r) => r.target),
    sections: sections?.n ?? 0,
    readyMaterials: materials?.n ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Authorised audio                                                    */
/* ------------------------------------------------------------------ */

interface AssetRow {
  id: string;
  song_id: string;
  recording_id: string | null;
  file_id: string;
  file_name: string;
  rights_basis: AudioRights;
  rights_note: string | null;
  declared_by: string;
  declared_at: string;
}

const toAssetDto = (r: AssetRow): AudioAssetDto => ({
  id: r.id,
  songId: r.song_id,
  recordingId: r.recording_id,
  fileId: r.file_id,
  fileName: r.file_name,
  rightsBasis: r.rights_basis,
  rightsNote: r.rights_note,
  declaredBy: r.declared_by,
  declaredAt: r.declared_at,
});

const ASSET_SELECT = `SELECT a.id, a.song_id, a.recording_id, a.file_id, f.name AS file_name, a.rights_basis, a.rights_note,
  a.declared_by, a.declared_at FROM audio_assets a JOIN files f ON f.id = a.file_id`;

export async function listAudioAssets(db: D1Database, songId: string): Promise<AudioAssetDto[]> {
  const { results } = await db
    .prepare(
      `${ASSET_SELECT} WHERE a.song_id = ? AND a.deleted_at IS NULL AND f.deleted_at IS NULL ORDER BY a.declared_at`,
    )
    .bind(songId)
    .all<AssetRow>();
  return results.map(toAssetDto);
}

export async function getAudioAsset(
  db: D1Database,
  songId: string,
  id: string,
): Promise<AudioAssetDto | null> {
  const row = await db
    .prepare(
      `${ASSET_SELECT} WHERE a.song_id = ? AND a.id = ? AND a.deleted_at IS NULL AND f.deleted_at IS NULL`,
    )
    .bind(songId, id)
    .first<AssetRow>();
  return row ? toAssetDto(row) : null;
}

export async function createAudioAsset(
  db: D1Database,
  input: {
    bandId: string;
    songId: string;
    recordingId: string | null;
    fileId: string;
    rightsBasis: AudioRights;
    rightsNote: string | null;
    userId: string;
  },
): Promise<string> {
  const id = newId();
  await db
    .prepare(
      `INSERT INTO audio_assets (id, band_id, song_id, recording_id, file_id, rights_basis, rights_note, declared_by, declared_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.bandId,
      input.songId,
      input.recordingId,
      input.fileId,
      input.rightsBasis,
      input.rightsNote,
      input.userId,
      nowIso(),
    )
    .run();
  return id;
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export interface JobRow {
  id: string;
  band_id: string;
  song_id: string;
  recording_id: string | null;
  audio_asset_id: string | null;
  pipeline_version: string;
  status: JobStatus;
  steps: string;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  cost_units: number;
  dedupe_key: string;
  active: number;
  locale: string;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export function toJobDto(r: JobRow): AnalysisJobDto {
  const steps = parse<JobStepRecord[]>(r.steps, []);
  return {
    id: r.id,
    songId: r.song_id,
    recordingId: r.recording_id,
    audioAssetId: r.audio_asset_id,
    status: r.status,
    progress: jobProgress(r.status, steps),
    steps,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    costUnits: r.cost_units,
    requestedBy: r.requested_by,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export async function getJobRow(db: D1Database, id: string): Promise<JobRow | null> {
  return db.prepare("SELECT * FROM analysis_jobs WHERE id = ?").bind(id).first<JobRow>();
}

export async function getJobForBand(
  db: D1Database,
  bandId: string,
  id: string,
): Promise<JobRow | null> {
  return db
    .prepare("SELECT * FROM analysis_jobs WHERE band_id = ? AND id = ?")
    .bind(bandId, id)
    .first<JobRow>();
}

export async function findActiveJob(db: D1Database, dedupeKey: string): Promise<JobRow | null> {
  return db
    .prepare("SELECT * FROM analysis_jobs WHERE dedupe_key = ? AND active = 1")
    .bind(dedupeKey)
    .first<JobRow>();
}

export async function listJobs(db: D1Database, songId: string): Promise<AnalysisJobDto[]> {
  const { results } = await db
    .prepare("SELECT * FROM analysis_jobs WHERE song_id = ? ORDER BY created_at DESC LIMIT 20")
    .bind(songId)
    .all<JobRow>();
  return results.map(toJobDto);
}

export async function countRecentJobs(
  db: D1Database,
  bandId: string,
  sinceIso: string,
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM analysis_jobs WHERE band_id = ? AND created_at >= ?")
    .bind(bandId, sinceIso)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function insertJob(
  db: D1Database,
  input: {
    bandId: string;
    songId: string;
    recordingId: string | null;
    audioAssetId: string | null;
    pipelineVersion: string;
    dedupeKey: string;
    maxAttempts: number;
    locale: string;
    userId: string;
  },
): Promise<string> {
  const id = newId();
  await db
    .prepare(
      `INSERT INTO analysis_jobs (id, band_id, song_id, recording_id, audio_asset_id, pipeline_version, status, dedupe_key,
         max_attempts, locale, requested_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.bandId,
      input.songId,
      input.recordingId,
      input.audioAssetId,
      input.pipelineVersion,
      input.dedupeKey,
      input.maxAttempts,
      input.locale,
      input.userId,
      nowIso(),
    )
    .run();
  return id;
}

/** Applies a partial update; `active` follows the status automatically. */
export async function updateJob(
  db: D1Database,
  id: string,
  patch: Partial<{
    status: JobStatus;
    steps: JobStepRecord[];
    attempts: number;
    errorCode: string | null;
    errorMessage: string | null;
    costUnits: number;
    startedAt: string | null;
    finishedAt: string | null;
  }>,
) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if (patch.status !== undefined) {
    add("status", patch.status);
    add("active", isActiveJob(patch.status) ? 1 : 0);
  }
  if (patch.steps !== undefined) add("steps", JSON.stringify(patch.steps));
  if (patch.attempts !== undefined) add("attempts", patch.attempts);
  if (patch.errorCode !== undefined) add("error_code", patch.errorCode);
  if (patch.errorMessage !== undefined) add("error_message", patch.errorMessage);
  if (patch.costUnits !== undefined) add("cost_units", patch.costUnits);
  if (patch.startedAt !== undefined) add("started_at", patch.startedAt);
  if (patch.finishedAt !== undefined) add("finished_at", patch.finishedAt);
  if (sets.length === 0) return;
  vals.push(id);
  await db
    .prepare(`UPDATE analysis_jobs SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

interface ResultRow {
  id: string;
  song_id: string;
  recording_id: string | null;
  job_id: string | null;
  kind: ResultKind;
  value: string;
  method: string;
  method_version: string | null;
  confidence: number | null;
  confidence_calibrated: number;
  origin: ResultOrigin;
  source_url: string | null;
  review_status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
}

const toResultDto = (r: ResultRow): AnalysisResultDto => ({
  id: r.id,
  songId: r.song_id,
  recordingId: r.recording_id,
  jobId: r.job_id,
  kind: r.kind,
  value: parse<Record<string, unknown>>(r.value, {}),
  method: r.method,
  methodVersion: r.method_version,
  confidence: r.confidence,
  confidenceCalibrated: r.confidence_calibrated === 1,
  origin: r.origin,
  sourceUrl: r.source_url,
  reviewStatus: r.review_status,
  reviewedBy: r.reviewed_by,
  reviewedByName: r.reviewed_by_name,
  reviewedAt: r.reviewed_at,
  createdAt: r.created_at,
});

const RESULT_SELECT = `SELECT r.*, u.display_name AS reviewed_by_name FROM analysis_results r
  LEFT JOIN users u ON u.id = r.reviewed_by`;

export async function listResults(db: D1Database, songId: string): Promise<AnalysisResultDto[]> {
  const { results } = await db
    .prepare(`${RESULT_SELECT} WHERE r.song_id = ? ORDER BY r.created_at DESC, r.kind`)
    .bind(songId)
    .all<ResultRow>();
  return results.map(toResultDto);
}

export async function getResult(
  db: D1Database,
  songId: string,
  id: string,
): Promise<AnalysisResultDto | null> {
  const row = await db
    .prepare(`${RESULT_SELECT} WHERE r.song_id = ? AND r.id = ?`)
    .bind(songId, id)
    .first<ResultRow>();
  return row ? toResultDto(row) : null;
}

export interface ResultInput {
  bandId: string;
  songId: string;
  recordingId: string | null;
  jobId: string | null;
  kind: ResultKind;
  value: Record<string, unknown>;
  method: string;
  methodVersion?: string | null;
  confidence?: number | null;
  confidenceCalibrated?: boolean;
  origin: ResultOrigin;
  sourceUrl?: string | null;
}

/**
 * Stores a result. The same fact from the same method for the same recording is stored once:
 * re-running a job does not pile up identical rows.
 */
export async function insertResult(
  db: D1Database,
  input: ResultInput,
): Promise<{ id: string; created: boolean }> {
  const value = JSON.stringify(input.value);
  const dup = await db
    .prepare(
      `SELECT id FROM analysis_results WHERE song_id = ? AND kind = ? AND method = ? AND value = ?
         AND COALESCE(recording_id, '') = COALESCE(?, '')`,
    )
    .bind(input.songId, input.kind, input.method, value, input.recordingId)
    .first<{ id: string }>();
  if (dup) return { id: dup.id, created: false };
  const id = newId();
  const calibrated = input.confidenceCalibrated ?? false;
  await db
    .prepare(
      `INSERT INTO analysis_results (id, band_id, song_id, recording_id, job_id, kind, value, method, method_version, confidence,
         confidence_calibrated, origin, source_url, review_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.bandId,
      input.songId,
      input.recordingId,
      input.jobId,
      input.kind,
      value,
      input.method,
      input.methodVersion ?? null,
      input.confidence ?? null,
      calibrated ? 1 : 0,
      input.origin,
      input.sourceUrl ?? null,
      initialReviewStatus(input.origin, input.confidence ?? null, calibrated),
      nowIso(),
    )
    .run();
  return { id, created: true };
}

export async function setResultReview(
  db: D1Database,
  id: string,
  status: ReviewStatus,
  userId: string,
) {
  await db
    .prepare(
      "UPDATE analysis_results SET review_status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
    )
    .bind(status, userId, nowIso(), id)
    .run();
}

/* ------------------------------------------------------------------ */
/* Review events                                                       */
/* ------------------------------------------------------------------ */

interface ReviewRow {
  id: string;
  song_id: string;
  target: string;
  action: "confirm" | "edit" | "reject";
  before: string | null;
  after: string | null;
  result_id: string | null;
  user_id: string;
  user_name: string | null;
  created_at: string;
}

const toReviewDto = (r: ReviewRow): ReviewEventDto => ({
  id: r.id,
  songId: r.song_id,
  target: r.target,
  action: r.action,
  before: parse<unknown>(r.before, null),
  after: parse<unknown>(r.after, null),
  resultId: r.result_id,
  userId: r.user_id,
  userName: r.user_name,
  createdAt: r.created_at,
});

export async function insertReviewEvent(
  db: D1Database,
  input: {
    bandId: string;
    songId: string;
    target: string;
    action: "confirm" | "edit" | "reject";
    before: unknown;
    after: unknown;
    resultId: string | null;
    userId: string;
  },
): Promise<string> {
  const id = newId();
  await db
    .prepare(
      `INSERT INTO review_events (id, band_id, song_id, target, action, before, after, result_id, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.bandId,
      input.songId,
      input.target,
      input.action,
      JSON.stringify(input.before ?? null),
      JSON.stringify(input.after ?? null),
      input.resultId,
      input.userId,
      nowIso(),
    )
    .run();
  return id;
}

export async function listReviewEvents(db: D1Database, songId: string): Promise<ReviewEventDto[]> {
  const { results } = await db
    .prepare(
      `SELECT e.*, u.display_name AS user_name FROM review_events e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.song_id = ? ORDER BY e.created_at DESC LIMIT 100`,
    )
    .bind(songId)
    .all<ReviewRow>();
  return results.map(toReviewDto);
}

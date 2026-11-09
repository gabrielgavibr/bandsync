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
  type RecordingLink,
  type RecordingWork,
  type ResultKind,
  type ResultOrigin,
  type ReviewEventDto,
  type ReviewStatus,
  type SongRecordingDto,
  type YouTubeVideoInfo,
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
  youtube: string | null;
  is_reference: number;
  source_url: string | null;
  fetched_at: string | null;
  created_at: string;
}

function toRecordingDto(r: RecordingRow): SongRecordingDto {
  return {
    id: r.id,
    songId: r.song_id,
    source: r.source,
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
    youtube: parse<YouTubeVideoInfo | null>(r.youtube, null),
    isReference: r.is_reference === 1,
    sourceUrl: r.source_url,
    fetchedAt: r.fetched_at,
    createdAt: r.created_at,
  };
}

export async function listRecordings(db: D1Database, songId: string): Promise<SongRecordingDto[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM song_recordings WHERE song_id = ? ORDER BY is_reference DESC, created_at",
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
  youtube?: YouTubeVideoInfo | null;
  sourceUrl?: string | null;
  fetched?: boolean;
}

/**
 * Attaches a recording to a song and makes it the reference. The same MusicBrainz recording is
 * stored once per song: attaching it again refreshes that row instead of creating another.
 */
export async function upsertReferenceRecording(
  db: D1Database,
  songId: string,
  userId: string,
  input: RecordingInput,
): Promise<SongRecordingDto> {
  const ts = nowIso();
  const existing = input.mbid
    ? await db
        .prepare("SELECT * FROM song_recordings WHERE song_id = ? AND mbid = ?")
        .bind(songId, input.mbid)
        .first<RecordingRow>()
    : null;
  const id = existing?.id ?? newId();
  const youtube =
    input.youtube === undefined
      ? (existing?.youtube ?? null)
      : input.youtube
        ? JSON.stringify(input.youtube)
        : null;
  const stmts: D1PreparedStatement[] = [
    // Clear the previous reference first: the unique index allows only one per song.
    db
      .prepare("UPDATE song_recordings SET is_reference = 0 WHERE song_id = ? AND id != ?")
      .bind(songId, id),
  ];
  const values = [
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
    youtube,
    input.sourceUrl ?? null,
    input.fetched ? ts : (existing?.fetched_at ?? null),
  ];
  if (existing) {
    stmts.push(
      db
        .prepare(
          `UPDATE song_recordings SET title = ?, artist_credit = ?, disambiguation = ?, release_title = ?, release_mbid = ?,
             release_date = ?, duration_ms = ?, isrcs = ?, works = ?, links = ?, youtube = ?, source_url = ?, fetched_at = ?,
             is_reference = 1 WHERE id = ?`,
        )
        .bind(...values, id),
    );
  } else {
    stmts.push(
      db
        .prepare(
          `INSERT INTO song_recordings (title, artist_credit, disambiguation, release_title, release_mbid, release_date,
             duration_ms, isrcs, works, links, youtube, source_url, fetched_at, id, song_id, source, mbid, is_reference,
             created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(...values, id, songId, input.source, input.mbid ?? null, userId, ts),
    );
  }
  await db.batch(stmts);
  return (await getRecording(db, songId, id))!;
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

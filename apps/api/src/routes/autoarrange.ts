import {
  BAND_DAILY_JOB_LIMIT,
  createAudioAssetSchema,
  isActiveJob,
  JOB_MAX_ATTEMPTS,
  type JobStepRecord,
  jobDedupeKey,
  PIPELINE_VERSION,
  pickDefaultRelease,
  prepareSongSchema,
  type RecordingDetails,
  recordingPageUrl,
  reviewSchema,
  searchRecordingsSchema,
  workAuthors,
  type YouTubeVideoInfo,
  youtubeLookupSchema,
} from "@bandsync/shared";
import { type Context, Hono } from "hono";
import { musicBrainz, youtubeVideoInfo } from "../autoarrange/clients";
import { CONNECTORS } from "../autoarrange/connectors";
import { audit } from "../db/audit";
import {
  countRecentJobs,
  createAudioAsset,
  findActiveJob,
  getAudioAsset,
  getJobForBand,
  getResult,
  insertJob,
  insertReviewEvent,
  listAudioAssets,
  listJobs,
  listRecordings,
  listResults,
  listReviewEvents,
  setResultReview,
  toJobDto,
  updateJob,
  upsertReferenceRecording,
} from "../db/autoarrange";
import { getFile } from "../db/files";
import { createSong, getSong, updateSong } from "../db/songs";
import type { AppEnv } from "../env";
import { ApiError, notFound } from "../lib/errors";
import { p } from "../lib/params";
import { enforceRateLimit } from "../lib/ratelimit";
import { DAY_MS, nowIso } from "../lib/time";
import { parseBody } from "../lib/validate";
import { requireAuth, requireMembership, requireRepertoireEditor } from "../middleware/auth";

export const autoArrangeRoutes = new Hono<AppEnv>();
autoArrangeRoutes.use("*", requireAuth, requireMembership);

/** Per-user limit on calls that reach external services. */
async function limitExternal(c: Context<AppEnv>, bucket: string, perMinute: number) {
  if (c.env.RATE_LIMITS === "off") return;
  if (c.env.APP_ENV === "test" && c.req.header("x-test-ratelimit") !== "1") return;
  await enforceRateLimit(c.env.DB, `${bucket}:${c.get("user").id}`, perMinute, 60_000);
}

function jobStub(c: Context<AppEnv>, jobId: string) {
  return c.env.PREPARE_JOB.get(c.env.PREPARE_JOB.idFromName(jobId));
}

async function startJob(c: Context<AppEnv>, jobId: string) {
  await jobStub(c, jobId).fetch("https://job/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId }),
  });
}

/* ---------------- sources ---------------- */

autoArrangeRoutes.get("/connectors", (c) =>
  c.json({
    connectors: CONNECTORS,
    // Stated plainly so the UI never suggests an analysis that cannot happen.
    engines: { audioAnalysis: "not_configured" },
  }),
);

/* ---------------- identify the recording ---------------- */

autoArrangeRoutes.get("/search", requireRepertoireEditor, async (c) => {
  await limitExternal(c, "mb-search", 30);
  const parsed = searchRecordingsSchema.safeParse({
    title: c.req.query("title") ?? "",
    artist: c.req.query("artist") || undefined,
  });
  if (!parsed.success) throw new ApiError("validation_error", "title is required");
  const recordings = await musicBrainz(c.env).search(parsed.data);
  return c.json({ source: "musicbrainz", query: parsed.data, recordings });
});

autoArrangeRoutes.get("/recordings/:mbid", requireRepertoireEditor, async (c) => {
  await limitExternal(c, "mb-lookup", 30);
  const mbid = p(c, "mbid");
  if (!/^[0-9a-f-]{36}$/.test(mbid)) throw new ApiError("validation_error", "invalid recording id");
  const recording = await musicBrainz(c.env).lookup(mbid);
  if (!recording) throw notFound("recording");
  return c.json({
    recording,
    defaultRelease: pickDefaultRelease(recording.releases),
    authors: workAuthors(recording.works),
  });
});

autoArrangeRoutes.post("/youtube", requireRepertoireEditor, async (c) => {
  await limitExternal(c, "yt-lookup", 20);
  const { url } = await parseBody(c, youtubeLookupSchema);
  const video = await youtubeVideoInfo(c.env, url);
  if (!video) throw new ApiError("validation_error", "not an available YouTube video");
  return c.json({ video });
});

/* ---------------- prepare ---------------- */

autoArrangeRoutes.post("/prepare", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const user = c.get("user");
  const input = await parseBody(c, prepareSongSchema);
  await limitExternal(c, "prepare", 20);
  if (
    (await countRecentJobs(c.env.DB, bandId, new Date(Date.now() - DAY_MS).toISOString())) >=
    BAND_DAILY_JOB_LIMIT
  ) {
    throw new ApiError("rate_limited", "daily preparation limit reached for this band");
  }

  // 1. Resolve the chosen recording from the source itself (never from client-supplied metadata).
  let details: RecordingDetails | null = null;
  if (input.recording.source === "musicbrainz") {
    details = await musicBrainz(c.env).lookup(input.recording.mbid);
    if (!details) throw notFound("recording");
  }
  let video: YouTubeVideoInfo | null = null;
  if (input.youtubeUrl) {
    video = await youtubeVideoInfo(c.env, input.youtubeUrl);
    if (!video) throw new ApiError("validation_error", "not an available YouTube video");
  }
  const release = details
    ? ((input.recording.source === "musicbrainz" && input.recording.releaseMbid
        ? details.releases.find(
            (r) => r.mbid === (input.recording as { releaseMbid?: string | null }).releaseMbid,
          )
        : null) ?? pickDefaultRelease(details.releases))
    : null;

  // 2. The song: an existing one, or a new one created from verified data only.
  let songId = input.songId ?? null;
  let created = false;
  if (songId) {
    if (!(await getSong(c.env.DB, bandId, songId))) throw notFound("song");
  } else {
    const authors = details ? workAuthors(details.works) : [];
    const sourceUrl = details ? recordingPageUrl(details.mbid) : null;
    const note = "MusicBrainz";
    const manual = input.recording.source === "manual" ? input.recording : null;
    const year = (release?.date ?? details?.firstReleaseDate ?? manual?.releaseDate ?? "").slice(
      0,
      4,
    );
    songId = await createSong(c.env.DB, bandId, user.id, {
      title: input.newSong!.title,
      artist: details?.artistCredit || manual?.artistCredit || null,
      composer: authors.length > 0 ? authors.join(", ") : null,
      referenceRecording: release?.title ?? manual?.releaseTitle ?? null,
      referenceYear: /^\d{4}$/.test(year) ? Number(year) : null,
      durationSeconds: details?.durationMs ? Math.round(details.durationMs / 1000) : null,
      originalBpmStatus: "unknown",
      originalKeyStatus: "unknown",
      metadataSources: details
        ? [
            { field: "recording", value: details.artistCredit, url: sourceUrl, note },
            ...(authors.length > 0
              ? [
                  {
                    field: "composer" as const,
                    value: authors.join(", "),
                    url: details.works[0]?.url ?? sourceUrl,
                    note,
                  },
                ]
              : []),
            ...(details.durationMs
              ? [
                  {
                    field: "duration" as const,
                    value: `${Math.round(details.durationMs / 1000)} s`,
                    url: sourceUrl,
                    note,
                  },
                ]
              : []),
          ]
        : [],
      // Tempo, key and meter are never guessed: the band version starts unset / unconfirmed.
      version: {
        bpm: null,
        key: null,
        beatsPerBar: 4,
        beatUnit: 4,
        meterConfirmed: false,
        referenceUrl: video?.url ?? null,
      },
    });
    if (details?.works[0])
      await updateSong(c.env.DB, bandId, songId, { workMbid: details.works[0].mbid });
    created = true;
    await audit(c.env.DB, {
      bandId,
      actorUserId: user.id,
      action: "song.created",
      targetType: "song",
      targetId: songId,
      metadata: { via: "autoarrange" },
    });
  }

  // 3. The reference recording of that song.
  const recording = await upsertReferenceRecording(
    c.env.DB,
    songId,
    user.id,
    details
      ? {
          source: "musicbrainz",
          mbid: details.mbid,
          title: details.title,
          artistCredit: details.artistCredit,
          disambiguation: details.disambiguation,
          releaseTitle: release?.title ?? null,
          releaseMbid: release?.mbid ?? null,
          releaseDate: release?.date ?? details.firstReleaseDate,
          durationMs: details.durationMs,
          isrcs: details.isrcs,
          works: details.works,
          links: details.links,
          youtube: video ?? undefined,
          sourceUrl: recordingPageUrl(details.mbid),
          fetched: true,
        }
      : {
          source: "manual",
          title: (input.recording as { title: string }).title,
          artistCredit: (input.recording as { artistCredit?: string | null }).artistCredit ?? null,
          releaseTitle: (input.recording as { releaseTitle?: string | null }).releaseTitle ?? null,
          releaseDate: (input.recording as { releaseDate?: string | null }).releaseDate ?? null,
          youtube: video ?? undefined,
        },
  );

  if (input.audioAssetId && !(await getAudioAsset(c.env.DB, songId, input.audioAssetId)))
    throw notFound("audio asset");

  // 4. One active job per song + recording + audio file: pressing "Prepare" twice reuses it.
  const dedupeKey = jobDedupeKey({
    songId,
    recordingId: recording.id,
    audioAssetId: input.audioAssetId ?? null,
    pipelineVersion: PIPELINE_VERSION,
  });
  let reused = false;
  let jobRow = await findActiveJob(c.env.DB, dedupeKey);
  if (jobRow && jobRow.status === "awaiting_review") {
    // A finished run waiting for review does not block a new run; it is closed first.
    await updateJob(c.env.DB, jobRow.id, { status: "completed", finishedAt: nowIso() });
    jobRow = null;
  }
  if (jobRow) {
    reused = true;
  } else {
    const jobId = await insertJob(c.env.DB, {
      bandId,
      songId,
      recordingId: recording.id,
      audioAssetId: input.audioAssetId ?? null,
      pipelineVersion: PIPELINE_VERSION,
      dedupeKey,
      maxAttempts: JOB_MAX_ATTEMPTS,
      locale: input.locale ?? user.locale ?? "en",
      userId: user.id,
    });
    await startJob(c, jobId);
    jobRow = (await getJobForBand(c.env.DB, bandId, jobId))!;
  }

  return c.json(
    {
      song: await getSong(c.env.DB, bandId, songId),
      recording,
      job: toJobDto(jobRow),
      songCreated: created,
      reused,
    },
    reused ? 200 : 201,
  );
});

/* ---------------- jobs ---------------- */

autoArrangeRoutes.get("/jobs/:jobId", async (c) => {
  const row = await getJobForBand(c.env.DB, p(c, "bandId"), p(c, "jobId"));
  if (!row) throw notFound("job");
  return c.json({ job: toJobDto(row) });
});

autoArrangeRoutes.post("/jobs/:jobId/cancel", requireRepertoireEditor, async (c) => {
  const row = await getJobForBand(c.env.DB, p(c, "bandId"), p(c, "jobId"));
  if (!row) throw notFound("job");
  if (!isActiveJob(row.status)) throw new ApiError("conflict", "job is not active");
  await updateJob(c.env.DB, row.id, { status: "cancelled", finishedAt: nowIso() });
  await jobStub(c, row.id).fetch("https://job/stop", { method: "POST" });
  return c.json({ job: toJobDto((await getJobForBand(c.env.DB, row.band_id, row.id))!) });
});

autoArrangeRoutes.post("/jobs/:jobId/retry", requireRepertoireEditor, async (c) => {
  const row = await getJobForBand(c.env.DB, p(c, "bandId"), p(c, "jobId"));
  if (!row) throw notFound("job");
  if (row.status !== "failed" && row.status !== "cancelled")
    throw new ApiError("conflict", "only failed or cancelled jobs can be retried");
  if (await findActiveJob(c.env.DB, row.dedupe_key))
    throw new ApiError("conflict", "another job for the same work is active");
  let steps: JobStepRecord[] = [];
  try {
    steps = (JSON.parse(row.steps) as JobStepRecord[]).filter((s) => s.outcome !== "failed");
  } catch {
    steps = [];
  }
  await updateJob(c.env.DB, row.id, {
    status: "pending",
    steps,
    attempts: 0,
    errorCode: null,
    errorMessage: null,
    finishedAt: null,
  });
  await startJob(c, row.id);
  return c.json({ job: toJobDto((await getJobForBand(c.env.DB, row.band_id, row.id))!) });
});

/** Closes the review: the member has looked at what the preparation produced. */
autoArrangeRoutes.post("/jobs/:jobId/complete", requireRepertoireEditor, async (c) => {
  const row = await getJobForBand(c.env.DB, p(c, "bandId"), p(c, "jobId"));
  if (!row) throw notFound("job");
  if (row.status !== "awaiting_review")
    throw new ApiError("conflict", "job is not awaiting review");
  await updateJob(c.env.DB, row.id, { status: "completed", finishedAt: nowIso() });
  await audit(c.env.DB, {
    bandId: row.band_id,
    actorUserId: c.get("user").id,
    action: "autoarrange.review_completed",
    targetType: "song",
    targetId: row.song_id,
  });
  return c.json({ job: toJobDto((await getJobForBand(c.env.DB, row.band_id, row.id))!) });
});

/* ---------------- per-song overview, review and audio ---------------- */

async function overview(c: Context<AppEnv>, bandId: string, songId: string) {
  const db = c.env.DB;
  const [recordings, jobs, results, reviews, audioAssets] = await Promise.all([
    listRecordings(db, songId),
    listJobs(db, songId),
    listResults(db, songId),
    listReviewEvents(db, songId),
    listAudioAssets(db, songId),
  ]);
  const latest = (target: string) => {
    const e = reviews.find((r) => r.target === target);
    return e
      ? {
          value: e.after,
          userId: e.userId,
          userName: e.userName,
          at: e.createdAt,
          action: e.action,
        }
      : null;
  };
  return {
    song: await getSong(db, bandId, songId),
    recordings,
    jobs,
    results,
    reviews,
    audioAssets,
    confirmations: {
      band_bpm: latest("band_bpm"),
      band_key: latest("band_key"),
      band_meter: latest("band_meter"),
    },
    engines: { audioAnalysis: "not_configured" as const },
  };
}

autoArrangeRoutes.get("/songs/:songId", async (c) => {
  const bandId = p(c, "bandId");
  const song = await getSong(c.env.DB, bandId, p(c, "songId"));
  if (!song) throw notFound("song");
  return c.json(await overview(c, bandId, song.id));
});

/**
 * A member confirms or corrects a musical value of the band's version. The value goes to the
 * band version (which feeds the live rehearsal); the analysis result it refers to keeps its
 * original value and only gains a review status; and the event records who did it and when.
 */
autoArrangeRoutes.post("/songs/:songId/review", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const user = c.get("user");
  const song = await getSong(c.env.DB, bandId, p(c, "songId"));
  if (!song) throw notFound("song");
  const input = await parseBody(c, reviewSchema);
  const result = input.resultId ? await getResult(c.env.DB, song.id, input.resultId) : null;
  if (input.resultId && !result) throw notFound("result");

  let before: unknown;
  let after: unknown;
  let matchesResult = false;
  if (input.target === "band_bpm") {
    before = { bpm: song.version.bpm };
    after = { bpm: input.bpm };
    matchesResult = result?.kind === "bpm" && Number(result.value.bpm) === input.bpm;
    await updateSong(c.env.DB, bandId, song.id, {
      version: { ...versionOf(song), bpm: input.bpm },
    });
  } else if (input.target === "band_key") {
    before = { key: song.version.key };
    after = { key: input.key };
    matchesResult = result?.kind === "key" && String(result.value.key) === input.key;
    await updateSong(c.env.DB, bandId, song.id, {
      version: { ...versionOf(song), key: input.key },
    });
  } else {
    before = {
      beatsPerBar: song.version.beatsPerBar,
      beatUnit: song.version.beatUnit,
      confirmed: song.version.meterConfirmed,
    };
    after = { beatsPerBar: input.beatsPerBar, beatUnit: input.beatUnit, confirmed: true };
    matchesResult =
      result?.kind === "time_signature" &&
      Number(result.value.beatsPerBar) === input.beatsPerBar &&
      Number(result.value.beatUnit) === input.beatUnit;
    await updateSong(c.env.DB, bandId, song.id, {
      version: {
        ...versionOf(song),
        beatsPerBar: input.beatsPerBar,
        beatUnit: input.beatUnit,
        meterConfirmed: true,
      },
    });
  }
  const action = result ? (matchesResult ? "confirm" : "edit") : "confirm";
  if (result)
    await setResultReview(c.env.DB, result.id, matchesResult ? "confirmed" : "edited", user.id);
  await insertReviewEvent(c.env.DB, {
    bandId,
    songId: song.id,
    target: input.target,
    action,
    before,
    after,
    resultId: result?.id ?? null,
    userId: user.id,
  });
  return c.json(await overview(c, bandId, song.id));
});

/** updateSong replaces only the version fields it is given; this keeps the meter when changing tempo, etc. */
function versionOf(song: NonNullable<Awaited<ReturnType<typeof getSong>>>) {
  return { beatsPerBar: song.version.beatsPerBar, beatUnit: song.version.beatUnit };
}

autoArrangeRoutes.post("/songs/:songId/audio-assets", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const song = await getSong(c.env.DB, bandId, p(c, "songId"));
  if (!song) throw notFound("song");
  const input = await parseBody(c, createAudioAssetSchema);
  const file = await getFile(c.env.DB, bandId, input.fileId);
  if (!file) throw notFound("file");
  if (!file.content_type.startsWith("audio/"))
    throw new ApiError("unsupported_media", "the file is not audio");
  const id = await createAudioAsset(c.env.DB, {
    bandId,
    songId: song.id,
    recordingId: input.recordingId ?? null,
    fileId: file.id,
    rightsBasis: input.rightsBasis,
    rightsNote: input.rightsNote ?? null,
    userId: c.get("user").id,
  });
  await audit(c.env.DB, {
    bandId,
    actorUserId: c.get("user").id,
    action: "audio_asset.declared",
    targetType: "song",
    targetId: song.id,
    metadata: { assetId: id, rightsBasis: input.rightsBasis },
  });
  return c.json({ audioAsset: await getAudioAsset(c.env.DB, song.id, id) }, 201);
});

import {
  BAND_DAILY_JOB_LIMIT,
  createAudioAssetSchema,
  editReferenceSchema,
  hasReferenceDependents,
  identifyReferenceSchema,
  isActiveJob,
  JOB_MAX_ATTEMPTS,
  type JobStepRecord,
  jobDedupeKey,
  PIPELINE_VERSION,
  type PreparationState,
  parseReferenceLink,
  pickDefaultRelease,
  prepareSongSchema,
  type RecordingDetails,
  type ReferenceLinkInfo,
  type ReferencePlatform,
  type ResultKind,
  recordingPageUrl,
  reviewSchema,
  type SongDto,
  type SongRecordingDto,
  searchRecordingsSchema,
  setReferenceLinkSchema,
  submitAnalysisSchema,
  workAuthors,
  youtubeLookupSchema,
} from "@bandsync/shared";
import { type Context, Hono } from "hono";
import { identifyReferenceLink, musicBrainz, youtubeVideoInfo } from "../autoarrange/clients";
import { CONNECTORS } from "../autoarrange/connectors";
import { audit } from "../db/audit";
import {
  countRecentJobs,
  createAudioAsset,
  editRecordingMetadata,
  findActiveJob,
  findRecordingMatch,
  getAudioAsset,
  getJobForBand,
  getRecording,
  getReferenceRecording,
  getResult,
  insertJob,
  insertResult,
  insertReviewEvent,
  listAudioAssets,
  listJobs,
  listRecordings,
  listResults,
  listReviewEvents,
  referenceDependents,
  setRecordingLink,
  setResultReview,
  songsUsingLink,
  toJobDto,
  toReferenceSummary,
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

/* ---------------- reference link ---------------- */

const PLATFORM_NAMES: Record<ReferencePlatform, string> = {
  youtube: "YouTube",
  youtube_music: "YouTube Music",
  spotify: "Spotify",
};

/**
 * Reads a pasted link through its platform's connector. The errors are the states the interface
 * shows: not a link to one recording, a site without a connector, or a recording the platform
 * does not know.
 */
async function resolveReferenceLink(c: Context<AppEnv>, raw: string): Promise<ReferenceLinkInfo> {
  const parsed = parseReferenceLink(raw);
  if (!parsed.ok) {
    if (parsed.reason === "unsupported_platform")
      throw new ApiError("unsupported_platform", "no connector for this site", {
        reason: parsed.reason,
      });
    throw new ApiError("validation_error", "not a link to one recording", {
      reason: parsed.reason,
    });
  }
  const info = await identifyReferenceLink(c.env, parsed.link);
  if (!info)
    throw new ApiError("not_found", "the platform does not know this recording", {
      reason: "reference_not_found",
    });
  return info;
}

autoArrangeRoutes.post("/reference/identify", requireRepertoireEditor, async (c) => {
  await limitExternal(c, "ref-identify", 30);
  const { url, songId } = await parseBody(c, identifyReferenceSchema);
  const reference = await resolveReferenceLink(c, url);
  // Not forbidden (a medley may share a recording), but almost always a mistake worth a warning.
  const usedBy = await songsUsingLink(c.env.DB, p(c, "bandId"), reference, songId ?? null);
  return c.json({ reference, usedBy });
});

/* ---------------- prepare ---------------- */

autoArrangeRoutes.post("/prepare", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const user = c.get("user");
  const db = c.env.DB;
  const input = await parseBody(c, prepareSongSchema);
  await limitExternal(c, "prepare", 20);
  if (
    (await countRecentJobs(db, bandId, new Date(Date.now() - DAY_MS).toISOString())) >=
    BAND_DAILY_JOB_LIMIT
  ) {
    throw new ApiError("rate_limited", "daily preparation limit reached for this band");
  }

  // 1. Resolve the chosen recording from the sources themselves (never from client-supplied
  //    platform metadata). The title and artist a member typed are theirs to decide.
  let details: RecordingDetails | null = null;
  if (input.recording.source === "musicbrainz") {
    details = await musicBrainz(c.env).lookup(input.recording.mbid);
    if (!details) throw notFound("recording");
  }
  // Keeping the current reference ignores any link sent along: the reference does not change.
  const rawLink =
    input.recording.source === "current" ? null : (input.referenceUrl ?? input.youtubeUrl ?? null);
  const link = rawLink ? await resolveReferenceLink(c, rawLink) : null;
  const release = details
    ? ((input.recording.source === "musicbrainz" && input.recording.releaseMbid
        ? details.releases.find(
            (r) => r.mbid === (input.recording as { releaseMbid?: string | null }).releaseMbid,
          )
        : null) ?? pickDefaultRelease(details.releases))
    : null;
  const manual = input.recording.source === "manual" ? input.recording : null;
  const byLink = input.recording.source === "link" ? input.recording : null;
  const typedArtist = (manual ?? byLink)?.artistCredit?.trim() || null;

  // 2. An existing song: replacing its reference must not happen silently.
  let songId = input.songId ?? null;
  let created = false;
  let previous: SongRecordingDto | null = null;
  let replacing = false;
  if (songId) {
    const song = await getSong(db, bandId, songId);
    if (!song) throw notFound("song");
    previous = await getReferenceRecording(db, songId);
    if (input.recording.source === "current") {
      // "Keep the current reference": prepare again with it, nothing about it changes.
      if (!previous)
        throw new ApiError("not_found", "the song has no reference recording", {
          reason: "no_reference",
        });
      return startPreparation(c, { bandId, song, recording: previous, created: false });
    }
    const target = await findRecordingMatch(db, songId, { mbid: details?.mbid ?? null, link });
    replacing = !!previous && previous.id !== target?.id;
    // Replacing the band's reference with a different recording is always the member's explicit
    // decision. The answer says what the current reference is and what was done with it, so the
    // interface can explain the consequences. Nothing is changed until the member confirms.
    if (replacing && previous && !input.confirmReplace) {
      const dependents = await referenceDependents(
        db,
        { id: song.id, versionId: song.version.id },
        previous,
      );
      throw new ApiError("confirmation_required", "replacing the reference needs confirmation", {
        dependents,
        hasDependents: hasReferenceDependents(dependents),
        current: toReferenceSummary(previous),
      });
    }
  } else {
    // …or a new one, created from verified data and from what the member confirmed.
    const authors = details ? workAuthors(details.works) : [];
    const sourceUrl = details ? recordingPageUrl(details.mbid) : null;
    const note = "MusicBrainz";
    const year = (release?.date ?? details?.firstReleaseDate ?? manual?.releaseDate ?? "").slice(
      0,
      4,
    );
    songId = await createSong(db, bandId, user.id, {
      title: input.newSong!.title,
      artist: details?.artistCredit || typedArtist || link?.artistGuess || null,
      composer: authors.length > 0 ? authors.join(", ") : null,
      referenceRecording: release?.title ?? manual?.releaseTitle ?? null,
      referenceYear: /^\d{4}$/.test(year) ? Number(year) : null,
      durationSeconds: details?.durationMs ? Math.round(details.durationMs / 1000) : null,
      originalBpmStatus: "unknown",
      originalKeyStatus: "unknown",
      metadataSources: [
        ...(details
          ? [
              { field: "recording" as const, value: details.artistCredit, url: sourceUrl, note },
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
          : []),
        ...(link
          ? [
              {
                field: "recording" as const,
                value: link.title ?? link.url,
                url: link.url,
                note: PLATFORM_NAMES[link.platform],
              },
            ]
          : []),
      ],
      // Tempo, key and meter are never guessed: the band version starts unset / unconfirmed.
      version: {
        bpm: null,
        key: null,
        beatsPerBar: 4,
        beatUnit: 4,
        meterConfirmed: false,
        referenceUrl: link?.url ?? null,
      },
    });
    if (details?.works[0])
      await updateSong(db, bandId, songId, { workMbid: details.works[0].mbid });
    created = true;
    await audit(db, {
      bandId,
      actorUserId: user.id,
      action: "song.created",
      targetType: "song",
      targetId: songId,
      metadata: { via: "autoarrange" },
    });
  }
  const song = (await getSong(db, bandId, songId))!;

  // 3. The reference recording of that song. The previous one, if any, is retired, not deleted.
  const typedTitle = (manual ?? byLink)?.title?.trim() || null;
  const recording = await upsertReferenceRecording(
    db,
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
          link: link ?? undefined,
          sourceUrl: recordingPageUrl(details.mbid),
          fetched: true,
        }
      : {
          source: "manual",
          // A video title is not necessarily the song title: what the member confirmed wins.
          title: typedTitle ?? song.title,
          artistCredit: typedArtist ?? link?.artistGuess ?? null,
          releaseTitle: manual?.releaseTitle ?? null,
          releaseDate: manual?.releaseDate ?? null,
          link: link ?? undefined,
          metadataEdited:
            !!link &&
            ((typedTitle !== null && typedTitle !== link.title) ||
              (typedArtist !== null && typedArtist !== link.artistGuess)),
        },
  );
  // The band version's link always follows the reference: a replaced reference takes its link
  // (or the lack of one) with it, so the previous recording's link does not linger.
  if (link || replacing) {
    await updateSong(db, bandId, songId, {
      version: { ...versionOf(song), referenceUrl: recording.link?.url ?? null },
    });
  }
  if (!replacing && previous && link && previous.link?.url !== recording.link?.url) {
    // Same recording, another link: recorded like a link change from the song page.
    await insertReviewEvent(db, {
      bandId,
      songId,
      target: "reference",
      action: "edit",
      before: { change: "link", url: previous.link?.url ?? null },
      after: { url: recording.link?.url ?? null, platform: recording.link?.platform ?? null },
      resultId: null,
      userId: user.id,
    });
  }
  if (replacing || !previous) {
    await insertReviewEvent(db, {
      bandId,
      songId,
      target: "reference",
      action: replacing ? "edit" : "confirm",
      before: previous ? { change: "replaced", ...toReferenceSummary(previous) } : null,
      after: toReferenceSummary(recording),
      resultId: null,
      userId: user.id,
    });
    await audit(db, {
      bandId,
      actorUserId: user.id,
      action: replacing ? "reference.replaced" : "reference.set",
      targetType: "song",
      targetId: songId,
      metadata: { recordingId: recording.id, previousRecordingId: previous?.id ?? null },
    });
  }

  return startPreparation(c, {
    bandId,
    song: (await getSong(db, bandId, songId))!,
    recording,
    created,
    replaced: replacing,
    audioAssetId: input.audioAssetId ?? null,
    locale: input.locale,
  });
});

/** Starts (or joins) the preparation job of a song for one recording. */
async function startPreparation(
  c: Context<AppEnv>,
  opts: {
    bandId: string;
    song: SongDto;
    recording: SongRecordingDto;
    created: boolean;
    replaced?: boolean;
    audioAssetId?: string | null;
    locale?: "pt-BR" | "en";
  },
) {
  const db = c.env.DB;
  const user = c.get("user");
  const { bandId, song, recording } = opts;
  const songId = song.id;
  const audioAssetId = opts.audioAssetId ?? null;
  if (audioAssetId && !(await getAudioAsset(db, songId, audioAssetId)))
    throw notFound("audio asset");

  // One active job per song + recording + audio file: pressing "Prepare" twice reuses it.
  const dedupeKey = jobDedupeKey({
    songId,
    recordingId: recording.id,
    audioAssetId,
    pipelineVersion: PIPELINE_VERSION,
  });
  let reused = false;
  let jobRow = await findActiveJob(db, dedupeKey);
  if (jobRow && jobRow.status === "awaiting_review") {
    // A finished run waiting for review does not block a new run; it is closed first.
    await updateJob(db, jobRow.id, { status: "completed", finishedAt: nowIso() });
    jobRow = null;
  }
  if (jobRow) {
    reused = true;
  } else {
    const jobId = await insertJob(db, {
      bandId,
      songId,
      recordingId: recording.id,
      audioAssetId,
      pipelineVersion: PIPELINE_VERSION,
      dedupeKey,
      maxAttempts: JOB_MAX_ATTEMPTS,
      locale: opts.locale ?? user.locale ?? "en",
      userId: user.id,
    });
    await startJob(c, jobId);
    jobRow = (await getJobForBand(db, bandId, jobId))!;
  }

  return c.json(
    {
      song: await getSong(db, bandId, songId),
      recording,
      job: toJobDto(jobRow),
      songCreated: opts.created,
      reused,
      replaced: !!opts.replaced,
    },
    reused ? 200 : 201,
  );
}

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
  const [song, recordings, jobs, results, reviews, audioAssets] = await Promise.all([
    getSong(db, bandId, songId),
    listRecordings(db, songId),
    listJobs(db, songId),
    listResults(db, songId),
    listReviewEvents(db, songId),
    listAudioAssets(db, songId),
  ]);
  const reference = recordings.find((r) => r.isReference) ?? null;
  const since = reference?.referenceSince ?? null;
  const latest = (target: string) => {
    const e = reviews.find((r) => r.target === target);
    return e
      ? {
          value: e.after,
          userId: e.userId,
          userName: e.userName,
          at: e.createdAt,
          action: e.action,
          // Confirmed while another recording (or none) was the reference: worth a second look.
          beforeReferenceChange: !!since && e.createdAt < since,
        }
      : null;
  };
  // Three separate facts: a known reference, audio the band may process, and an analysis done.
  const audioForReference = audioAssets.filter(
    (a) => !reference || a.recordingId === null || a.recordingId === reference.id,
  );
  const analyses = results.filter(
    (r) => r.origin === "audio_analysis" && (!reference || r.recordingId === reference.id),
  );
  const analysed = analyses.length > 0;
  const latestJob = jobs[0] ?? null;
  const preparation: PreparationState = {
    reference: !reference ? "none" : reference.link ? "identified" : "link_pending",
    player: !reference?.link
      ? "none"
      : reference.link.embeddable === false
        ? "unavailable"
        : "available",
    audio: audioForReference.length > 0 ? "available" : "none",
    analysis: analysed ? "done" : audioForReference.length > 0 ? "pending" : "not_possible",
    // Results are listed newest first.
    analysisFrom: analyses[0]?.input ?? null,
    arrangement:
      latestJob?.status === "completed"
        ? "reviewed"
        : latestJob?.status === "awaiting_review"
          ? "ready_for_review"
          : "not_started",
  };
  return {
    song,
    recordings,
    jobs,
    results,
    reviews,
    audioAssets,
    preparation,
    dependents:
      reference && song
        ? await referenceDependents(db, { id: song.id, versionId: song.version.id }, reference)
        : null,
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
 * Gives the current reference recording a link, or another link to the same recording (the same
 * track on another platform, a better upload). The recording, its analyses and the band's
 * confirmed values stay as they are; choosing a different recording goes through `/prepare`.
 */
autoArrangeRoutes.put("/songs/:songId/reference/link", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const user = c.get("user");
  const song = await getSong(c.env.DB, bandId, p(c, "songId"));
  if (!song) throw notFound("song");
  const current = await getReferenceRecording(c.env.DB, song.id);
  if (!current) throw notFound("reference");
  await limitExternal(c, "ref-identify", 30);
  const { url } = await parseBody(c, setReferenceLinkSchema);
  const link = await resolveReferenceLink(c, url);
  await setRecordingLink(c.env.DB, current.id, link);
  await updateSong(c.env.DB, bandId, song.id, {
    version: { ...versionOf(song), referenceUrl: link.url },
  });
  await insertReviewEvent(c.env.DB, {
    bandId,
    songId: song.id,
    target: "reference",
    action: "edit",
    before: { change: "link", url: current.link?.url ?? null },
    after: { url: link.url, platform: link.platform },
    resultId: null,
    userId: user.id,
  });
  return c.json(await overview(c, bandId, song.id));
});

/** A member corrects the title or artist of the reference recording. */
autoArrangeRoutes.patch("/songs/:songId/reference", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const user = c.get("user");
  const song = await getSong(c.env.DB, bandId, p(c, "songId"));
  if (!song) throw notFound("song");
  const current = await getReferenceRecording(c.env.DB, song.id);
  if (!current) throw notFound("reference");
  const patch = await parseBody(c, editReferenceSchema);
  await editRecordingMetadata(c.env.DB, current.id, user.id, patch);
  await insertReviewEvent(c.env.DB, {
    bandId,
    songId: song.id,
    target: "reference",
    action: "edit",
    before: { change: "metadata", title: current.title, artist: current.artistCredit },
    after: {
      title: patch.title ?? current.title,
      artist: patch.artistCredit === undefined ? current.artistCredit : patch.artistCredit,
    },
    resultId: null,
    userId: user.id,
  });
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
  // The file is tied to one recording: the one given, or the current reference.
  const recordingOfFile = input.recordingId
    ? await getRecording(c.env.DB, song.id, input.recordingId)
    : await getReferenceRecording(c.env.DB, song.id);
  if (input.recordingId && !recordingOfFile) throw notFound("recording");
  const id = await createAudioAsset(c.env.DB, {
    bandId,
    songId: song.id,
    recordingId: recordingOfFile?.id ?? null,
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

/**
 * Stores an analysis BandSync's own engine ran on a member's device: from the microphone while the
 * reference was playing, or from an audio file the band declared it may process. The server cannot
 * re-run it, so every value is kept as an uncalibrated estimate ("needs review"), with what it
 * listened to, for how long and who ran it. The band's own values are not touched.
 */
autoArrangeRoutes.post("/songs/:songId/analysis", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const user = c.get("user");
  const db = c.env.DB;
  const song = await getSong(db, bandId, p(c, "songId"));
  if (!song) throw notFound("song");
  await limitExternal(c, "analysis", 20);
  const input = await parseBody(c, submitAnalysisSchema);

  let recording: SongRecordingDto | null = null;
  if (input.input === "audio_file") {
    const asset = await getAudioAsset(db, song.id, input.audioAssetId!);
    if (!asset) throw notFound("audio asset");
    recording = asset.recordingId
      ? await getRecording(db, song.id, asset.recordingId)
      : await getReferenceRecording(db, song.id);
  } else {
    // Listening only makes sense against the recording the band chose as its reference.
    recording = await getReferenceRecording(db, song.id);
    if (!recording)
      throw new ApiError("not_found", "the song has no reference recording", {
        reason: "no_reference",
      });
  }

  const common = {
    bandId,
    songId: song.id,
    recordingId: recording?.id ?? null,
    jobId: null,
    origin: "audio_analysis" as const,
    method: `${input.engine}.${input.input}`,
    methodVersion: input.engineVersion,
    // No calibration on real recordings yet: the confidence is unknown, so a person must review.
    confidence: null,
    confidenceCalibrated: false,
    input: input.input,
    audioAssetId: input.input === "audio_file" ? input.audioAssetId! : null,
    analysedSeconds: input.analysedSeconds,
    createdBy: user.id,
  };
  const stored: string[] = [];
  const store = async (kind: ResultKind, value: Record<string, unknown>) => {
    await insertResult(db, { ...common, kind, value });
    stored.push(kind);
  };
  if (input.bpm)
    await store("bpm", {
      bpm: Math.round(input.bpm.value * 10) / 10,
      ambiguous: input.bpm.ambiguous,
      candidates: input.bpm.candidates,
    });
  if (input.bpm?.ambiguous)
    await store("tempo_ambiguity", {
      alternatives: input.bpm.candidates
        .filter((x) => x.score >= 0.7)
        .map((x) => Math.round(x.bpm * 10) / 10),
    });
  if (input.stability) await store("tempo_stability", input.stability);
  if (input.meter) await store("time_signature", input.meter);
  if (input.key) await store("key", input.key);
  if (input.beats.length > 0)
    await store("beats", { count: input.beats.length, times: input.beats });
  await audit(db, {
    bandId,
    actorUserId: user.id,
    action: "analysis.submitted",
    targetType: "song",
    targetId: song.id,
    metadata: { input: input.input, seconds: input.analysedSeconds, kinds: stored },
  });
  return c.json(await overview(c, bandId, song.id), 201);
});

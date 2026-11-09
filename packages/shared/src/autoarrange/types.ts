import { z } from "zod";
import { httpUrlSchema, idSchema } from "../api/schemas";
import type { ReferencePlatform } from "./reference";

/* ------------------------------------------------------------------ */
/* Recordings: a specific performance of a composition                 */
/* ------------------------------------------------------------------ */

export interface RecordingRelease {
  mbid: string;
  title: string;
  date: string | null;
  country: string | null;
  status: string | null;
  primaryType: string | null;
  /** e.g. "Live", "Compilation", "Soundtrack". Empty for a regular studio release. */
  secondaryTypes: string[];
}

/** One result of a recording search, normalised from the source's format. */
export interface RecordingCandidate {
  source: "musicbrainz";
  mbid: string;
  title: string;
  /** Free-text note that tells versions apart, e.g. "live, 2012-02-01: Mirante Dona Marta". */
  disambiguation: string | null;
  /** Artists exactly as credited on the recording, join phrases included. */
  artistCredit: string;
  artists: { mbid: string; name: string }[];
  durationMs: number | null;
  firstReleaseDate: string | null;
  isVideo: boolean;
  isrcs: string[];
  releases: RecordingRelease[];
  /** Search relevance reported by the source, 0-100. Not a quality or confidence measure. */
  score: number;
  url: string;
}

export interface RecordingWork {
  mbid: string;
  title: string;
  composers: string[];
  lyricists: string[];
  /** "writer" credits, used when the source does not split music and lyrics. */
  writers: string[];
  url: string;
}

export interface RecordingLink {
  type: string;
  url: string;
}

/** Full details of one recording: the composition(s) it performs and its external links. */
export interface RecordingDetails extends Omit<RecordingCandidate, "score"> {
  works: RecordingWork[];
  links: RecordingLink[];
}

export interface YouTubeVideoInfo {
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  channelUrl: string | null;
  thumbnailUrl: string | null;
}

/** A recording attached to a song. Exactly one per song is the reference. */
export interface SongRecordingDto {
  id: string;
  songId: string;
  source: "musicbrainz" | "manual";
  /** How the band pointed at this recording: catalogue entry, pasted link, or typed by hand. */
  identifiedBy: "musicbrainz" | "link" | "manual";
  mbid: string | null;
  title: string;
  artistCredit: string | null;
  disambiguation: string | null;
  releaseTitle: string | null;
  releaseMbid: string | null;
  releaseDate: string | null;
  durationMs: number | null;
  isrcs: string[];
  works: RecordingWork[];
  links: RecordingLink[];
  /** The link the band gave for this recording, with what the platform says about it. */
  link: RecordingReferenceLink | null;
  isReference: boolean;
  /** When this recording became the reference, and when it stopped being it. */
  referenceSince: string | null;
  retiredAt: string | null;
  /** Set when a member corrected the title or artist by hand. */
  metadataEditedBy: string | null;
  metadataEditedAt: string | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
  createdAt: string;
}

/** A recording's link on a supported platform. URLs are rebuilt from platform and id. */
export interface RecordingReferenceLink {
  platform: ReferencePlatform;
  externalId: string;
  url: string;
  /** Title and channel exactly as the platform gave them (kept even after manual corrections). */
  title: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  embeddable: boolean | null;
  checkedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Preparation jobs                                                    */
/* ------------------------------------------------------------------ */

export const JOB_STATUSES = [
  "pending",
  "searching_references",
  "analyzing_audio",
  "detecting_structure",
  "preparing_materials",
  "awaiting_review",
  "completed",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** The steps a job walks through, in order. */
export const JOB_STEPS = [
  "searching_references",
  "analyzing_audio",
  "detecting_structure",
  "preparing_materials",
] as const;
export type JobStep = (typeof JOB_STEPS)[number];

export type StepOutcome = "done" | "skipped" | "failed";

/**
 * Why a step did not produce results. These are honest "nothing was analysed" states:
 * the pipeline never invents a value to fill the gap.
 */
export const SKIP_REASONS = [
  "no_recording_identifier",
  "no_authorized_audio",
  "engine_not_configured",
  "nothing_to_do",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export interface JobStepRecord {
  step: JobStep;
  outcome: StepOutcome;
  reason: SkipReason | string | null;
  /** Short machine-readable facts about what the step did, for the UI. */
  detail: Record<string, number | string | boolean | null>;
  startedAt: string;
  finishedAt: string;
}

export interface AnalysisJobDto {
  id: string;
  songId: string;
  recordingId: string | null;
  audioAssetId: string | null;
  status: JobStatus;
  /** 0-100, derived from completed steps. */
  progress: number;
  steps: JobStepRecord[];
  attempts: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  /** External calls made so far; jobs stop at a fixed budget. */
  costUnits: number;
  requestedBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Analysis results                                                    */
/* ------------------------------------------------------------------ */

export const RESULT_KINDS = [
  "duration",
  "bpm",
  "tempo_stability",
  "tempo_ambiguity",
  "time_signature",
  "key",
  "beats",
  "chords",
  "sections",
  "composer",
] as const;
export type ResultKind = (typeof RESULT_KINDS)[number];

/** Where a value came from. */
export const RESULT_ORIGINS = ["musicbrainz", "youtube", "audio_analysis", "user"] as const;
export type ResultOrigin = (typeof RESULT_ORIGINS)[number];

/**
 * unreviewed   – sourced data nobody in the band has looked at yet
 * needs_review – an estimate without enough (calibrated) confidence; must be checked by a person
 * confirmed    – a band member confirmed the value as is
 * edited       – a band member corrected it (the original stays stored)
 * rejected     – a band member discarded it
 */
export const REVIEW_STATUSES = [
  "unreviewed",
  "needs_review",
  "confirmed",
  "edited",
  "rejected",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface AnalysisResultDto {
  id: string;
  songId: string;
  recordingId: string | null;
  jobId: string | null;
  kind: ResultKind;
  /** Kind-specific payload, e.g. { seconds: 209.6 } or { bpm: 72 }. */
  value: Record<string, unknown>;
  method: string;
  methodVersion: string | null;
  /** 0-1, only meaningful when `confidenceCalibrated` is true. */
  confidence: number | null;
  confidenceCalibrated: boolean;
  origin: ResultOrigin;
  sourceUrl: string | null;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** Confidence below this (or uncalibrated) means a person has to check the value. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.8;

export function initialReviewStatus(
  origin: ResultOrigin,
  confidence: number | null,
  calibrated: boolean,
): ReviewStatus {
  if (origin === "user") return "confirmed";
  if (origin === "audio_analysis") {
    return calibrated && confidence !== null && confidence >= REVIEW_CONFIDENCE_THRESHOLD
      ? "unreviewed"
      : "needs_review";
  }
  return "unreviewed";
}

/* ------------------------------------------------------------------ */
/* Band confirmations                                                  */
/* ------------------------------------------------------------------ */

export const REVIEW_TARGETS = ["band_bpm", "band_key", "band_meter"] as const;
export type ReviewTarget = (typeof REVIEW_TARGETS)[number];

export interface ReviewEventDto {
  id: string;
  songId: string;
  target: string;
  action: "confirm" | "edit" | "reject";
  before: unknown;
  after: unknown;
  resultId: string | null;
  userId: string;
  userName: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Authorised audio                                                    */
/* ------------------------------------------------------------------ */

/** The legal basis a band member declares before any audio file may be analysed. */
export const AUDIO_RIGHTS = ["own_recording", "licensed", "permission_from_owner"] as const;
export type AudioRights = (typeof AUDIO_RIGHTS)[number];

export interface AudioAssetDto {
  id: string;
  songId: string;
  recordingId: string | null;
  fileId: string;
  fileName: string;
  rightsBasis: AudioRights;
  rightsNote: string | null;
  declaredBy: string;
  declaredAt: string;
}

/* ------------------------------------------------------------------ */
/* Reference-source connectors                                         */
/* ------------------------------------------------------------------ */

export interface ConnectorInfo {
  id: string;
  name: string;
  /** What the connector helps to find. */
  provides: ("metadata" | "video" | "audio" | "chords" | "tabs" | "lyrics")[];
  /** True for the platforms whose links can be a song's reference recording. */
  referenceLinks: boolean;
  /** How BandSync is allowed to use the source. */
  access: "api" | "official_embed" | "link_only";
  /** Whether BandSync may store the source's content (not just a link to it). */
  mayStoreContent: boolean;
  termsUrl: string;
  /** Plain statement of the restriction, shown to users. Key into the locale files. */
  policyKey: string;
}

/* ------------------------------------------------------------------ */
/* Request schemas                                                     */
/* ------------------------------------------------------------------ */

export const searchRecordingsSchema = z.object({
  title: z.string().trim().min(2).max(160),
  artist: z.string().trim().max(160).optional(),
});

const mbidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

export const youtubeLookupSchema = z.object({ url: httpUrlSchema });

/** A pasted reference link. Deliberately loose here: the connector decides what is acceptable. */
const referenceUrlSchema = z.string().trim().min(1).max(2000);
export const identifyReferenceSchema = z.object({ url: referenceUrlSchema });
/** Attach or change the link of the current reference recording (same recording, other link). */
export const setReferenceLinkSchema = z.object({ url: referenceUrlSchema });
/** Manual correction of what identifies the reference recording. */
export const editReferenceSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    artistCredit: z.string().trim().max(200).nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.artistCredit !== undefined, {
    message: "nothing to change",
  });

const recordingChoiceSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("musicbrainz"),
    mbid: mbidSchema,
    /** Which release of the recording the band means (album / live album / compilation). */
    releaseMbid: mbidSchema.optional().nullable(),
  }),
  z.object({
    source: z.literal("manual"),
    title: z.string().trim().min(1).max(160),
    artistCredit: z.string().trim().max(200).optional().nullable(),
    releaseTitle: z.string().trim().max(200).optional().nullable(),
    releaseDate: z.string().trim().max(10).optional().nullable(),
  }),
  /**
   * Keep the song's current reference recording and prepare with it. Used when a member is asked
   * whether to replace the reference and answers "keep the current one".
   */
  z.object({ source: z.literal("current") }),
  /** Identified by the pasted link alone; title and artist may be corrected by the member. */
  z.object({
    source: z.literal("link"),
    title: z.string().trim().min(1).max(160).optional(),
    artistCredit: z.string().trim().max(200).optional().nullable(),
  }),
]);

export const prepareSongSchema = z
  .object({
    /** Prepare an existing song… */
    songId: idSchema.optional(),
    /** …or create a new one from the chosen recording. */
    newSong: z.object({ title: z.string().trim().min(1).max(160) }).optional(),
    recording: recordingChoiceSchema,
    /** Link to the recording on a supported platform (YouTube, YouTube Music, Spotify). */
    referenceUrl: referenceUrlSchema.optional().nullable(),
    /** Older name of `referenceUrl`, still accepted. */
    youtubeUrl: httpUrlSchema.optional().nullable(),
    /**
     * Required to replace a song's reference recording with a different one. Without it the
     * server answers `confirmation_required` with the current reference and what depends on it.
     * Never needed for the same recording (same catalogue id, or the same video / track).
     */
    confirmReplace: z.boolean().optional(),
    audioAssetId: idSchema.optional().nullable(),
    /** Language for the text the preparation writes into pending slots. */
    locale: z.enum(["pt-BR", "en"]).optional(),
  })
  .refine((v) => !!v.songId !== !!v.newSong, { message: "provide either songId or newSong" })
  .refine((v) => v.recording.source !== "link" || !!(v.referenceUrl ?? v.youtubeUrl), {
    message: "a link is required",
  })
  .refine((v) => v.recording.source !== "current" || !!v.songId, {
    message: "keeping the current reference needs an existing song",
  });
export type PrepareSongInput = z.infer<typeof prepareSongSchema>;

export const reviewSchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("band_bpm"),
    bpm: z.number().min(20).max(400),
    /** The analysis result this confirms or corrects, when there is one. */
    resultId: idSchema.optional().nullable(),
  }),
  z.object({
    target: z.literal("band_key"),
    key: z.string().trim().min(1).max(12),
    resultId: idSchema.optional().nullable(),
  }),
  z.object({
    target: z.literal("band_meter"),
    beatsPerBar: z.number().int().min(1).max(32),
    beatUnit: z
      .number()
      .int()
      .refine((n) => [1, 2, 4, 8, 16].includes(n)),
    resultId: idSchema.optional().nullable(),
  }),
]);
export type ReviewInput = z.infer<typeof reviewSchema>;

export const createAudioAssetSchema = z.object({
  fileId: idSchema,
  recordingId: idSchema.optional().nullable(),
  rightsBasis: z.enum(AUDIO_RIGHTS),
  rightsNote: z.string().trim().max(500).optional().nullable(),
  /** The member must tick the declaration; without it nothing is registered. */
  declaration: z.literal(true),
});

/* ------------------------------------------------------------------ */
/* Preparation state                                                   */
/* ------------------------------------------------------------------ */

/**
 * Three different things that must never be confused:
 *  - reference: the app knows which recording the band means (and maybe its link);
 *  - audio:     the band gave a file it may process (a link is never that);
 *  - analysis:  values were actually computed from that audio.
 */
export interface PreparationState {
  reference: "none" | "link_pending" | "identified";
  player: "none" | "available" | "unavailable";
  audio: "none" | "available";
  /** not_possible: no authorised audio. pending: audio exists but nothing analysed it yet. */
  analysis: "not_possible" | "pending" | "done";
  arrangement: "not_started" | "ready_for_review" | "reviewed";
}

/** What already depends on the current reference recording; replacing it needs confirmation. */
export interface ReferenceDependents {
  analyses: number;
  audioAssets: number;
  confirmedValues: string[];
  sections: number;
  readyMaterials: number;
}

export function hasReferenceDependents(d: ReferenceDependents): boolean {
  return (
    d.analyses + d.audioAssets + d.sections + d.readyMaterials > 0 || d.confirmedValues.length > 0
  );
}

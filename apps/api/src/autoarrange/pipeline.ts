import {
  type DeezerTrack,
  type JobStep,
  type MetadataSource,
  pickDeezerMatch,
  pickDeezerVersion,
  recordingPageUrl,
  type SkipReason,
  type SongRecordingDto,
  type StepOutcome,
  workAuthors,
} from "@bandsync/shared";
import {
  getAudioAsset,
  getRecording,
  insertResult,
  type JobRow,
  updateRecordingDetails,
} from "../db/autoarrange";
import { createMaterial, getSong, listMaterials, updateSong } from "../db/songs";
import type { Env } from "../env";
import { deezer, type MusicBrainzClient } from "./clients";

export interface StepResult {
  outcome: StepOutcome;
  reason: SkipReason | null;
  detail: Record<string, number | string | boolean | null>;
}

export interface StepContext {
  env: Env;
  db: D1Database;
  job: JobRow;
  mb: MusicBrainzClient;
  /** Counts one external request against the job's budget; throws when the budget is spent. */
  spend: () => void;
}

/** Thrown for problems that will not go away by retrying (missing song, spent budget…). */
export class PermanentStepError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

const TEXTS = {
  "pt-BR": {
    sourceNote:
      "Dado do MusicBrainz (base aberta mantida pela comunidade). Confira antes de confirmar.",
    slots: {
      drums: [
        "Mapa de arranjo (bateria)",
        "Estrutura, compassos e convenções ainda não registrados. Sem áudio autorizado, a estrutura não foi analisada.",
      ],
      bass: [
        "Linha de baixo",
        "Sem material próprio ou licenciado. Importe uma transcrição que a banda possa usar ou escreva a sua.",
      ],
      guitar: [
        "Cifra (guitarra/violão)",
        "Harmonia ainda não analisada. Importe uma cifra autorizada ou escreva a da banda.",
      ],
      keys: [
        "Cifra / mapa harmônico (teclado)",
        "Harmonia ainda não analisada. Importe material autorizado ou escreva o da banda.",
      ],
      vocals: [
        "Letra e observações (voz)",
        "Letra não copiada: use uma fonte licenciada ou um link. Este espaço serve para entradas e observações.",
      ],
    },
  },
  en: {
    sourceNote:
      "Data from MusicBrainz (open, community-maintained database). Check it before confirming.",
    slots: {
      drums: [
        "Arrangement map (drums)",
        "Structure, bar counts and cues not recorded yet. Without authorised audio the structure was not analysed.",
      ],
      bass: [
        "Bass line",
        "No own or licensed material. Import a transcription the band may use, or write your own.",
      ],
      guitar: [
        "Chord chart (guitar)",
        "Harmony not analysed yet. Import an authorised chart or write the band's.",
      ],
      keys: [
        "Chord chart / harmonic map (keys)",
        "Harmony not analysed yet. Import authorised material or write the band's.",
      ],
      vocals: [
        "Lyrics and notes (vocals)",
        "Lyrics are not copied: use a licensed source or a link. Use this space for entries and notes.",
      ],
    },
  },
} as const;

const SLOT_TYPES = {
  drums: "arrangement_map",
  bass: "bass_tab",
  guitar: "chords",
  keys: "chords",
  vocals: "lyrics",
} as const;

const texts = (locale: string) =>
  locale.toLowerCase().startsWith("pt") ? TEXTS["pt-BR"] : TEXTS.en;

async function load(ctx: StepContext) {
  const song = await getSong(ctx.db, ctx.job.band_id, ctx.job.song_id);
  if (!song) throw new PermanentStepError("song_not_found");
  const recording = ctx.job.recording_id
    ? await getRecording(ctx.db, song.id, ctx.job.recording_id)
    : null;
  return { song, recording };
}

/* ------------------------------------------------------------------ */
/* Step 1: confirm the recording at its source                         */
/* ------------------------------------------------------------------ */
async function searchingReferences(ctx: StepContext): Promise<StepResult> {
  const { song, recording } = await load(ctx);
  let results = 0;
  let identified = false;

  if (recording?.mbid) {
    ctx.spend();
    const details = await ctx.mb.lookup(recording.mbid);
    if (details) {
      identified = true;
      await updateRecordingDetails(ctx.db, recording.id, {
        durationMs: details.durationMs,
        isrcs: details.isrcs,
        works: details.works,
        links: details.links,
      });
      const sourceUrl = recordingPageUrl(recording.mbid);
      const common = {
        bandId: ctx.job.band_id,
        songId: song.id,
        recordingId: recording.id,
        jobId: ctx.job.id,
        origin: "musicbrainz" as const,
      };
      if (details.durationMs) {
        const r = await insertResult(ctx.db, {
          ...common,
          kind: "duration",
          value: { ms: details.durationMs, seconds: Math.round(details.durationMs / 100) / 10 },
          method: "musicbrainz.recording.length",
          sourceUrl,
        });
        if (r.created) results += 1;
      }
      const authors = workAuthors(details.works);
      const work = details.works[0];
      if (work && authors.length > 0) {
        const r = await insertResult(ctx.db, {
          ...common,
          kind: "composer",
          value: { names: authors, workMbid: work.mbid, workTitle: work.title },
          method: "musicbrainz.work.relations",
          sourceUrl: work.url,
        });
        if (r.created) results += 1;
      }
    }
  }

  // Published analyses of this exact recording (Deezer: BPM and duration). Optional: if the
  // service is down or the recording cannot be told apart from other versions, nothing is stored.
  let deezerFound = false;
  if (recording) {
    try {
      const found = await discoverOnDeezer(ctx, song.title, recording);
      if (found) {
        deezerFound = true;
        const common = {
          bandId: ctx.job.band_id,
          songId: song.id,
          recordingId: recording.id,
          jobId: ctx.job.id,
          origin: "deezer" as const,
          sourceUrl: found.link,
        };
        if (found.bpm) {
          const r = await insertResult(ctx.db, {
            ...common,
            kind: "bpm",
            value: deezerValue(found, { bpm: found.bpm }),
            method: "deezer.track.bpm",
          });
          if (r.created) results += 1;
        }
        const fresh = await getRecording(ctx.db, song.id, recording.id);
        if (found.durationSec && !fresh?.durationMs) {
          const r = await insertResult(ctx.db, {
            ...common,
            kind: "duration",
            value: deezerValue(found, {
              seconds: found.durationSec,
              ms: found.durationSec * 1000,
            }),
            method: "deezer.track.duration",
          });
          if (r.created) results += 1;
        }
      }
    } catch (err) {
      if (err instanceof PermanentStepError) throw err;
      // An unavailable optional source is not a failed preparation.
    }
  }

  // Nothing is added to the song's visible links: what identifies the recording (catalogue page,
  // work, platform link) stays on the recording row, for provenance and audit.
  return {
    outcome: "done",
    reason: recording?.mbid || deezerFound ? null : "no_recording_identifier",
    detail: { identified, resultsAdded: results, deezer: deezerFound },
  };
}

/**
 * The Deezer track that is this recording: by ISRC when the catalogue gave one (and the length
 * agrees), otherwise by title + artist + length. Returns null when it cannot be told apart.
 */
/** What is kept with a value read from Deezer: which track, how it was matched, its ISRC. */
function deezerValue(
  found: DeezerTrack & { match: DeezerMatch; evidence?: string[] },
  value: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...value,
    deezerTrackId: found.id,
    match: found.match,
    ...(found.evidence?.length ? { evidence: found.evidence } : {}),
    ...(found.isrc ? { isrc: found.isrc } : {}),
    ...(found.album ? { album: found.album } : {}),
  };
}

/** How a Deezer track was tied to the band's recording. */
type DeezerMatch = "isrc" | "title_duration" | "title_version";

export async function discoverOnDeezer(
  ctx: Pick<StepContext, "env" | "db" | "spend">,
  songTitle: string,
  recording: SongRecordingDto,
): Promise<(DeezerTrack & { match: DeezerMatch; evidence?: string[] }) | null> {
  const dz = deezer(ctx.env);
  // Length known from the catalogue, or reported by the official player.
  let durationSec = recording.durationMs ? recording.durationMs / 1000 : null;
  if (durationSec === null) {
    const row = await ctx.db
      .prepare(
        "SELECT value FROM analysis_results WHERE song_id = ? AND recording_id = ? AND kind = 'duration' AND origin = 'youtube' ORDER BY created_at DESC LIMIT 1",
      )
      .bind(recording.songId, recording.id)
      .first<{ value: string }>();
    if (row) durationSec = Number((JSON.parse(row.value) as { seconds?: number }).seconds) || null;
  }
  for (const isrc of recording.isrcs.slice(0, 2)) {
    ctx.spend();
    const t = await dz.byIsrc(isrc);
    if (t && (durationSec === null || !t.durationSec || Math.abs(t.durationSec - durationSec) <= 3))
      return { ...t, match: "isrc" };
  }
  // Neither a length nor a link title to tell versions apart: do not spend the call.
  if (durationSec === null && !recording.link?.title) return null;
  ctx.spend();
  const candidates = await dz.search(recording.artistCredit, songTitle);
  let pick: DeezerTrack | null = null;
  let match: DeezerMatch = "title_duration";
  let evidence: string[] | undefined;
  if (durationSec !== null) pick = pickDeezerMatch(candidates, { title: songTitle, durationSec });
  else {
    // No length yet (a link was just pasted): the link's own title may still say which version
    // this is ("... Acústico Ao Vivo no Rio de Janeiro"). Anything less than clear finds nothing.
    const byTitle = pickDeezerVersion(candidates, {
      title: songTitle,
      artist: recording.artistCredit,
      linkTitle: recording.link?.title ?? null,
      linkAuthor: recording.link?.author ?? null,
    });
    if (byTitle) {
      pick = byTitle.track;
      match = "title_version";
      evidence = byTitle.words;
    }
  }
  if (!pick) return null;
  // Search results do not carry the BPM: read the track itself.
  ctx.spend();
  const full = await dz.track(pick.id);
  return full ? { ...full, match, evidence } : null;
}

/**
 * Runs the Deezer lookup outside a job, once the official player reported the video's length
 * (a link-only reference has no length when it is prepared, and a title search needs one).
 * At most three external calls; an unavailable source just finds nothing.
 */
export async function discoverPublishedTempo(
  env: Env,
  db: D1Database,
  input: { bandId: string; songTitle: string; recording: SongRecordingDto; userId: string },
): Promise<boolean> {
  const existing = await db
    .prepare(
      "SELECT 1 FROM analysis_results WHERE song_id = ? AND recording_id = ? AND origin = 'deezer' LIMIT 1",
    )
    .bind(input.recording.songId, input.recording.id)
    .first();
  if (existing) return false;
  let calls = 0;
  const spend = () => {
    calls += 1;
    if (calls > 3) throw new PermanentStepError("budget_exceeded");
  };
  try {
    const found = await discoverOnDeezer({ env, db, spend }, input.songTitle, input.recording);
    if (!found?.bpm) return false;
    await insertResult(db, {
      bandId: input.bandId,
      songId: input.recording.songId,
      recordingId: input.recording.id,
      jobId: null,
      origin: "deezer",
      sourceUrl: found.link,
      kind: "bpm",
      value: deezerValue(found, { bpm: found.bpm }),
      method: "deezer.track.bpm",
      createdBy: input.userId,
    });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Steps 2 and 3: audio analysis and structure                         */
/* ------------------------------------------------------------------ */
/**
 * Audio is analysed only from a file a band member declared the band may process, by an analysis
 * engine. No engine is configured in this deployment yet, so these steps report exactly that and
 * produce no values. They are the hook where the engine of the next stage plugs in.
 */
async function audioStep(ctx: StepContext): Promise<StepResult> {
  const asset = ctx.job.audio_asset_id
    ? await getAudioAsset(ctx.db, ctx.job.song_id, ctx.job.audio_asset_id)
    : null;
  if (!asset) return { outcome: "skipped", reason: "no_authorized_audio", detail: {} };
  return { outcome: "skipped", reason: "engine_not_configured", detail: { audioAsset: asset.id } };
}

/* ------------------------------------------------------------------ */
/* Step 4: fill what is verified and open one workspace per instrument  */
/* ------------------------------------------------------------------ */
async function preparingMaterials(ctx: StepContext): Promise<StepResult> {
  const { song, recording } = await load(ctx);
  const t = texts(ctx.job.locale);
  let fieldsFilled = 0;

  if (recording && recording.source === "musicbrainz" && recording.mbid) {
    fieldsFilled = await fillEmptySongFields(ctx, song, recording, t.sourceNote);
  }

  const materials = await listMaterials(ctx.db, ctx.job.band_id, song.id);
  const taken = new Set(materials.map((m) => `${m.type}|${m.instrument ?? ""}`));
  let slotsCreated = 0;
  for (const instrument of Object.keys(SLOT_TYPES) as (keyof typeof SLOT_TYPES)[]) {
    const type = SLOT_TYPES[instrument];
    if (taken.has(`${type}|${instrument}`)) continue;
    const [title, body] = t.slots[instrument];
    await createMaterial(ctx.db, song.id, song.version.id, ctx.job.requested_by, {
      type,
      title,
      instrument,
      body,
      status: "pending",
      origin: "autoarrange",
      originJobId: ctx.job.id,
    });
    slotsCreated += 1;
  }
  return { outcome: "done", reason: null, detail: { fieldsFilled, slotsCreated } };
}

/**
 * Copies identified facts into the song's own fields, but only where the field is still empty:
 * whatever the band already wrote always wins. Every filled field gets a source entry.
 */
async function fillEmptySongFields(
  ctx: StepContext,
  song: NonNullable<Awaited<ReturnType<typeof getSong>>>,
  recording: SongRecordingDto,
  note: string,
): Promise<number> {
  const url = recordingPageUrl(recording.mbid!);
  const patch: Parameters<typeof updateSong>[3] = {};
  const sources: MetadataSource[] = [];
  const release = recording.releaseTitle ? { title: recording.releaseTitle } : null;
  const year = (recording.releaseDate ?? "").slice(0, 4);
  const authors = workAuthors(recording.works);
  const work = recording.works[0];

  if (!song.artist && recording.artistCredit) {
    patch.artist = recording.artistCredit;
    sources.push({ field: "recording", value: recording.artistCredit, url, note });
  }
  if (!song.composer && authors.length > 0) {
    patch.composer = authors.join(", ");
    sources.push({ field: "composer", value: authors.join(", "), url: work?.url ?? url, note });
  }
  if (!song.workMbid && work) patch.workMbid = work.mbid;
  if (!song.referenceRecording && release?.title) {
    patch.referenceRecording = release.title;
    sources.push({ field: "recording", value: release.title, url, note });
  }
  if (!song.referenceYear && /^\d{4}$/.test(year)) patch.referenceYear = Number(year);
  if (!song.durationSeconds && recording.durationMs) {
    patch.durationSeconds = Math.round(recording.durationMs / 1000);
    sources.push({
      field: "duration",
      value: `${Math.round(recording.durationMs / 1000)} s`,
      url,
      note,
    });
  }
  const filled = Object.keys(patch).length;
  if (filled === 0) return 0;
  const known = new Set(
    song.metadataSources.map((s) => `${s.field}|${s.url ?? ""}|${s.value ?? ""}`),
  );
  const fresh = sources.filter((s) => !known.has(`${s.field}|${s.url ?? ""}|${s.value ?? ""}`));
  if (fresh.length > 0) patch.metadataSources = [...song.metadataSources, ...fresh];
  await updateSong(ctx.db, ctx.job.band_id, song.id, patch);
  return filled;
}

export const STEP_RUNNERS: Record<JobStep, (ctx: StepContext) => Promise<StepResult>> = {
  searching_references: searchingReferences,
  analyzing_audio: audioStep,
  detecting_structure: audioStep,
  preparing_materials: preparingMaterials,
};

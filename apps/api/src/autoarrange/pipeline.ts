import {
  type JobStep,
  type MetadataSource,
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
import type { MusicBrainzClient } from "./clients";

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

  // Nothing is added to the song's visible links: what identifies the recording (catalogue page,
  // work, platform link) stays on the recording row, for provenance and audit.
  return {
    outcome: "done",
    reason: recording?.mbid ? null : "no_recording_identifier",
    detail: { identified, resultsAdded: results },
  };
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

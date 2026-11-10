/**
 * Pure helpers for the "Gerar pré-arranjo" flow: which stage the song is in, which facts about
 * the reference are verified (and where each came from), and the pre-arrangement a member builds
 * by marking section starts while listening through the official player.
 */
import {
  type AnalysisResultDto,
  isRunningJob,
  type PreparationStage,
  type SubmitPrearrangementInput,
} from "@bandsync/shared";
import type { SongAnalysisOverview } from "../autoarrange/queries";

/** Work happening on this device right now (it is not stored anywhere until it finishes). */
export type LocalWork = "analysing_recording" | "detecting_structure" | "preparing_prearrangement";

export function currentStage(o: SongAnalysisOverview, local: LocalWork | null): PreparationStage {
  if (local) return local;
  const pre = o.prearrangement;
  if (pre) {
    // Ready once the band saved its own arrangement from this pre-arrangement (or after it).
    const saved = o.song.version.arrangementUpdatedAt;
    return saved && (o.song.version.arrangementBaseId === pre.id || saved >= pre.createdAt)
      ? "ready"
      : "awaiting_review";
  }
  const job = o.jobs[0];
  if (job && isRunningJob(job.status)) return "searching_information";
  if (!o.song.reference) return "checking_analysis";
  return o.preparation.audio === "available" ? "checking_analysis" : "analysis_unavailable";
}

export interface VerifiedFact {
  kind: "duration" | "bpm";
  value: number;
  origin: AnalysisResultDto["origin"];
  method: string;
  sourceUrl: string | null;
  reviewStatus: AnalysisResultDto["reviewStatus"];
}

/**
 * What is known about the reference without having heard it: durations and published tempo,
 * newest first per source. Each keeps its origin, so nothing reads as an analysis.
 */
export function referenceFacts(o: SongAnalysisOverview): VerifiedFact[] {
  const ref = o.recordings.find((r) => r.isReference);
  const seen = new Set<string>();
  const out: VerifiedFact[] = [];
  for (const r of o.results) {
    if (ref && r.recordingId && r.recordingId !== ref.id) continue;
    if (r.reviewStatus === "rejected") continue;
    if (r.origin === "audio_analysis") continue;
    const key = `${r.kind}:${r.method}`;
    if (seen.has(key)) continue;
    if (r.kind === "duration" && typeof r.value.seconds === "number") {
      seen.add(key);
      out.push({ ...pick(r), kind: "duration", value: r.value.seconds });
    } else if (r.kind === "bpm" && typeof r.value.bpm === "number") {
      seen.add(key);
      out.push({ ...pick(r), kind: "bpm", value: r.value.bpm });
    }
  }
  return out;
}

const pick = (r: AnalysisResultDto) => ({
  origin: r.origin,
  method: r.method,
  sourceUrl: r.sourceUrl,
  reviewStatus: r.reviewStatus,
});

/** The official player already reported this reference's duration. */
export const hasPlayerDuration = (o: SongAnalysisOverview) =>
  referenceFacts(o).some((f) => f.kind === "duration" && f.origin === "youtube");

/** Best tempo to count bars from marks: the band's own, else a published one. */
export function tempoForMarks(
  o: SongAnalysisOverview,
): { bpm: number; origin: "user" | "deezer" } | null {
  if (o.song.version.bpm) return { bpm: o.song.version.bpm, origin: "user" };
  const deezer = referenceFacts(o).find((f) => f.kind === "bpm" && f.origin === "deezer");
  return deezer ? { bpm: deezer.value, origin: "deezer" } : null;
}

export const MARKS_ENGINE = "member-marks";
export const MARKS_VERSION = "marks-v1";
const MIN_SECTION_SEC = 2;

/**
 * Sections from the moments a member marked while listening. Letters only (A, B, C…): a person
 * marked where something changes, not what it is, so nothing is named for them.
 */
export function prearrangementFromMarks(input: {
  marks: number[];
  durationSec: number;
  bpm: number;
  bpmOrigin: "user" | "deezer";
  beatsPerBar: number;
}): SubmitPrearrangementInput | null {
  const { durationSec, bpm, beatsPerBar } = input;
  if (!(durationSec > 0) || !(bpm > 0)) return null;
  const barSeconds = (60 / bpm) * beatsPerBar;
  const cuts = [...input.marks]
    .filter((m) => m > 0 && m < durationSec)
    .sort((a, b) => a - b)
    .reduce<number[]>(
      (acc, m) => {
        if (m - (acc[acc.length - 1] ?? 0) >= MIN_SECTION_SEC) acc.push(m);
        return acc;
      },
      [0],
    );
  if (durationSec - cuts[cuts.length - 1]! < MIN_SECTION_SEC && cuts.length > 1) cuts.pop();
  const bounds = [...cuts, durationSec];
  let startBar = 0;
  const sections = cuts.map((start, i) => {
    const end = bounds[i + 1]!;
    const bars = Math.max(1, Math.round((end - start) / barSeconds));
    const s = {
      label: String.fromCharCode(65 + (i % 26)),
      kind: "unknown" as const,
      kindConfidence: "low" as const,
      startSec: round2(start),
      endSec: round2(end),
      startBar,
      bars,
      chords: [],
      loudnessDb: 0,
      cues: [],
    };
    startBar += bars;
    return s;
  });
  return {
    source: "member_marks",
    audioAssetId: null,
    engine: MARKS_ENGINE,
    version: MARKS_VERSION,
    analysedSeconds: 0,
    bpm: { value: bpm, ambiguous: false, alternatives: [], origin: input.bpmOrigin },
    beatsPerBar,
    key: null,
    firstDownbeatSec: 0,
    barSeconds: round2(barSeconds),
    bars: Math.max(1, startBar),
    sections,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * AutoArrange 3.0 — the stages of preparing a song, as interfaces. Each stage can be swapped
 * without touching the others (a licensed analysis service, a server engine, another platform).
 *
 *   link ─► RecordingIdentifier ─► MetadataProvider[] ─► AnalysisDiscovery[]
 *                                             │
 *                         AnalysableSourceProvider[] (what may be processed, and how)
 *                                             │
 *                  AudioProcessor ─► StructureDetector ─► PreArrangementGenerator
 *                                             │
 *                                   ArrangementStore (recording vs band)
 *
 * Current implementations:
 *  - RecordingIdentifier: YouTube / YouTube Music / Spotify link connectors (reference.ts);
 *  - MetadataProvider: MusicBrainz (catalogue, ISRC, composer), YouTube player (duration);
 *  - AnalysisDiscovery: Deezer public API (BPM and duration of the matching recording);
 *  - AnalysableSourceProvider: authorised audio file, microphone (whole recording), member marks
 *    while listening through the official player. NOT the platform stream (see AUTOARRANGE_3.md);
 *  - AudioProcessor / StructureDetector / PreArrangementGenerator: BandSync's engine in the
 *    member's browser (analysis/analyze.ts, analysis/prearrange.ts);
 *  - ArrangementStore: D1 (recording_arrangements, song_sections).
 */
import type { PreArrangement } from "../analysis/prearrange";
import type { ReferenceLinkInfo } from "./reference";

/** A fact about the recording with where it came from. Never presented as confirmed. */
export interface SourcedFact<T> {
  value: T;
  origin: "musicbrainz" | "deezer" | "youtube" | "audio_analysis" | "user";
  method: string;
  sourceUrl: string | null;
}

export interface RecordingIdentifier {
  readonly id: string;
  /** Recognises and describes a pasted link; null when the platform does not know it. */
  identify(url: string): Promise<ReferenceLinkInfo | null>;
}

export interface RecordingFacts {
  durationSec?: SourcedFact<number>;
  isrc?: SourcedFact<string>;
  composers?: SourcedFact<string[]>;
  release?: SourcedFact<{ title: string; year: string | null }>;
}

export interface MetadataProvider {
  readonly id: string;
  lookup(query: {
    title: string;
    artist: string | null;
    isrc: string | null;
    durationSec: number | null;
  }): Promise<RecordingFacts>;
}

/** Analyses someone already published for this exact recording (not computed by BandSync). */
export interface AnalysisDiscovery {
  readonly id: string;
  discover(query: {
    title: string;
    artist: string | null;
    isrc: string | null;
    durationSec: number | null;
  }): Promise<{ bpm?: SourcedFact<number>; durationSec?: SourcedFact<number> } | null>;
}

/** Where audio that BandSync may process can come from, and whether it is there for a song. */
export type AnalysableSource = "audio_file" | "microphone" | "member_marks";

export interface AnalysableSourceProvider {
  readonly source: AnalysableSource;
  /** Short reason when the source cannot be used (shown to the member). */
  available(): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export interface AudioProcessor {
  analyse(channels: Float32Array[], sampleRate: number): Promise<PreArrangement>;
}

export type PreparationStage =
  | "reference_identified"
  | "searching_information"
  | "checking_analysis"
  | "analysing_recording"
  | "detecting_structure"
  | "preparing_prearrangement"
  | "awaiting_review"
  | "ready"
  | "analysis_unavailable";

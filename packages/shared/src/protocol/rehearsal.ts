import { z } from "zod";
import { LIMITS } from "../constants";
import type { TempoAnchor } from "../sync/metronome";

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export const SESSION_STATUSES = [
  "created",
  "waiting",
  "ready",
  "counting_in",
  "playing",
  "paused",
  "ended",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface ParticipantState {
  userId: string;
  displayName: string;
  instrument: string | null;
  avatarUrl: string | null;
  connected: boolean;
  audioEnabled: boolean;
  ready: boolean;
  isAdmin: boolean;
  canControl: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

export interface CurrentSongState {
  songId: string;
  versionId: string;
  title: string;
  artist: string | null;
  bpm: number | null;
  beatsPerBar: number;
  beatUnit: number;
  key: string | null;
  /** Position inside the active repertoire, when applicable. */
  repertoireIndex: number | null;
}

export type ClickMode = "synced" | "central";

export interface MetronomeState {
  bpm: number;
  beatsPerBar: number;
  beatUnit: number;
  countInBars: number;
  subdivision: 1 | 2 | 3 | 4;
  running: boolean;
  /** Present while running (or scheduled to start). */
  anchor: TempoAnchor | null;
  /** When the current run started counting in, for diagnostics/UI. */
  startedAtServerMs: number | null;
  clickMode: ClickMode;
  /** In "central" mode, the user whose device is the only one that produces sound. */
  centralUserId: string | null;
}

export interface SessionState {
  sessionId: string;
  bandId: string;
  status: SessionStatus;
  conductorUserId: string | null;
  repertoireId: string | null;
  repertoireSongIds: string[];
  currentSong: CurrentSongState | null;
  metronome: MetronomeState;
  participants: ParticipantState[];
  createdAt: number;
  endedAt: number | null;
  /** Monotonic event counter; clients must ignore anything with seq <= last seen. */
  seq: number;
}

export function initialMetronome(): MetronomeState {
  return {
    bpm: 120,
    beatsPerBar: 4,
    beatUnit: 4,
    countInBars: 1,
    subdivision: 1,
    running: false,
    anchor: null,
    startedAtServerMs: null,
    clickMode: "synced",
    centralUserId: null,
  };
}

export function initialSessionState(
  sessionId: string,
  bandId: string,
  createdAt: number,
): SessionState {
  return {
    sessionId,
    bandId,
    status: "created",
    conductorUserId: null,
    repertoireId: null,
    repertoireSongIds: [],
    currentSong: null,
    metronome: initialMetronome(),
    participants: [],
    createdAt,
    endedAt: null,
    seq: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Client -> server messages                                           */
/* ------------------------------------------------------------------ */

const bpmSchema = z.number().min(LIMITS.bpmMin).max(LIMITS.bpmMax);

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping"), t0: z.number() }),
  z.object({ type: z.literal("set_ready"), ready: z.boolean() }),
  z.object({ type: z.literal("set_audio"), enabled: z.boolean() }),
  z.object({ type: z.literal("claim_conductor") }),
  z.object({ type: z.literal("transfer_conductor"), userId: z.string().min(1) }),
  z.object({ type: z.literal("set_repertoire"), repertoireId: z.string().min(1).nullable() }),
  z.object({ type: z.literal("set_song"), songId: z.string().min(1).nullable() }),
  z.object({ type: z.literal("next_song") }),
  z.object({ type: z.literal("prev_song") }),
  z.object({ type: z.literal("set_tempo"), bpm: bpmSchema }),
  z.object({
    type: z.literal("set_time_signature"),
    beatsPerBar: z.number().int().min(1).max(32),
    beatUnit: z
      .number()
      .int()
      .refine((n) => [1, 2, 4, 8, 16].includes(n)),
  }),
  z.object({
    type: z.literal("set_count_in"),
    bars: z.number().int().min(0).max(LIMITS.countInBarsMax),
  }),
  z.object({
    type: z.literal("set_subdivision"),
    subdivision: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  }),
  z.object({
    type: z.literal("set_click_mode"),
    mode: z.enum(["synced", "central"]),
    centralUserId: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal("start"), leadMs: z.number().int().min(300).max(5000).optional() }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("end_session") }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/* ------------------------------------------------------------------ */
/* Server -> client messages                                           */
/* ------------------------------------------------------------------ */

export const REALTIME_ERROR_CODES = [
  "not_conductor",
  "not_allowed",
  "invalid_message",
  "unknown_song",
  "session_ended",
  "not_running",
  "already_running",
  "conductor_connected",
  "unknown_repertoire",
] as const;
export type RealtimeErrorCode = (typeof REALTIME_ERROR_CODES)[number];

export type ServerMessage =
  | { type: "snapshot"; state: SessionState; serverNow: number; you: { userId: string } }
  | { type: "state"; state: SessionState; serverNow: number }
  | { type: "pong"; t0: number; t1: number; t2: number }
  | { type: "error"; code: RealtimeErrorCode; seq?: number }
  | { type: "ended"; serverNow: number };

/* ------------------------------------------------------------------ */
/* Pure helpers shared by server and client                            */
/* ------------------------------------------------------------------ */

export function connectedParticipants(state: SessionState): ParticipantState[] {
  return state.participants.filter((p) => p.connected);
}

export function findParticipant(state: SessionState, userId: string): ParticipantState | undefined {
  return state.participants.find((p) => p.userId === userId);
}

export function isConductor(state: SessionState, userId: string): boolean {
  return state.conductorUserId === userId;
}

/** Derive the musical status from the metronome and participants. */
export function deriveStatus(state: SessionState, serverNow: number): SessionStatus {
  if (state.status === "ended") return "ended";
  const m = state.metronome;
  if (m.running && m.anchor) {
    const countInBeats = m.countInBars * m.beatsPerBar;
    const elapsedBeats =
      (serverNow - m.anchor.serverMs) / (60000 / m.anchor.bpm) + m.anchor.beatIndex;
    return elapsedBeats < 0 && countInBeats > 0 ? "counting_in" : "playing";
  }
  if (state.status === "paused") return "paused";
  const connected = connectedParticipants(state);
  if (connected.length === 0) return "created";
  if (!state.currentSong) return "waiting";
  return "ready";
}

/** Returns true when `incoming` should be applied over `current` (strictly newer). */
export function isNewer(currentSeq: number, incomingSeq: number): boolean {
  return incomingSeq > currentSeq;
}

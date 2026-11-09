import { DurableObject } from "cloudflare:workers";
import {
  type ClientMessage,
  clientMessageSchema,
  deriveStatus,
  initialSessionState,
  type ParticipantState,
  type RealtimeErrorCode,
  retimeAtNextBar,
  type ServerMessage,
  type SessionState,
  startAnchor,
} from "@bandsync/shared";
import { appendEvent, setSessionStatus, touchParticipant } from "../db/rehearsals";
import { listSongIds } from "../db/repertoires";
import { getSongForSession } from "../db/songs";
import type { Env } from "../env";
import { log } from "../lib/logger";

const STORAGE_KEY = "state";
const CONDUCTOR_GRACE_MS = 90_000;
const EMPTY_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_LEAD_MS = 2000;
const TEMPO_CHANGE_LEAD_MS = 400;

interface Attachment {
  userId: string;
}

interface InitBody {
  sessionId: string;
  bandId: string;
  repertoireId: string | null;
  createdBy: string;
}

export interface JoinIdentity {
  userId: string;
  displayName: string;
  instrument: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  canControl: boolean;
}

/**
 * One Durable Object instance per rehearsal session. It is the single authority over the
 * musical state: every change increments `seq`, is persisted, and is broadcast as a full
 * state snapshot to every connected device. WebSockets use the Hibernation API so an idle
 * session costs nothing while musicians are between songs.
 */
export class RehearsalSessionDO extends DurableObject<Env> {
  private state: SessionState | null = null;
  private allDisconnectedAt: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<SessionState>(STORAGE_KEY)) ?? null;
      this.allDisconnectedAt = (await ctx.storage.get<number>("allDisconnectedAt")) ?? null;
      // Reconcile connection flags after a restart: only sockets we still hold are connected.
      if (this.state) {
        const live = new Set(this.ctx.getWebSockets().map((ws) => this.attachmentOf(ws)?.userId));
        for (const p of this.state.participants) p.connected = live.has(p.userId);
      }
    });
  }

  /* ------------------------------------------------------------ */
  /* HTTP entry points (called by the Worker, never by browsers)   */
  /* ------------------------------------------------------------ */

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/init") {
      const body = (await request.json()) as InitBody;
      if (!this.state) {
        this.state = initialSessionState(body.sessionId, body.bandId, Date.now());
        if (body.repertoireId) {
          const ids = await listSongIds(this.env.DB, body.bandId, body.repertoireId);
          if (ids) {
            this.state.repertoireId = body.repertoireId;
            this.state.repertoireSongIds = ids;
          }
        }
        await this.persist();
      }
      return Response.json({ state: this.state, serverNow: Date.now() });
    }
    if (request.method === "GET" && url.pathname === "/state") {
      if (!this.state) return new Response("not found", { status: 404 });
      return Response.json({ state: this.state, serverNow: Date.now() });
    }
    if (request.method === "GET" && url.pathname === "/ws") {
      if (!this.state) return new Response("not found", { status: 404 });
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const identity = identityFromHeaders(request.headers);
      if (!identity) return new Response("missing identity", { status: 400 });
      if (this.state.status === "ended") return new Response("session ended", { status: 410 });

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server, [identity.userId]);
      server.serializeAttachment({ userId: identity.userId } satisfies Attachment);
      this.onJoin(identity);
      this.send(server, {
        type: "snapshot",
        state: this.state,
        serverNow: Date.now(),
        you: { userId: identity.userId },
      });
      this.ctx.waitUntil(
        touchParticipant(this.env.DB, this.state.sessionId, identity.userId).catch(() => {}),
      );
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  /* ------------------------------------------------------------ */
  /* WebSocket lifecycle (Hibernation API)                          */
  /* ------------------------------------------------------------ */

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const t1 = Date.now();
    const att = this.attachmentOf(ws);
    if (!att || !this.state) return;
    let parsed: ClientMessage;
    try {
      const json = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      const result = clientMessageSchema.safeParse(json);
      if (!result.success) {
        this.send(ws, { type: "error", code: "invalid_message" });
        return;
      }
      parsed = result.data;
    } catch {
      this.send(ws, { type: "error", code: "invalid_message" });
      return;
    }

    if (parsed.type === "ping") {
      this.send(ws, { type: "pong", t0: parsed.t0, t1, t2: Date.now() });
      return;
    }
    if (this.state.status === "ended") {
      this.send(ws, { type: "error", code: "session_ended" });
      return;
    }
    const participant = this.state.participants.find((p) => p.userId === att.userId);
    if (!participant) return;
    participant.lastSeenAt = Date.now();

    try {
      await this.handle(ws, participant, parsed);
    } catch (err) {
      log("error", "rehearsal.handle_failed", { type: parsed.type, error: String(err) });
      this.send(ws, { type: "error", code: "invalid_message" });
    }
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    void code;
    void reason;
    void wasClean;
    await this.onLeave(ws);
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    log("warn", "rehearsal.socket_error", { error: String(error) });
    await this.onLeave(ws);
  }

  override async alarm(): Promise<void> {
    if (!this.state || this.state.status === "ended") return;
    const now = Date.now();
    let changed = false;
    // Release a conductor that has been gone for longer than the grace period.
    if (this.state.conductorUserId) {
      const c = this.state.participants.find((p) => p.userId === this.state!.conductorUserId);
      if (c && !c.connected && now - c.lastSeenAt >= CONDUCTOR_GRACE_MS) {
        this.state.conductorUserId = null;
        changed = true;
      }
    }
    if (this.allDisconnectedAt !== null && now - this.allDisconnectedAt >= EMPTY_SESSION_TTL_MS) {
      await this.endSession(null);
      return;
    }
    if (changed) await this.commit("conductor_released", null);
    await this.scheduleAlarm();
  }

  /* ------------------------------------------------------------ */
  /* Command handling                                               */
  /* ------------------------------------------------------------ */

  private async handle(ws: WebSocket, me: ParticipantState, msg: ClientMessage): Promise<void> {
    const s = this.state!;
    const isConductor = s.conductorUserId === me.userId;
    const deny = (code: RealtimeErrorCode) => this.send(ws, { type: "error", code, seq: s.seq });

    switch (msg.type) {
      case "ping":
        return;
      case "set_ready":
        me.ready = msg.ready;
        return this.commit("participant_ready", me.userId, { ready: msg.ready });
      case "set_audio":
        me.audioEnabled = msg.enabled;
        return this.commit("participant_audio", me.userId, { enabled: msg.enabled });

      case "claim_conductor": {
        if (!me.canControl) return deny("not_allowed");
        const current = s.participants.find((p) => p.userId === s.conductorUserId);
        const vacant = !s.conductorUserId || !current?.connected;
        if (!vacant && !me.isAdmin) return deny("conductor_connected");
        s.conductorUserId = me.userId;
        return this.commit("conductor_changed", me.userId, { to: me.userId });
      }
      case "transfer_conductor": {
        if (!isConductor && !me.isAdmin) return deny("not_conductor");
        const target = s.participants.find((p) => p.userId === msg.userId);
        if (!target?.canControl) return deny("not_allowed");
        s.conductorUserId = target.userId;
        return this.commit("conductor_changed", me.userId, { to: target.userId });
      }
      case "end_session": {
        if (!isConductor && !me.isAdmin) return deny("not_conductor");
        return this.endSession(me.userId);
      }
    }

    // Everything below requires the conductor role.
    if (!isConductor) return deny("not_conductor");

    switch (msg.type) {
      case "set_repertoire": {
        if (msg.repertoireId === null) {
          s.repertoireId = null;
          s.repertoireSongIds = [];
          if (s.currentSong) s.currentSong.repertoireIndex = null;
          return this.commit("repertoire_changed", me.userId, { repertoireId: null });
        }
        const ids = await listSongIds(this.env.DB, s.bandId, msg.repertoireId);
        if (!ids) return deny("unknown_repertoire");
        s.repertoireId = msg.repertoireId;
        s.repertoireSongIds = ids;
        if (s.currentSong) {
          const idx = ids.indexOf(s.currentSong.songId);
          s.currentSong.repertoireIndex = idx === -1 ? null : idx;
        }
        return this.commit("repertoire_changed", me.userId, { repertoireId: msg.repertoireId });
      }
      case "set_song":
        return this.selectSong(ws, me, msg.songId);
      case "next_song":
      case "prev_song": {
        if (s.repertoireSongIds.length === 0) return deny("unknown_song");
        const cur = s.currentSong ? s.repertoireSongIds.indexOf(s.currentSong.songId) : -1;
        let next: number;
        if (msg.type === "next_song")
          next = cur === -1 ? 0 : Math.min(cur + 1, s.repertoireSongIds.length - 1);
        else next = cur === -1 ? 0 : Math.max(cur - 1, 0);
        if (next === cur) return; // already at the edge; nothing to do
        return this.selectSong(ws, me, s.repertoireSongIds[next]!);
      }
      case "set_tempo": {
        const m = s.metronome;
        m.bpm = msg.bpm;
        if (m.running && m.anchor) {
          m.anchor = retimeAtNextBar(
            m.anchor,
            m.beatsPerBar,
            msg.bpm,
            Date.now() + TEMPO_CHANGE_LEAD_MS,
          );
        }
        return this.commit("tempo_changed", me.userId, { bpm: msg.bpm });
      }
      case "set_time_signature": {
        const m = s.metronome;
        m.beatsPerBar = msg.beatsPerBar;
        m.beatUnit = msg.beatUnit;
        if (m.running) {
          // A meter change mid-performance restarts the grid; stop so the conductor starts again on purpose.
          m.running = false;
          m.anchor = null;
          s.status = "paused";
        }
        return this.commit("meter_changed", me.userId, {
          beatsPerBar: msg.beatsPerBar,
          beatUnit: msg.beatUnit,
        });
      }
      case "set_count_in":
        s.metronome.countInBars = msg.bars;
        return this.commit("count_in_changed", me.userId, { bars: msg.bars });
      case "set_subdivision":
        s.metronome.subdivision = msg.subdivision;
        return this.commit("subdivision_changed", me.userId, { subdivision: msg.subdivision });
      case "set_click_mode": {
        s.metronome.clickMode = msg.mode;
        s.metronome.centralUserId =
          msg.mode === "central" ? (msg.centralUserId ?? me.userId) : null;
        return this.commit("click_mode_changed", me.userId, {
          mode: msg.mode,
          centralUserId: s.metronome.centralUserId,
        });
      }
      case "start": {
        const m = s.metronome;
        if (m.running) return deny("already_running");
        const startAt = Date.now() + (msg.leadMs ?? DEFAULT_LEAD_MS);
        m.anchor = startAnchor(startAt, m.bpm, {
          beatsPerBar: m.beatsPerBar,
          countInBars: m.countInBars,
          subdivision: m.subdivision,
        });
        m.running = true;
        m.startedAtServerMs = startAt;
        return this.commit("metronome_started", me.userId, { startAt, bpm: m.bpm });
      }
      case "stop": {
        const m = s.metronome;
        if (!m.running) return deny("not_running");
        m.running = false;
        m.anchor = null;
        s.status = "paused";
        return this.commit("metronome_stopped", me.userId);
      }
    }
  }

  private async selectSong(
    ws: WebSocket,
    me: ParticipantState,
    songId: string | null,
  ): Promise<void> {
    const s = this.state!;
    if (songId === null) {
      s.currentSong = null;
      this.stopMetronomeSilently();
      return this.commit("song_changed", me.userId, { songId: null });
    }
    const song = await getSongForSession(this.env.DB, s.bandId, songId);
    if (!song) {
      this.send(ws, { type: "error", code: "unknown_song", seq: s.seq });
      return;
    }
    const idx = s.repertoireSongIds.indexOf(songId);
    s.currentSong = { ...song, repertoireIndex: idx === -1 ? null : idx };
    const m = s.metronome;
    if (song.bpm) m.bpm = song.bpm;
    m.beatsPerBar = song.beatsPerBar;
    m.beatUnit = song.beatUnit;
    this.stopMetronomeSilently();
    for (const p of s.participants) p.ready = false;
    return this.commit("song_changed", me.userId, { songId, bpm: m.bpm });
  }

  private stopMetronomeSilently(): void {
    const m = this.state!.metronome;
    m.running = false;
    m.anchor = null;
    m.startedAtServerMs = null;
    if (this.state!.status === "paused") this.state!.status = "ready";
  }

  private async endSession(actorUserId: string | null): Promise<void> {
    const s = this.state!;
    s.status = "ended";
    s.endedAt = Date.now();
    s.metronome.running = false;
    s.metronome.anchor = null;
    s.seq += 1;
    await this.persist();
    const msg: ServerMessage = { type: "ended", serverNow: Date.now() };
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify(msg));
        ws.close(1000, "session ended");
      } catch {
        // socket already gone
      }
    }
    await this.ctx.storage.deleteAlarm();
    this.ctx.waitUntil(
      Promise.all([
        setSessionStatus(this.env.DB, s.sessionId, "ended", true),
        appendEvent(this.env.DB, s.sessionId, s.seq, "session_ended", null, actorUserId),
      ]).catch((err) => log("error", "rehearsal.end_persist_failed", { error: String(err) })),
    );
  }

  /* ------------------------------------------------------------ */
  /* Presence                                                       */
  /* ------------------------------------------------------------ */

  private onJoin(identity: JoinIdentity): void {
    const s = this.state!;
    const now = Date.now();
    let p = s.participants.find((x) => x.userId === identity.userId);
    if (!p) {
      p = {
        userId: identity.userId,
        displayName: identity.displayName,
        instrument: identity.instrument,
        avatarUrl: identity.avatarUrl,
        connected: true,
        audioEnabled: true,
        ready: false,
        isAdmin: identity.isAdmin,
        canControl: identity.canControl,
        joinedAt: now,
        lastSeenAt: now,
      };
      s.participants.push(p);
    } else {
      p.connected = true;
      p.lastSeenAt = now;
      p.displayName = identity.displayName;
      p.instrument = identity.instrument;
      p.avatarUrl = identity.avatarUrl;
      p.isAdmin = identity.isAdmin;
      p.canControl = identity.canControl;
    }
    this.allDisconnectedAt = null;
    if (!s.conductorUserId && p.canControl) s.conductorUserId = p.userId;
    // Fire-and-forget commit: the joining socket receives the snapshot separately.
    void this.commit("participant_joined", p.userId, { userId: p.userId });
  }

  private async onLeave(ws: WebSocket): Promise<void> {
    const att = this.attachmentOf(ws);
    if (!att || !this.state) return;
    const stillOpen = this.ctx.getWebSockets(att.userId).some((other) => other !== ws);
    if (stillOpen) return;
    const p = this.state.participants.find((x) => x.userId === att.userId);
    if (!p) return;
    p.connected = false;
    p.lastSeenAt = Date.now();
    if (!this.state.participants.some((x) => x.connected)) {
      this.allDisconnectedAt = Date.now();
      await this.ctx.storage.put("allDisconnectedAt", this.allDisconnectedAt);
    }
    await this.commit("participant_left", p.userId, { userId: p.userId });
    await this.scheduleAlarm();
  }

  private async scheduleAlarm(): Promise<void> {
    if (!this.state || this.state.status === "ended") return;
    const conductor = this.state.participants.find((p) => p.userId === this.state!.conductorUserId);
    const times: number[] = [];
    if (conductor && !conductor.connected) times.push(conductor.lastSeenAt + CONDUCTOR_GRACE_MS);
    if (this.allDisconnectedAt !== null) times.push(this.allDisconnectedAt + EMPTY_SESSION_TTL_MS);
    if (times.length === 0) return;
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, Math.min(...times)));
  }

  /* ------------------------------------------------------------ */
  /* Persistence and broadcast                                      */
  /* ------------------------------------------------------------ */

  private async commit(type: string, actorUserId: string | null, payload?: unknown): Promise<void> {
    const s = this.state!;
    s.seq += 1;
    s.status = deriveStatus(s, Date.now());
    await this.persist();
    this.broadcast({ type: "state", state: s, serverNow: Date.now() });
    this.ctx.waitUntil(
      Promise.all([
        appendEvent(this.env.DB, s.sessionId, s.seq, type, payload, actorUserId),
        setSessionStatus(this.env.DB, s.sessionId, s.status, false),
      ]).catch((err) => log("warn", "rehearsal.event_persist_failed", { error: String(err) })),
    );
  }

  private async persist(): Promise<void> {
    if (this.state) await this.ctx.storage.put(STORAGE_KEY, this.state);
  }

  private broadcast(msg: ServerMessage): void {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // closed socket; cleanup happens in webSocketClose
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore
    }
  }

  private attachmentOf(ws: WebSocket): Attachment | null {
    try {
      return (ws.deserializeAttachment() as Attachment | null) ?? null;
    } catch {
      return null;
    }
  }
}

export function identityFromHeaders(h: Headers): JoinIdentity | null {
  const userId = h.get("x-bs-user-id");
  const displayName = h.get("x-bs-display-name");
  if (!userId || !displayName) return null;
  return {
    userId,
    displayName: decodeURIComponent(displayName),
    instrument: h.get("x-bs-instrument") || null,
    avatarUrl: h.get("x-bs-avatar") ? decodeURIComponent(h.get("x-bs-avatar")!) : null,
    isAdmin: h.get("x-bs-admin") === "1",
    canControl: h.get("x-bs-can-control") === "1",
  };
}

export function identityHeaders(identity: JoinIdentity): Record<string, string> {
  const out: Record<string, string> = {
    "x-bs-user-id": identity.userId,
    "x-bs-display-name": encodeURIComponent(identity.displayName),
    "x-bs-admin": identity.isAdmin ? "1" : "0",
    "x-bs-can-control": identity.canControl ? "1" : "0",
  };
  if (identity.instrument) out["x-bs-instrument"] = identity.instrument;
  if (identity.avatarUrl) out["x-bs-avatar"] = encodeURIComponent(identity.avatarUrl);
  return out;
}

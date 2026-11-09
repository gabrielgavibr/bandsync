import { runDurableObjectAlarm, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { ServerMessage, SessionState } from "@bandsync/shared";
import { describe, expect, it } from "vitest";
import {
  api,
  BASE,
  createBand,
  createSong,
  joinByCode,
  json,
  register,
  type Session,
} from "./helpers";

class Client {
  readonly messages: ServerMessage[] = [];
  private cursor = 0;
  private waiters: (() => void)[] = [];
  constructor(
    readonly ws: WebSocket,
    readonly label = "?",
  ) {
    ws.addEventListener("message", (ev) => {
      this.messages.push(JSON.parse(ev.data as string) as ServerMessage);
      for (const fn of this.waiters.splice(0)) fn();
    });
  }
  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }
  /** Resolves with the first not-yet-consumed message matching `pred` (past or future). */
  async next<T extends ServerMessage = ServerMessage>(
    pred: (m: ServerMessage) => boolean,
    timeoutMs = 5000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `timeout [${this.label}] waiting; got ${JSON.stringify(this.messages.map((m) => m.type))}`,
            ),
          ),
        timeoutMs,
      );
      const scan = () => {
        for (let i = this.cursor; i < this.messages.length; i += 1) {
          if (pred(this.messages[i]!)) {
            this.cursor = i + 1;
            clearTimeout(timer);
            resolve(this.messages[i] as T);
            return;
          }
        }
        this.cursor = this.messages.length;
        this.waiters.push(scan);
      };
      scan();
    });
  }
  async nextState(pred: (s: SessionState) => boolean, timeoutMs = 5000): Promise<SessionState> {
    const m = await this.next<Extract<ServerMessage, { type: "state" }>>(
      (x) => x.type === "state" && pred(x.state),
      timeoutMs,
    );
    return m.state;
  }
  async snapshot(): Promise<Extract<ServerMessage, { type: "snapshot" }>> {
    return this.next((x) => x.type === "snapshot");
  }
  close() {
    this.ws.close(1000, "bye");
  }
}

async function connect(s: Session, bandId: string, sessionId: string): Promise<Client> {
  const res = await SELF.fetch(`${BASE}/api/bands/${bandId}/rehearsals/${sessionId}/ws`, {
    headers: { upgrade: "websocket", cookie: s.cookie },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  return new Client(ws, s.email);
}

async function setup() {
  const drummer = await register({ displayName: "Drummer", primaryInstrument: "drums" });
  const bassist = await register({ displayName: "Bassist", primaryInstrument: "bass" });
  const bandId = await createBand(drummer, "Live Band");
  await joinByCode(drummer, bandId, bassist, "bass");
  const songA = await createSong(drummer, bandId, {
    title: "Song A",
    version: { bpm: 100, key: "G", beatsPerBar: 4, beatUnit: 4 },
  });
  const songB = await createSong(drummer, bandId, {
    title: "Song B",
    version: { bpm: 140, key: "E", beatsPerBar: 3, beatUnit: 4 },
  });
  const rep = await json(
    await api(
      "POST",
      `/api/bands/${bandId}/repertoires`,
      { name: "Rehearsal", kind: "rehearsal" },
      drummer.cookie,
    ),
  );
  const repId = rep.repertoire.id as string;
  await api(
    "POST",
    `/api/bands/${bandId}/repertoires/${repId}/items`,
    { songId: songA },
    drummer.cookie,
  );
  await api(
    "POST",
    `/api/bands/${bandId}/repertoires/${repId}/items`,
    { songId: songB },
    drummer.cookie,
  );
  const created = await api(
    "POST",
    `/api/bands/${bandId}/rehearsals`,
    { repertoireId: repId },
    drummer.cookie,
  );
  expect(created.status).toBe(201);
  const sessionId = (await json(created)).session.id as string;
  return { drummer, bassist, bandId, songA, songB, repId, sessionId };
}

describe("live rehearsal session", () => {
  it("reuses the active session instead of creating a second one", async () => {
    const { drummer, bandId, sessionId } = await setup();
    const again = await api("POST", `/api/bands/${bandId}/rehearsals`, {}, drummer.cookie);
    expect(again.status).toBe(200);
    const body = await json(again);
    expect(body.reused).toBe(true);
    expect(body.session.id).toBe(sessionId);
  });

  it("rejects WebSocket access from non-members and without upgrade", async () => {
    const { bandId, sessionId } = await setup();
    const outsider = await register();
    const res = await SELF.fetch(`${BASE}/api/bands/${bandId}/rehearsals/${sessionId}/ws`, {
      headers: { upgrade: "websocket", cookie: outsider.cookie },
    });
    expect(res.status).toBe(404);
    const plain = await SELF.fetch(`${BASE}/api/bands/${bandId}/rehearsals/${sessionId}/ws`);
    expect(plain.status).toBe(401);
  });

  it("shares song selection, tempo and meter across two devices with strictly increasing seq", async () => {
    const { drummer, bassist, bandId, songA, songB, sessionId } = await setup();
    const a = await connect(drummer, bandId, sessionId);
    const snapA = await a.snapshot();
    expect(snapA.you.userId).toBe(drummer.userId);
    expect(snapA.state.repertoireSongIds).toHaveLength(2);
    // First participant with control becomes conductor.
    expect(snapA.state.conductorUserId).toBe(drummer.userId);
    expect(typeof snapA.serverNow).toBe("number");

    const b = await connect(bassist, bandId, sessionId);
    const snapB = await b.snapshot();
    expect(snapB.state.participants.map((p) => p.displayName).sort()).toEqual([
      "Bassist",
      "Drummer",
    ]);
    const joined = await a.nextState((s) => s.participants.filter((p) => p.connected).length === 2);
    expect(joined.status).toBe("waiting");

    // The bassist is not the conductor and cannot select songs.
    b.send({ type: "set_song", songId: songA });
    const err = await b.next((m) => m.type === "error");
    expect(err).toMatchObject({ type: "error", code: "not_conductor" });

    // The drummer selects a song; both devices receive it with the version's bpm and meter.
    a.send({ type: "set_song", songId: songA });
    const [sa, sb] = await Promise.all([
      a.nextState((s) => s.currentSong?.songId === songA),
      b.nextState((s) => s.currentSong?.songId === songA),
    ]);
    expect(sa.currentSong?.title).toBe("Song A");
    expect(sa.metronome.bpm).toBe(100);
    expect(sa.metronome.beatsPerBar).toBe(4);
    expect(sa.status).toBe("ready");
    expect(sb.seq).toBe(sa.seq);
    expect(sa.currentSong?.repertoireIndex).toBe(0);

    // Next song follows the repertoire order and loads a 3/4 meter at 140 bpm.
    a.send({ type: "next_song" });
    const nb = await b.nextState((s) => s.currentSong?.songId === songB);
    expect(nb.metronome.bpm).toBe(140);
    expect(nb.metronome.beatsPerBar).toBe(3);
    expect(nb.currentSong?.repertoireIndex).toBe(1);
    // At the end of the list, next_song is a no-op (no new state).
    a.send({ type: "next_song" });
    a.send({ type: "prev_song" });
    const back = await b.nextState((s) => s.currentSong?.songId === songA);
    expect(back.currentSong?.repertoireIndex).toBe(0);

    // Unknown song id → error, state unchanged.
    a.send({ type: "set_song", songId: "does-not-exist" });
    const unknown = await a.next((m) => m.type === "error");
    expect(unknown).toMatchObject({ code: "unknown_song" });

    // Conductor changes tempo; everyone sees it.
    a.send({ type: "set_tempo", bpm: 92 });
    const tempo = await b.nextState((s) => s.metronome.bpm === 92);
    expect(tempo.metronome.running).toBe(false);

    // seq strictly increases on every state message each client received.
    for (const c of [a, b]) {
      const seqs = c.messages
        .filter((m) => m.type === "state")
        .map((m) => (m as { state: SessionState }).state.seq);
      for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
    a.close();
    b.close();
  });

  it("schedules the metronome start in the future on the server clock and answers clock pings", async () => {
    const { drummer, bassist, bandId, songA, sessionId } = await setup();
    const a = await connect(drummer, bandId, sessionId);
    await a.snapshot();
    const b = await connect(bassist, bandId, sessionId);
    await b.snapshot();

    const t0 = 123456;
    b.send({ type: "ping", t0 });
    const pong = await b.next<Extract<ServerMessage, { type: "pong" }>>((m) => m.type === "pong");
    expect(pong.t0).toBe(t0);
    expect(pong.t2).toBeGreaterThanOrEqual(pong.t1);

    a.send({ type: "set_song", songId: songA });
    await b.nextState((s) => s.currentSong?.songId === songA);
    a.send({ type: "set_count_in", bars: 2 });
    await b.nextState((s) => s.metronome.countInBars === 2);

    const before = Date.now();
    a.send({ type: "start", leadMs: 1500 });
    const [ra, rb] = await Promise.all([
      a.nextState((s) => s.metronome.running),
      b.nextState((s) => s.metronome.running),
    ]);
    expect(ra.metronome.anchor).toEqual(rb.metronome.anchor);
    const anchor = rb.metronome.anchor!;
    expect(anchor.bpm).toBe(100);
    expect(anchor.beatIndex).toBe(-8); // 2 bars of 4 beats count-in
    expect(anchor.serverMs).toBeGreaterThanOrEqual(before + 1500);
    expect(anchor.serverMs).toBeLessThan(before + 1500 + 2000);
    expect(rb.status).toBe("counting_in");

    // Starting twice is refused.
    a.send({ type: "start" });
    expect(await a.next((m) => m.type === "error")).toMatchObject({ code: "already_running" });

    // A tempo change while running lands on a future bar boundary (beat index multiple of 4, >= 0).
    a.send({ type: "set_tempo", bpm: 120 });
    const retimed = await b.nextState((s) => s.metronome.bpm === 120);
    expect(retimed.metronome.running).toBe(true);
    expect(retimed.metronome.anchor!.bpm).toBe(120);
    expect(retimed.metronome.anchor!.beatIndex % 4).toBe(0);
    expect(retimed.metronome.anchor!.beatIndex).toBeGreaterThanOrEqual(0);
    expect(retimed.metronome.anchor!.serverMs).toBeGreaterThan(Date.now());

    // A member can mute their own click without affecting the shared state.
    b.send({ type: "set_audio", enabled: false });
    const muted = await a.nextState((s) =>
      s.participants.some((p) => p.userId === bassist.userId && !p.audioEnabled),
    );
    expect(muted.metronome.running).toBe(true);

    a.send({ type: "stop" });
    const stopped = await b.nextState((s) => !s.metronome.running);
    expect(stopped.status).toBe("paused");
    expect(stopped.metronome.anchor).toBeNull();
    a.send({ type: "stop" });
    expect(await a.next((m) => m.type === "error")).toMatchObject({ code: "not_running" });
    a.close();
    b.close();
  });

  it("late joiners receive the full current state in the snapshot", async () => {
    const { drummer, bassist, bandId, songB, sessionId } = await setup();
    const a = await connect(drummer, bandId, sessionId);
    await a.snapshot();
    a.send({ type: "set_song", songId: songB });
    await a.nextState((s) => s.currentSong?.songId === songB);
    a.send({ type: "start", leadMs: 3000 });
    await a.nextState((s) => s.metronome.running);

    const b = await connect(bassist, bandId, sessionId);
    const snap = await b.snapshot();
    expect(snap.state.currentSong?.songId).toBe(songB);
    expect(snap.state.metronome.running).toBe(true);
    expect(snap.state.metronome.anchor?.bpm).toBe(140);
    expect(snap.state.status).toBe("counting_in");
    // REST view of the live state matches.
    const rest = await json(
      await api("GET", `/api/bands/${bandId}/rehearsals/${sessionId}`, undefined, bassist.cookie),
    );
    expect(rest.live.state.currentSong.songId).toBe(songB);
    expect(rest.live.state.seq).toBe(snap.state.seq);
    a.close();
    b.close();
  });

  it("transfers and reclaims the conductor role safely", async () => {
    const { drummer, bassist, bandId, sessionId } = await setup();
    const a = await connect(drummer, bandId, sessionId);
    await a.snapshot();
    const b = await connect(bassist, bandId, sessionId);
    await b.snapshot();
    await a.nextState((s) => s.participants.filter((p) => p.connected).length === 2);

    // While the conductor is connected, a member cannot take over.
    b.send({ type: "claim_conductor" });
    expect(await b.next((m) => m.type === "error")).toMatchObject({ code: "conductor_connected" });

    // Explicit transfer works; the previous conductor loses control immediately.
    a.send({ type: "transfer_conductor", userId: bassist.userId });
    await a.nextState((s) => s.conductorUserId === bassist.userId);
    a.send({ type: "set_tempo", bpm: 77 });
    expect(await a.next((m) => m.type === "error")).toMatchObject({ code: "not_conductor" });
    b.send({ type: "set_tempo", bpm: 77 });
    await a.nextState((s) => s.metronome.bpm === 77);

    // Conductor disconnects: the role stays reserved until the grace period passes...
    b.close();
    const left = await a.nextState((s) =>
      s.participants.some((p) => p.userId === bassist.userId && !p.connected),
    );
    expect(left.conductorUserId).toBe(bassist.userId);
    // ...but a connected member with control may claim it right away.
    a.send({ type: "claim_conductor" });
    const claimed = await a.nextState((s) => s.conductorUserId === drummer.userId);
    expect(claimed.conductorUserId).toBe(drummer.userId);

    // Alarm releases a disconnected conductor (simulate: drummer leaves too, role stays, alarm runs later).
    a.close();
    await new Promise((r) => setTimeout(r, 50));
    const stub = env.REHEARSAL.get(env.REHEARSAL.idFromName(sessionId));
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const after = await (await stub.fetch("https://do/state")).json<{ state: SessionState }>();
    // Grace period has not elapsed, so the conductor is kept.
    expect(after.state.conductorUserId).toBe(drummer.userId);
    expect(after.state.participants.every((p) => !p.connected)).toBe(true);
  });

  it("ends the session for everyone and refuses new connections", async () => {
    const { drummer, bassist, bandId, sessionId } = await setup();
    const a = await connect(drummer, bandId, sessionId);
    await a.snapshot();
    const b = await connect(bassist, bandId, sessionId);
    await b.snapshot();
    b.send({ type: "end_session" });
    expect(await b.next((m) => m.type === "error")).toMatchObject({ code: "not_conductor" });
    a.send({ type: "end_session" });
    const ended = await b.next((m) => m.type === "ended");
    expect(ended.type).toBe("ended");
    const rest = await json(
      await api("GET", `/api/bands/${bandId}/rehearsals/${sessionId}`, undefined, drummer.cookie),
    );
    expect(rest.session.status).toBe("ended");
    expect(rest.session.endedAt).not.toBeNull();
    const reconnect = await SELF.fetch(`${BASE}/api/bands/${bandId}/rehearsals/${sessionId}/ws`, {
      headers: { upgrade: "websocket", cookie: drummer.cookie },
    });
    expect(reconnect.status).toBe(409);
    // A new session can now be created.
    const fresh = await api("POST", `/api/bands/${bandId}/rehearsals`, {}, drummer.cookie);
    expect(fresh.status).toBe(201);
    const list = await json(
      await api("GET", `/api/bands/${bandId}/rehearsals`, undefined, drummer.cookie),
    );
    expect(list.active.id).toBe((await json(fresh)).session.id);
    expect(list.recent).toHaveLength(2);
  });
});

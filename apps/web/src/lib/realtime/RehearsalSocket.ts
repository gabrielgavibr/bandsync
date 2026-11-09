import {
  type ClientMessage,
  type ClockEstimate,
  ClockEstimator,
  isNewer,
  type ServerMessage,
  type SessionState,
} from "@bandsync/shared";

export type ConnectionStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "ended"
  | "rejected";

export interface SocketSnapshot {
  connection: ConnectionStatus;
  state: SessionState | null;
  youUserId: string | null;
  clock: ClockEstimate;
  lastError: { code: string; at: number } | null;
  /** Milliseconds between the last two pings, for diagnostics. */
  lastPongAt: number | null;
}

type Listener = (snap: SocketSnapshot) => void;

/**
 * WebSocket client for one rehearsal session.
 * - Applies only state messages with a seq strictly greater than the last applied one.
 * - Reconnects with exponential backoff; a new `snapshot` replaces local state entirely.
 * - Keeps an NTP-style clock estimate alive with periodic pings (fast at first, slower later).
 */
export class RehearsalSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private snap: SocketSnapshot;
  private estimator = new ClockEstimator({ windowSize: 16 });
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private pingsSent = 0;
  private closedByUser = false;

  constructor(private readonly url: string) {
    this.snap = {
      connection: "connecting",
      state: null,
      youUserId: null,
      clock: this.estimator.estimate(),
      lastError: null,
      lastPongAt: null,
    };
  }

  get snapshot(): SocketSnapshot {
    return this.snap;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snap);
    return () => this.listeners.delete(fn);
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  close(): void {
    this.closedByUser = true;
    this.clearTimers();
    this.ws?.close(1000, "leaving");
    this.ws = null;
    this.patch({ connection: "closed" });
  }

  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Current estimate of serverTime - clientTime (ms). */
  offsetMs(): number {
    return this.snap.clock.offsetMs;
  }

  /** Force a fresh burst of clock samples. */
  resync(): void {
    this.estimator.reset();
    this.pingsSent = 0;
    this.schedulePing(0);
  }

  /* ------------------------------------------------------------------ */

  private open(): void {
    this.clearTimers();
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.pingsSent = 0;
      this.patch({ connection: "open" });
      this.schedulePing(0);
    });
    this.ws.addEventListener("message", (ev) => this.onMessage(ev.data));
    this.ws.addEventListener("close", (ev) => {
      this.ws = null;
      this.clearTimers();
      if (this.closedByUser) return;
      if (this.snap.connection === "ended") return;
      // 4xx-like policy violations from the server are not worth retrying.
      if (
        ev.code === 1008 ||
        ev.code === 4401 ||
        ev.code === 4403 ||
        ev.code === 4404 ||
        ev.code === 4409
      ) {
        this.patch({ connection: "rejected" });
        return;
      }
      this.scheduleReconnect();
    });
    this.ws.addEventListener("error", () => {
      // The close event follows; nothing else to do here.
    });
  }

  private scheduleReconnect(): void {
    this.patch({ connection: "reconnecting" });
    const delay = Math.min(10_000, 500 * 2 ** this.reconnectAttempt) + Math.random() * 250;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private schedulePing(delay: number): void {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    this.pingTimer = setTimeout(() => {
      if (!this.send({ type: "ping", t0: Date.now() })) return;
      this.pingsSent += 1;
      // Burst of quick samples to converge, then a slow keep-alive that also tracks drift.
      this.schedulePing(this.pingsSent < 8 ? 300 : this.pingsSent < 20 ? 2000 : 10_000);
    }, delay);
  }

  private onMessage(raw: unknown): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "snapshot":
        // A snapshot is authoritative: it replaces whatever we had (reconnection or first join).
        this.patch({ state: msg.state, youUserId: msg.you.userId, lastError: null });
        if (this.snap.clock.sampleCount === 0) {
          // Rough first offset from the snapshot itself; refined by pings right after.
          this.patch({ clock: { ...this.snap.clock, offsetMs: msg.serverNow - Date.now() } });
        }
        break;
      case "state":
        if (!this.snap.state || isNewer(this.snap.state.seq, msg.state.seq))
          this.patch({ state: msg.state });
        break;
      case "pong": {
        const t3 = Date.now();
        const estimate = this.estimator.addSample({ t0: msg.t0, t1: msg.t1, t2: msg.t2, t3 });
        this.patch({ clock: estimate, lastPongAt: t3 });
        break;
      }
      case "error":
        this.patch({ lastError: { code: msg.code, at: Date.now() } });
        break;
      case "ended":
        this.clearTimers();
        this.patch({
          connection: "ended",
          state: this.snap.state ? { ...this.snap.state, status: "ended" } : null,
        });
        break;
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearTimeout(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
  }

  private patch(p: Partial<SocketSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    for (const fn of this.listeners) fn(this.snap);
  }
}

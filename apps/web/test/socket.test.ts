import { initialSessionState } from "@bandsync/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RehearsalSocket } from "../src/lib/realtime/RehearsalSocket";

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  constructor(public url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code: 1000 }));
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  receive(msg: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg) }));
  }
  drop() {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code: 1006 }));
  }
}

describe("RehearsalSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("applies snapshots, ignores stale states and keeps seq monotonic", () => {
    const sock = new RehearsalSocket("ws://x/ws");
    sock.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    const base = initialSessionState("s", "b", 0);
    ws.receive({
      type: "snapshot",
      state: { ...base, seq: 5 },
      serverNow: Date.now(),
      you: { userId: "me" },
    });
    expect(sock.snapshot.state?.seq).toBe(5);
    expect(sock.snapshot.youUserId).toBe("me");
    ws.receive({ type: "state", state: { ...base, seq: 7, conductorUserId: "a" }, serverNow: 0 });
    ws.receive({ type: "state", state: { ...base, seq: 6, conductorUserId: "b" }, serverNow: 0 });
    expect(sock.snapshot.state?.seq).toBe(7);
    expect(sock.snapshot.state?.conductorUserId).toBe("a");
    sock.close();
  });

  it("sends clock pings in a burst and folds pongs into the estimate", () => {
    const sock = new RehearsalSocket("ws://x/ws");
    sock.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    vi.advanceTimersByTime(10);
    expect(ws.sent.length).toBe(1);
    const ping = JSON.parse(ws.sent[0]!);
    expect(ping.type).toBe("ping");
    // Server is 200ms ahead, 20ms each way.
    const t1 = ping.t0 + 20 + 200;
    vi.setSystemTime(ping.t0 + 40);
    ws.receive({ type: "pong", t0: ping.t0, t1, t2: t1 });
    expect(sock.snapshot.clock.sampleCount).toBe(1);
    expect(sock.snapshot.clock.offsetMs).toBeCloseTo(200, 0);
    vi.advanceTimersByTime(2000);
    expect(ws.sent.length).toBeGreaterThanOrEqual(6);
    sock.close();
  });

  it("reconnects with backoff after an unexpected close and accepts a fresh snapshot", () => {
    const sock = new RehearsalSocket("ws://x/ws");
    sock.connect();
    const ws1 = FakeWebSocket.instances[0]!;
    ws1.open();
    ws1.receive({
      type: "snapshot",
      state: { ...initialSessionState("s", "b", 0), seq: 3 },
      serverNow: 0,
      you: { userId: "me" },
    });
    ws1.drop();
    expect(sock.snapshot.connection).toBe("reconnecting");
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBe(2);
    const ws2 = FakeWebSocket.instances[1]!;
    ws2.open();
    expect(sock.snapshot.connection).toBe("open");
    // A snapshot with lower seq after reconnect is still authoritative (new session object state).
    ws2.receive({
      type: "snapshot",
      state: { ...initialSessionState("s", "b", 0), seq: 2 },
      serverNow: 0,
      you: { userId: "me" },
    });
    expect(sock.snapshot.state?.seq).toBe(2);
    sock.close();
    expect(sock.snapshot.connection).toBe("closed");
  });

  it("marks the session ended and stops reconnecting", () => {
    const sock = new RehearsalSocket("ws://x/ws");
    sock.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.receive({ type: "ended", serverNow: 0 });
    ws.drop();
    vi.advanceTimersByTime(20_000);
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(sock.snapshot.connection).toBe("ended");
  });
});

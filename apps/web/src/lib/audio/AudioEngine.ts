/**
 * Owns the single AudioContext of the app and synthesises click sounds.
 * Mobile browsers require a user gesture before audio can play; `unlock()` must be called from
 * a click/tap handler. The engine also exposes the mapping between the audio clock
 * (`ctx.currentTime`) and `performance.now()` so scheduled wall-clock instants can be
 * converted into audio time.
 */
export type ClickSound = "beep" | "wood" | "tick";

export type AudioEngineStatus = "idle" | "locked" | "ready" | "suspended" | "unsupported";

type Listener = (status: AudioEngineStatus) => void;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private listeners = new Set<Listener>();
  private _status: AudioEngineStatus = "idle";
  volume = 0.8;
  sound: ClickSound = "beep";

  get status(): AudioEngineStatus {
    return this._status;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get supported(): boolean {
    return (
      typeof window !== "undefined" &&
      !!(
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext
      )
    );
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setStatus(s: AudioEngineStatus) {
    if (this._status === s) return;
    this._status = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Must run inside a user gesture on iOS/Android. Safe to call repeatedly. */
  async unlock(): Promise<boolean> {
    if (!this.supported) {
      this.setStatus("unsupported");
      return false;
    }
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.ctx.addEventListener("statechange", () => this.refreshStatus());
    }
    try {
      if (this.ctx.state !== "running") await this.ctx.resume();
      // Play a silent buffer: some iOS versions only unlock after a real playback.
      const buf = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.start();
    } catch {
      // resume can reject without a gesture; status reflects it below
    }
    this.refreshStatus();
    return this._status === "ready";
  }

  refreshStatus(): void {
    if (!this.ctx) {
      this.setStatus(this.supported ? "idle" : "unsupported");
      return;
    }
    if (this.ctx.state === "running") this.setStatus("ready");
    else if (this.ctx.state === "suspended")
      this.setStatus(this._status === "idle" ? "locked" : "suspended");
    else this.setStatus("locked");
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
  }

  /** Estimated time between scheduling and sound leaving the device, in seconds. */
  outputLatency(): number {
    if (!this.ctx) return 0;
    const c = this.ctx as AudioContext & { outputLatency?: number };
    return (c.outputLatency ?? 0) + (c.baseLatency ?? 0);
  }

  /**
   * Convert a `performance.now()` instant into AudioContext time.
   * Uses getOutputTimestamp when available for a tighter mapping; falls back to a one-shot sample.
   */
  perfToAudioTime(perfMs: number): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    let ctxNow = ctx.currentTime;
    let perfNow = performance.now();
    const ts = ctx.getOutputTimestamp?.();
    if (
      ts &&
      typeof ts.contextTime === "number" &&
      typeof ts.performanceTime === "number" &&
      ts.contextTime > 0
    ) {
      ctxNow = ts.contextTime;
      perfNow = ts.performanceTime;
    }
    return ctxNow + (perfMs - perfNow) / 1000;
  }

  /** Schedule a click at an absolute AudioContext time. */
  scheduleClick(atAudioTime: number, accent: boolean, sub = false): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state !== "running") return;
    if (atAudioTime < ctx.currentTime - 0.005) return; // too late; skip instead of bunching
    const gain = ctx.createGain();
    gain.connect(master);
    const level = sub ? 0.35 : accent ? 1 : 0.7;
    const t = Math.max(atAudioTime, ctx.currentTime);
    switch (this.sound) {
      case "wood": {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(accent ? 1800 : 1200, t);
        osc.frequency.exponentialRampToValueAtTime(accent ? 900 : 600, t + 0.02);
        gain.gain.setValueAtTime(level, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
        osc.connect(gain);
        osc.start(t);
        osc.stop(t + 0.04);
        break;
      }
      case "tick": {
        const len = Math.floor(ctx.sampleRate * 0.012);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = accent ? 4000 : 2600;
        filter.Q.value = 2;
        gain.gain.setValueAtTime(level * 1.4, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
        src.connect(filter).connect(gain);
        src.start(t);
        break;
      }
      default: {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = accent ? 1760 : sub ? 1046 : 1320;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(level, t + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        osc.connect(gain);
        osc.start(t);
        osc.stop(t + 0.06);
      }
    }
  }

  async suspend(): Promise<void> {
    if (this.ctx && this.ctx.state === "running") await this.ctx.suspend();
    this.refreshStatus();
  }
}

export const audioEngine = new AudioEngine();

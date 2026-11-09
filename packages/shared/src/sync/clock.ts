/**
 * NTP-style clock offset estimation between a client and the session server.
 *
 * Each sample is a 4-timestamp round trip:
 *   t0 client send, t1 server receive, t2 server send, t3 client receive.
 *   offset = ((t1 - t0) + (t2 - t3)) / 2   (server - client)
 *   rtt    = (t3 - t0) - (t2 - t1)
 *
 * Samples with a round-trip much larger than the best observed one are treated as
 * outliers (queued packets, GC pauses, radio wake-ups) and ignored for the estimate.
 */
export interface ClockSample {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
}

export type SyncQuality = "unknown" | "poor" | "fair" | "good";

export interface ClockEstimate {
  /** serverTime - clientTime, in ms. 0 when unknown. */
  offsetMs: number;
  /** Best (minimum) round trip seen in the window, ms. */
  minRttMs: number;
  /** Median round trip in the window, ms. */
  medianRttMs: number;
  /** Spread of accepted offsets (max - min), ms. A proxy for uncertainty. */
  jitterMs: number;
  sampleCount: number;
  quality: SyncQuality;
}

export interface ClockEstimatorOptions {
  windowSize?: number;
  /** Samples whose rtt exceeds minRtt * factor + slack are discarded. */
  outlierFactor?: number;
  outlierSlackMs?: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function qualityFor(minRttMs: number, jitterMs: number, samples: number): SyncQuality {
  if (samples < 3) return "unknown";
  if (minRttMs <= 60 && jitterMs <= 8) return "good";
  if (minRttMs <= 200 && jitterMs <= 30) return "fair";
  return "poor";
}

export class ClockEstimator {
  private readonly samples: ClockSample[] = [];
  private readonly windowSize: number;
  private readonly outlierFactor: number;
  private readonly outlierSlackMs: number;

  constructor(opts: ClockEstimatorOptions = {}) {
    this.windowSize = opts.windowSize ?? 16;
    this.outlierFactor = opts.outlierFactor ?? 1.5;
    this.outlierSlackMs = opts.outlierSlackMs ?? 5;
  }

  addSample(sample: ClockSample): ClockEstimate {
    const rtt = sample.t3 - sample.t0 - (sample.t2 - sample.t1);
    if (!Number.isFinite(rtt) || rtt < 0) return this.estimate();
    this.samples.push(sample);
    if (this.samples.length > this.windowSize) this.samples.shift();
    return this.estimate();
  }

  reset(): void {
    this.samples.length = 0;
  }

  estimate(): ClockEstimate {
    if (this.samples.length === 0) {
      return {
        offsetMs: 0,
        minRttMs: 0,
        medianRttMs: 0,
        jitterMs: 0,
        sampleCount: 0,
        quality: "unknown",
      };
    }
    const withRtt = this.samples.map((s) => ({
      rtt: s.t3 - s.t0 - (s.t2 - s.t1),
      offset: (s.t1 - s.t0 + (s.t2 - s.t3)) / 2,
    }));
    const minRtt = Math.min(...withRtt.map((s) => s.rtt));
    const threshold = minRtt * this.outlierFactor + this.outlierSlackMs;
    const accepted = withRtt.filter((s) => s.rtt <= threshold);
    const offsets = accepted.map((s) => s.offset);
    const offset = median(offsets);
    const jitter = offsets.length > 1 ? Math.max(...offsets) - Math.min(...offsets) : 0;
    return {
      offsetMs: offset,
      minRttMs: minRtt,
      medianRttMs: median(withRtt.map((s) => s.rtt)),
      jitterMs: jitter,
      sampleCount: this.samples.length,
      quality: qualityFor(minRtt, jitter, this.samples.length),
    };
  }

  /** Convert a server timestamp to the client's clock. */
  toClient(serverMs: number): number {
    return serverMs - this.estimate().offsetMs;
  }

  /** Convert a client timestamp to the server's clock. */
  toServer(clientMs: number): number {
    return clientMs + this.estimate().offsetMs;
  }
}

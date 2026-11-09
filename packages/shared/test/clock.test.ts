import { describe, expect, it } from "vitest";
import { ClockEstimator } from "../src/sync/clock";

function sample(offset: number, oneWay: number, extraDelay = 0) {
  const t0 = 1000;
  const t1 = t0 + oneWay + offset;
  const t2 = t1 + 1;
  const t3 = t2 - offset + oneWay + extraDelay;
  return { t0, t1, t2, t3 };
}

describe("ClockEstimator", () => {
  it("is unknown until it has samples", () => {
    const c = new ClockEstimator();
    expect(c.estimate().quality).toBe("unknown");
    expect(c.toClient(5000)).toBe(5000);
  });

  it("recovers a symmetric offset exactly", () => {
    const c = new ClockEstimator();
    for (let i = 0; i < 5; i += 1) c.addSample(sample(250, 20));
    const e = c.estimate();
    expect(e.offsetMs).toBeCloseTo(250, 5);
    expect(e.minRttMs).toBeCloseTo(40, 5);
    expect(e.quality).toBe("good");
    expect(c.toClient(10_250)).toBeCloseTo(10_000);
    expect(c.toServer(10_000)).toBeCloseTo(10_250);
  });

  it("ignores delayed outlier samples", () => {
    const c = new ClockEstimator();
    for (let i = 0; i < 6; i += 1) c.addSample(sample(100, 15));
    // A sample whose return trip got stuck for 400ms skews the naive offset by -200ms.
    c.addSample(sample(100, 15, 400));
    const e = c.estimate();
    expect(e.offsetMs).toBeCloseTo(100, 3);
    expect(e.sampleCount).toBe(7);
  });

  it("degrades quality with high latency or jitter", () => {
    const c = new ClockEstimator();
    for (let i = 0; i < 6; i += 1) c.addSample(sample(0, 180 + (i % 2) * 20));
    expect(["fair", "poor"]).toContain(c.estimate().quality);
    const d = new ClockEstimator();
    for (let i = 0; i < 6; i += 1) d.addSample(sample(0, 400));
    expect(d.estimate().quality).toBe("poor");
  });

  it("keeps a bounded window", () => {
    const c = new ClockEstimator({ windowSize: 4 });
    for (let i = 0; i < 10; i += 1) c.addSample(sample(i, 10));
    expect(c.estimate().sampleCount).toBe(4);
  });

  it("rejects impossible samples", () => {
    const c = new ClockEstimator();
    c.addSample({ t0: 100, t1: 50, t2: 60, t3: 90 }); // negative rtt
    expect(c.estimate().sampleCount).toBe(0);
  });
});

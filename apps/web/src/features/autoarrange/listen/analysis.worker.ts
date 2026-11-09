/// <reference lib="webworker" />
import { AnalysisError, analyzeAudio } from "@bandsync/shared";

/** Runs BandSync's analysis away from the interface thread. Audio never leaves the device. */
self.onmessage = (e: MessageEvent<{ channels: Float32Array[]; sampleRate: number }>) => {
  try {
    const report = analyzeAudio(e.data.channels, e.data.sampleRate);
    self.postMessage({ ok: true, report });
  } catch (err) {
    self.postMessage({ ok: false, code: err instanceof AnalysisError ? err.code : "failed" });
  }
};

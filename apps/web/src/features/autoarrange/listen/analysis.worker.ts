/// <reference lib="webworker" />
import { AnalysisError, analyzeAudio, PrearrangeError, prearrange } from "@bandsync/shared";

/**
 * Runs BandSync's analysis away from the interface thread. Audio never leaves the device.
 * mode "report": tempo, beats, meter, key. mode "prearrange": the whole pre-arrangement.
 */
self.onmessage = (
  e: MessageEvent<{ channels: Float32Array[]; sampleRate: number; mode?: "report" | "prearrange" }>,
) => {
  try {
    if (e.data.mode === "prearrange") {
      self.postMessage({
        ok: true,
        prearrangement: prearrange(e.data.channels, e.data.sampleRate),
      });
    } else {
      self.postMessage({ ok: true, report: analyzeAudio(e.data.channels, e.data.sampleRate) });
    }
  } catch (err) {
    const code =
      err instanceof AnalysisError || err instanceof PrearrangeError ? err.code : "failed";
    self.postMessage({ ok: false, code });
  }
};

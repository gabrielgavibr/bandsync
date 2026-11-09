import { AnalysisError, type AnalysisReport, analyzeAudio } from "@bandsync/shared";

/**
 * Getting audio into BandSync's analysis, on the device only:
 *  - from the microphone, while a member plays the reference recording;
 *  - from an audio file the band declared it may process.
 * Nothing here downloads from YouTube or Spotify, and the captured audio is neither stored nor
 * sent anywhere: only the analysis results are.
 */

export type AnalysisFailure =
  | "too_short"
  | "no_signal"
  | "failed"
  | "mic_denied"
  | "mic_unavailable"
  | "decode_failed";

export class ListenError extends Error {
  constructor(readonly code: AnalysisFailure) {
    super(code);
  }
}

export interface Pcm {
  channels: Float32Array[];
  sampleRate: number;
}

/** Runs the analysis in a worker; falls back to this thread where workers are unavailable. */
export function analyse(pcm: Pcm): Promise<AnalysisReport> {
  if (typeof Worker === "undefined") {
    try {
      return Promise.resolve(analyzeAudio(pcm.channels, pcm.sampleRate));
    } catch (err) {
      return Promise.reject(new ListenError(err instanceof AnalysisError ? err.code : "failed"));
    }
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (
      e: MessageEvent<{ ok: true; report: AnalysisReport } | { ok: false; code: AnalysisFailure }>,
    ) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.report);
      else reject(new ListenError(e.data.code));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new ListenError("failed"));
    };
    worker.postMessage(
      pcm,
      pcm.channels.map((c) => c.buffer as ArrayBuffer),
    );
  });
}

type AudioContextCtor = typeof AudioContext;
const Ctx = (): AudioContextCtor | undefined =>
  (globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor })
    .AudioContext ?? (globalThis as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;

/** Decodes an audio file on the device. */
export async function decodeFile(data: Blob): Promise<Pcm> {
  const C = Ctx();
  if (!C) throw new ListenError("decode_failed");
  const ctx = new C();
  try {
    const buf = await ctx.decodeAudioData(await data.arrayBuffer());
    const channels: Float32Array[] = [];
    for (let i = 0; i < Math.min(2, buf.numberOfChannels); i += 1)
      channels.push(new Float32Array(buf.getChannelData(i)));
    return { channels, sampleRate: buf.sampleRate };
  } catch {
    throw new ListenError("decode_failed");
  } finally {
    void ctx.close();
  }
}

export interface MicCapture {
  /** Seconds captured so far. */
  seconds: () => number;
  /** Loudness of the last block, 0..1, for a level meter. */
  level: () => number;
  /** Stops listening and returns what was heard. */
  stop: () => Pcm;
  /** Stops listening and discards everything. */
  cancel: () => void;
}

/**
 * Listens through the microphone. Echo cancellation, noise suppression and automatic gain are
 * turned off: they are made for voices and would remove the music we want to hear.
 */
export async function startMicCapture(maxSeconds = 60): Promise<MicCapture> {
  const C = Ctx();
  if (!C || !navigator.mediaDevices?.getUserMedia) throw new ListenError("mic_unavailable");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    const name = (err as { name?: string }).name;
    throw new ListenError(
      name === "NotAllowedError" || name === "SecurityError" ? "mic_denied" : "mic_unavailable",
    );
  }
  const ctx = new C();
  await ctx.resume().catch(() => undefined);
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated but is the one capture path every mobile browser supports.
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0; // keep the graph running without playing the microphone back
  const chunks: Float32Array[] = [];
  let total = 0;
  let lastLevel = 0;
  const max = Math.ceil(maxSeconds * ctx.sampleRate);
  proc.onaudioprocess = (e) => {
    if (total >= max) return;
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(data);
    total += data.length;
    let s = 0;
    for (const v of data) s += v * v;
    lastLevel = Math.min(1, Math.sqrt(s / data.length) * 4);
  };
  source.connect(proc);
  proc.connect(sink);
  sink.connect(ctx.destination);
  const close = () => {
    proc.onaudioprocess = null;
    source.disconnect();
    proc.disconnect();
    for (const t of stream.getTracks()) t.stop();
    void ctx.close();
  };
  return {
    seconds: () => total / ctx.sampleRate,
    level: () => lastLevel,
    stop: () => {
      close();
      const out = new Float32Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c.subarray(0, Math.min(c.length, total - off)), off);
        off += c.length;
      }
      return { channels: [out], sampleRate: ctx.sampleRate };
    },
    cancel: () => {
      close();
      chunks.length = 0;
    },
  };
}

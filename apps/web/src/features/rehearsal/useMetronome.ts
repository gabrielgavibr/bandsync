import {
  type ClickEvent,
  describeBeat,
  type MeterSpec,
  type MetronomeState,
} from "@bandsync/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { type AudioEngineStatus, audioEngine, type ClickSound } from "../../lib/audio/AudioEngine";
import { MetronomeScheduler } from "../../lib/audio/MetronomeScheduler";

export interface BeatDisplay {
  beatIndex: number;
  beatInBar: number;
  bar: number;
  isCountIn: boolean;
  beatsPerBar: number;
  /** Increments on every beat so the UI can trigger a pulse animation. */
  pulse: number;
}

export function useAudioStatus(): AudioEngineStatus {
  const [status, setStatus] = useState(audioEngine.status);
  useEffect(() => audioEngine.subscribe(setStatus), []);
  useEffect(() => {
    const onVis = () => audioEngine.refreshStatus();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return status;
}

/**
 * Drives the scheduler from a MetronomeState (shared or local) and exposes the beat currently
 * sounding for the visual indicator. Visual updates are timed with the audio clock: a click that
 * is scheduled 100 ms ahead is shown 100 ms later, not when it was scheduled.
 */
export function useMetronome(
  metronome: MetronomeState | null,
  opts: { audible: boolean; getOffsetMs: () => number; volume: number; sound: ClickSound },
): { beat: BeatDisplay | null; scheduler: MetronomeScheduler } {
  const [beat, setBeat] = useState<BeatDisplay | null>(null);
  const pending = useRef<{ clientMs: number; ev: ClickEvent }[]>([]);
  const pulse = useRef(0);
  const getOffsetRef = useRef(opts.getOffsetMs);
  getOffsetRef.current = opts.getOffsetMs;

  const scheduler = useMemo(
    () =>
      new MetronomeScheduler({
        engine: audioEngine,
        getOffsetMs: () => getOffsetRef.current(),
        onClick: (ev, _audioTime, clientMs) => {
          if (ev.sub === 0) pending.current.push({ clientMs, ev });
        },
      }),
    [],
  );

  useEffect(() => {
    audioEngine.setVolume(opts.volume);
  }, [opts.volume]);
  useEffect(() => {
    audioEngine.sound = opts.sound;
  }, [opts.sound]);

  // Visual loop: promote pending clicks to the display when their time arrives.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = Date.now(); // visual beat follows the scheduled instant; output latency is reported in diagnostics
      const list = pending.current;
      let shown: ClickEvent | null = null;
      while (list.length && list[0]!.clientMs <= now) shown = list.shift()!.ev;
      if (shown) {
        pulse.current += 1;
        const bpb = metronome?.beatsPerBar ?? 4;
        const info = describeBeat(shown.beatIndex, bpb);
        setBeat({
          beatIndex: shown.beatIndex,
          beatInBar: info.beatInBar,
          bar: info.bar,
          isCountIn: info.isCountIn,
          beatsPerBar: bpb,
          pulse: pulse.current,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [metronome?.beatsPerBar]);

  const anchorKey = metronome?.anchor
    ? `${metronome.anchor.serverMs}:${metronome.anchor.beatIndex}:${metronome.anchor.bpm}`
    : null;
  const meterKey = metronome
    ? `${metronome.beatsPerBar}:${metronome.countInBars}:${metronome.subdivision}`
    : null;
  const running = !!metronome?.running;
  const metronomeRef = useRef(metronome);
  metronomeRef.current = metronome;
  const audibleRef = useRef(opts.audible);
  audibleRef.current = opts.audible;

  // Re-plan only when the timeline itself changes (anchor or meter), never on unrelated re-renders.
  // biome-ignore lint/correctness/useExhaustiveDependencies: anchorKey/meterKey encode the metronome fields that matter
  useEffect(() => {
    const m = metronomeRef.current;
    if (!m?.running || !m.anchor) {
      scheduler.stop();
      pending.current = [];
      setBeat(null);
      return;
    }
    const meter: MeterSpec = {
      beatsPerBar: m.beatsPerBar,
      countInBars: m.countInBars,
      subdivision: m.subdivision,
    };
    scheduler.start({ anchor: m.anchor, meter, audible: audibleRef.current });
  }, [scheduler, running, anchorKey, meterKey]);

  useEffect(() => {
    scheduler.update({ audible: opts.audible });
  }, [scheduler, opts.audible]);

  useEffect(() => () => scheduler.stop(), [scheduler]);

  return { beat, scheduler };
}

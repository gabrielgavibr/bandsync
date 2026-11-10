/**
 * One clock for the arrangement page, whatever is playing: the band's own uploaded file (an
 * `<audio>` element fed by the private, range-capable file endpoint) or the official YouTube
 * player. The timeline, the section list and the editor only talk to this.
 *
 * On top of it, `useSectionPlayback` plays one passage: from its start to its end, once or in a
 * loop, optionally carrying on into the next one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerControls } from "./youtube";

export interface Transport {
  kind: "file" | "youtube";
  ready: boolean;
  failed: boolean;
  playing: boolean;
  /** Seconds. */
  time: number;
  duration: number;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  /** Reads the position right now (state updates lag a little behind). */
  now: () => number;
  /** 0..1; null where the platform does not let a page set it (iOS, the YouTube player). */
  volume: number | null;
  setVolume: (v: number) => void;
}

/**
 * Plays a file of the band. One `<audio>` element per mounted page: it is created once, reused
 * when the file changes, and released on unmount (so nothing keeps playing or holding memory
 * after leaving the page).
 */
export function useFileTransport(url: string | null): Transport {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState<number | null>(1);

  useEffect(() => {
    if (!url) return;
    const el = audio.current ?? new Audio();
    audio.current = el;
    el.preload = "metadata";
    setReady(false);
    setFailed(false);
    setPlaying(false);
    setTime(0);
    setDuration(0);
    const onMeta = () => {
      setReady(true);
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    };
    const onTime = () => setTime(el.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => setFailed(true);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("seeked", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("error", onError);
    el.src = url;
    // iOS ignores volume set from a page: offer the control only where it works.
    try {
      el.volume = 0.5;
      setVolumeState(Math.abs(el.volume - 0.5) < 0.01 ? 1 : null);
      el.volume = 1;
    } catch {
      setVolumeState(null);
    }
    return () => {
      el.pause();
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("seeked", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      el.removeEventListener("error", onError);
      el.removeAttribute("src");
      el.load();
    };
  }, [url]);

  // A smooth playhead while playing (timeupdate only fires a few times a second).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (audio.current) setTime(audio.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return useMemo<Transport>(
    () => ({
      kind: "file",
      ready,
      failed,
      playing,
      time,
      duration,
      play: () => {
        void audio.current?.play().catch(() => setPlaying(false));
      },
      pause: () => audio.current?.pause(),
      seek: (s) => {
        const el = audio.current;
        if (!el) return;
        const max = Number.isFinite(el.duration) ? el.duration : s;
        el.currentTime = Math.max(0, Math.min(s, max));
        setTime(el.currentTime);
      },
      now: () => audio.current?.currentTime ?? 0,
      volume,
      setVolume: (v) => {
        if (!audio.current || volume === null) return;
        audio.current.volume = Math.max(0, Math.min(1, v));
        setVolumeState(audio.current.volume);
      },
    }),
    [ready, failed, playing, time, duration, volume],
  );
}

/** The official YouTube player as a transport (no volume: the player has its own control). */
export function youTubeTransport(yt: PlayerControls): Transport {
  return {
    kind: "youtube",
    ready: yt.ready,
    failed: yt.failed,
    playing: yt.playing,
    time: yt.time,
    duration: yt.duration,
    play: yt.play,
    pause: yt.pause,
    seek: yt.seek,
    now: yt.now,
    volume: null,
    setVolume: () => undefined,
  };
}

export interface Passage {
  /** Stable identity of what is playing (a section's key or index), for highlighting. */
  id: string;
  startSec: number;
  endSec: number;
  /** Shown in the player while it sounds. */
  name?: string;
}

export interface SectionPlayback {
  /** The passage being played on its own, if any. */
  active: Passage | null;
  loop: boolean;
  setLoop: (v: boolean) => void;
  /** Carry on into the following passage instead of stopping at the end of this one. */
  carryOn: boolean;
  setCarryOn: (v: boolean) => void;
  /** Plays a passage from its start. */
  playPassage: (p: Passage) => void;
  /** Leaves passage mode; playback goes on freely. */
  release: () => void;
  /** Moves to the passage before / after the current one (in its own list) and plays it. */
  step: (by: 1 | -1) => void;
  /** Per list: the passage where playback is right now. */
  current: Record<string, string | null>;
}

/**
 * Passage playback over a transport: stops (or loops) at the passage's end. `lists` are the
 * maps a passage can belong to (the recording's pre-arrangement, the band's arrangement); the
 * first list that has passages is the one "next / previous" walks when nothing is selected.
 */
export function useSectionPlayback(
  transport: Transport | null,
  lists: Record<string, Passage[]>,
): SectionPlayback {
  const [active, setActive] = useState<Passage | null>(null);
  const [loop, setLoop] = useState(false);
  const [carryOn, setCarryOn] = useState(false);
  const live = useRef({ transport, active, loop, carryOn, lists });
  live.current = { transport, active, loop, carryOn, lists };
  const listOf = (id: string) =>
    Object.values(live.current.lists).find((l) => l.some((p) => p.id === id)) ?? [];

  // The boundaries of the active passage may be edited while it plays: follow them.
  useEffect(() => {
    if (!active) return;
    const same = Object.values(lists)
      .flat()
      .find((p) => p.id === active.id);
    if (same && (same.startSec !== active.startSec || same.endSec !== active.endSec))
      setActive(same);
  }, [lists, active]);

  // Watches the end of the active passage, reading the position directly (state lags behind).
  const playing = transport?.playing ?? false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: listOf reads the live ref
  useEffect(() => {
    if (!playing || !active) return;
    let raf = 0;
    const tick = () => {
      const { transport: t, active: a, loop: l, carryOn: c } = live.current;
      if (t && a) {
        const now = t.now();
        if (now >= a.endSec - 0.02) {
          if (l) t.seek(a.startSec);
          else if (c) {
            const list = listOf(a.id);
            setActive(list[list.findIndex((p) => p.id === a.id) + 1] ?? null);
          } else {
            t.pause();
            t.seek(a.endSec);
            return;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, active]);

  const playPassage = useCallback((p: Passage) => {
    const t = live.current.transport;
    if (!t) return;
    setActive(p);
    t.seek(p.startSec);
    t.play();
  }, []);

  const time = transport?.time ?? 0;
  const current = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const [name, list] of Object.entries(lists)) {
      const own = active && list.some((p) => p.id === active.id) ? active.id : null;
      out[name] = own ?? list.find((p) => time >= p.startSec && time < p.endSec)?.id ?? null;
    }
    return out;
  }, [active, lists, time]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: listOf reads the live ref
  const step = useCallback(
    (by: 1 | -1) => {
      const { lists: all, transport: t, active: a } = live.current;
      if (!t) return;
      const list = a ? listOf(a.id) : (Object.values(all).find((l) => l.length > 0) ?? []);
      if (list.length === 0) return;
      const now = t.now();
      const i = a
        ? list.findIndex((p) => p.id === a.id)
        : list.findIndex((p) => now >= p.startSec && now < p.endSec);
      const target = list[Math.max(0, Math.min(list.length - 1, i + by))];
      if (target) playPassage(target);
    },
    [playPassage],
  );

  return {
    active,
    loop,
    setLoop,
    carryOn,
    setCarryOn,
    playPassage,
    release: () => setActive(null),
    step,
    current,
  };
}

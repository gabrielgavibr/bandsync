/**
 * The official YouTube IFrame Player API, used only for what it offers: playing the video,
 * knowing its duration and where playback is, and jumping to a moment. Nothing here reads,
 * captures or forwards the audio.
 * https://developers.google.com/youtube/iframe_api_reference
 */
import { useEffect, useRef, useState } from "react";

interface YTPlayer {
  getDuration(): number;
  getCurrentTime(): number;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      host?: string;
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

type YTWindow = Window & { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };

export const YT_API_URL = "https://www.youtube.com/iframe_api";
const PLAYING = 1;

let loading: Promise<YTNamespace> | null = null;

/** Loads the official script once per page. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  const w = window as YTWindow;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (loading) return loading;
  loading = new Promise<YTNamespace>((resolve, reject) => {
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (w.YT?.Player) resolve(w.YT);
      else reject(new Error("youtube_api"));
    };
    const s = document.createElement("script");
    s.src = YT_API_URL;
    s.async = true;
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error("youtube_api"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export interface PlayerControls {
  ready: boolean;
  /** The script or the video could not be loaded. */
  failed: boolean;
  /** Seconds, as the player reports it (0 until known). */
  duration: number;
  /** Current playback position in seconds, refreshed while the page is open. */
  time: number;
  playing: boolean;
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  /** Reads the position right now (for marks made by a person while listening). */
  now: () => number;
}

/**
 * Mounts the official player in `host` for `videoId`. Uses the privacy-enhanced host
 * (youtube-nocookie.com), as the embed elsewhere in BandSync does.
 */
export function useYouTubePlayer(
  host: React.RefObject<HTMLDivElement | null>,
  videoId: string | null,
): PlayerControls {
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!videoId || !host.current) return;
    let cancelled = false;
    setReady(false);
    setFailed(false);
    const mount = document.createElement("div");
    host.current.replaceChildren(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        player.current = new YT.Player(mount, {
          host: "https://www.youtube-nocookie.com",
          videoId,
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: () => {
              if (cancelled) return;
              setReady(true);
              setDuration(player.current?.getDuration() ?? 0);
            },
            onStateChange: (e) => {
              setPlaying(e.data === PLAYING);
              const d = player.current?.getDuration() ?? 0;
              if (d > 0) setDuration(d);
            },
            onError: () => setFailed(true),
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      try {
        player.current?.destroy();
      } catch {
        /* already gone */
      }
      player.current = null;
    };
  }, [host, videoId]);

  // Position of the playhead: polled, as the API has no time event.
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      const p = player.current;
      if (!p) return;
      try {
        setTime(p.getCurrentTime() || 0);
      } catch {
        /* player not ready yet */
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [ready]);

  return {
    ready,
    failed,
    duration,
    time,
    playing,
    seek: (s) => {
      player.current?.seekTo(Math.max(0, s), true);
      setTime(Math.max(0, s));
    },
    play: () => player.current?.playVideo(),
    pause: () => player.current?.pauseVideo(),
    now: () => {
      try {
        return player.current?.getCurrentTime() ?? 0;
      } catch {
        return 0;
      }
    },
  };
}

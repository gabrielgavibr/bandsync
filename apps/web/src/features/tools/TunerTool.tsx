import { type Notation, parseNote, spellPitchClass } from "@bandsync/shared";
import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui";
import { describeFrequency, detectPitch } from "../../lib/audio/pitch";
import { cn } from "../../lib/cn";
import { useAuth } from "../auth/AuthProvider";

export function TunerTool() {
  const { t } = useTranslation("tools");
  const { preferences } = useAuth();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<{
    freq: number;
    note: string;
    octave: number;
    cents: number;
  } | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef(0);
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const stop = () => {
    cancelAnimationFrame(raf.current);
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    void ctx.current?.close();
    ctx.current = null;
    setListening(false);
    setReading(null);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: stop only touches refs; run once on unmount
  useEffect(() => () => stop(), []);

  const start = async () => {
    setError(null);
    if (!supported) {
      setError(t("tuner.unsupported"));
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      setError(t("tuner.permission"));
      return;
    }
    const ac = new AudioContext();
    ctx.current = ac;
    const src = ac.createMediaStreamSource(stream.current);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let smooth: number | null = null;
    const loop = () => {
      analyser.getFloatTimeDomainData(buf);
      const f = detectPitch(buf, ac.sampleRate);
      if (f) {
        smooth = smooth === null ? f : smooth * 0.7 + f * 0.3;
        const d = describeFrequency(smooth);
        setReading({ freq: smooth, note: d.note, octave: d.octave, cents: d.cents });
      } else {
        smooth = null;
        setReading(null);
      }
      raf.current = requestAnimationFrame(loop);
    };
    setListening(true);
    loop();
  };

  const notation = (preferences?.notation as Notation) ?? "english";
  const noteLabel = reading ? spellPitchClass(parseNote(reading.note) ?? 0, { notation }) : "—";
  const inTune = reading ? Math.abs(reading.cents) <= 5 : false;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full flex-col items-center rounded-2xl bg-sunken py-6">
        <p className={cn("text-6xl font-semibold tabular-nums", inTune ? "text-ok-500" : "")}>
          {noteLabel}
          {reading ? <span className="text-2xl text-muted">{reading.octave}</span> : null}
        </p>
        <div className="relative mt-4 h-3 w-64 rounded-full bg-elev">
          <span className="absolute left-1/2 top-0 h-3 w-0.5 -translate-x-1/2 bg-muted" />
          {reading ? (
            <span
              className={cn(
                "absolute top-0 size-3 -translate-x-1/2 rounded-full transition-[left]",
                inTune ? "bg-ok-500" : "bg-warn-500",
              )}
              style={{ left: `${50 + Math.max(-50, Math.min(50, reading.cents))}%` }}
            />
          ) : null}
        </div>
        <p className="mt-3 font-mono text-sm text-muted">
          {reading
            ? `${reading.cents > 0 ? "+" : ""}${reading.cents} ${t("tuner.cents")} · ${reading.freq.toFixed(1)} ${t("tuner.frequency")}`
            : listening
              ? t("tuner.quiet")
              : " "}
        </p>
      </div>
      {error ? (
        <p className="text-sm text-danger-500" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        size="lg"
        variant={listening ? "danger" : "primary"}
        onClick={listening ? stop : start}
        icon={listening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
      >
        {listening ? t("tuner.stop") : t("tuner.start")}
      </Button>
    </div>
  );
}

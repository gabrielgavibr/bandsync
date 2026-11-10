import { type Notation, parseNote, spellPitchClass } from "@bandsync/shared";
import { Mic, MicOff, Minus, Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Segmented } from "../../components/ui";
import {
  A4_MAX,
  A4_MIN,
  meterPosition,
  SENSITIVITY_PRESETS,
  type SensitivityPreset,
  TUNER_WINDOW,
  TunerEngine,
  type TunerFrame,
} from "../../lib/audio/tuner";
import { cn } from "../../lib/cn";
import { useAuth } from "../auth/AuthProvider";

type Phase = "idle" | "requesting" | "running" | "denied" | "unsupported";
/** How the input level reads on the meter (loudness only; not how sure the note is). */
type Zone = "none" | "weak" | "good" | "hot";

const ANALYSE_EVERY_MS = 40;

function presetOf(sensitivity: number): SensitivityPreset {
  return sensitivity < 35 ? "low" : sensitivity < 65 ? "normal" : "high";
}

/**
 * Chromatic tuner. The microphone is opened with the browser's voice processing off (automatic
 * gain, noise suppression and echo cancellation distort or erase sustained notes); what is
 * heard is analysed on the device and nothing is recorded or sent.
 */
export function TunerTool() {
  const { t } = useTranslation("tools");
  const { preferences, updatePreferences } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");
  const [frame, setFrame] = useState<TunerFrame | null>(null);
  const [sensitivity, setSensitivity] = useState(preferences?.tunerSensitivity ?? 50);
  const [a4, setA4] = useState(preferences?.tunerA4 ?? 440);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef(0);
  const engine = useRef<TunerEngine | null>(null);
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  // The account's settings arrive after the first paint on a cold start.
  const loaded = useRef(false);
  useEffect(() => {
    if (!preferences || loaded.current) return;
    loaded.current = true;
    setSensitivity(preferences.tunerSensitivity ?? 50);
    setA4(preferences.tunerA4 ?? 440);
  }, [preferences]);

  useEffect(() => {
    engine.current?.setSettings({ sensitivity, a4 });
  }, [sensitivity, a4]);

  // Saved for this person a moment after the last change (a slider fires many times).
  const save = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = (patch: { tunerSensitivity?: number; tunerA4?: number }) => {
    if (save.current) clearTimeout(save.current);
    save.current = setTimeout(() => void updatePreferences(patch).catch(() => undefined), 500);
  };
  const changeSensitivity = (v: number) => {
    const next = Math.max(0, Math.min(100, Math.round(v)));
    setSensitivity(next);
    persist({ tunerSensitivity: next, tunerA4: a4 });
  };
  const changeA4 = (v: number) => {
    const next = Math.max(A4_MIN, Math.min(A4_MAX, Math.round(v)));
    setA4(next);
    persist({ tunerSensitivity: sensitivity, tunerA4: next });
  };

  const stop = () => {
    cancelAnimationFrame(raf.current);
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    void ctx.current?.close();
    ctx.current = null;
    engine.current = null;
    setFrame(null);
    setPhase((p) => (p === "running" || p === "requesting" ? "idle" : p));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: stop only touches refs; run once on unmount
  useEffect(() => () => stop(), []);

  const start = async () => {
    if (!supported) {
      setPhase("unsupported");
      return;
    }
    setPhase("requesting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch {
      setPhase("denied");
      return;
    }
    const ac = new AudioContext();
    ctx.current = ac;
    // iOS starts a context suspended until it is resumed inside the tap that opened it.
    await ac.resume().catch(() => undefined);
    const src = ac.createMediaStreamSource(stream.current);
    const analyser = ac.createAnalyser();
    analyser.fftSize = TUNER_WINDOW;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    engine.current = new TunerEngine({ sensitivity, a4 });
    let last = 0;
    const loop = (now: number) => {
      if (now - last >= ANALYSE_EVERY_MS && engine.current) {
        last = now;
        analyser.getFloatTimeDomainData(buf);
        setFrame(engine.current.process(buf, ac.sampleRate, now));
      }
      raf.current = requestAnimationFrame(loop);
    };
    setPhase("running");
    raf.current = requestAnimationFrame(loop);
  };

  const notation = (preferences?.notation as Notation) ?? "english";
  const reading = frame?.reading ?? null;
  const noteLabel = reading ? spellPitchClass(parseNote(reading.note) ?? 0, { notation }) : "—";
  const inTune = reading ? Math.abs(reading.cents) <= 5 : false;
  const running = phase === "running";
  const zone: Zone = !frame
    ? "none"
    : frame.state === "clipping"
      ? "hot"
      : frame.levelDb >= frame.gateDb
        ? "good"
        : frame.levelDb > frame.noiseDb + 3
          ? "weak"
          : "none";
  const status =
    phase === "unsupported"
      ? t("tuner.unsupported")
      : phase === "denied"
        ? t("tuner.permission")
        : phase === "requesting"
          ? t("tuner.state.waiting")
          : phase === "idle"
            ? t("tuner.state.idle")
            : t(`tuner.state.${frame?.state ?? "listening"}`);
  const stateName =
    phase === "running" ? (frame?.state ?? "listening") : phase === "idle" ? "idle" : phase;

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="tuner"
      data-state={stateName}
      data-zone={zone}
    >
      <div className="flex flex-col items-center rounded-2xl bg-sunken px-3 py-4">
        <p
          className={cn(
            "text-sm",
            phase === "denied" || phase === "unsupported" || frame?.state === "clipping"
              ? "text-danger-500"
              : frame?.state === "weak"
                ? "text-warn-500"
                : "text-muted",
          )}
          role="status"
          data-testid="tuner-status"
        >
          {status}
        </p>
        <p
          className={cn(
            "mt-1 text-7xl font-semibold leading-none tabular-nums",
            inTune ? "text-ok-500" : "",
          )}
          data-testid="tuner-note"
        >
          {noteLabel}
          {reading ? <span className="text-2xl text-muted">{reading.octave}</span> : null}
        </p>
        {/* Deviation: the dot sits in the middle when the note is in tune. */}
        <div className="relative mt-4 h-4 w-full max-w-xs" aria-hidden="true">
          <span className="absolute inset-x-0 top-1.5 h-1 rounded-full bg-elev" />
          <span className="absolute left-1/2 top-0 h-4 w-0.5 -translate-x-1/2 bg-muted" />
          <span className="absolute left-[40%] top-1 h-2 w-px bg-muted/50" />
          <span className="absolute left-[60%] top-1 h-2 w-px bg-muted/50" />
          {reading ? (
            <span
              className={cn(
                "absolute top-0 size-4 -translate-x-1/2 rounded-full transition-[left] duration-100",
                inTune ? "bg-ok-500" : "bg-warn-500",
              )}
              style={{ left: `${50 + Math.max(-50, Math.min(50, reading.cents))}%` }}
            />
          ) : null}
        </div>
        <p className="mt-2 font-mono text-sm tabular-nums" data-testid="tuner-reading">
          {reading ? (
            <>
              <span data-testid="tuner-cents">
                {reading.cents > 0 ? "+" : ""}
                {reading.cents} {t("tuner.cents")}
              </span>
              <span className="text-muted">
                {" · "}
                <span data-testid="tuner-freq">{reading.freq.toFixed(1)}</span>{" "}
                {t("tuner.frequency")}
              </span>
            </>
          ) : (
            <span className="text-muted">{t("tuner.reference", { hz: a4 })}</span>
          )}
        </p>
        {reading ? <p className="text-xs text-muted">{t("tuner.reference", { hz: a4 })}</p> : null}
      </div>

      {/* Input level: tells apart "too quiet to analyse" from "not a clear note". */}
      <div data-testid="tuner-meter">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-muted">{t("tuner.input")}</span>
          <span
            className={cn(
              "font-medium",
              zone === "good" && "text-ok-500",
              zone === "weak" && "text-warn-500",
              zone === "hot" && "text-danger-500",
              zone === "none" && "text-muted",
            )}
            data-testid="tuner-zone"
          >
            {running ? t(`tuner.zone.${zone}`) : "—"}
          </span>
        </div>
        <div
          className="relative h-3 w-full overflow-hidden rounded-full bg-sunken"
          role="meter"
          aria-label={t("tuner.input")}
          aria-valuemin={-80}
          aria-valuemax={0}
          aria-valuenow={frame ? Math.round(frame.levelDb) : -80}
          aria-valuetext={running ? t(`tuner.zone.${zone}`) : undefined}
        >
          <span
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-[width] duration-75",
              zone === "hot" ? "bg-danger-500" : zone === "good" ? "bg-ok-500" : "bg-muted/60",
            )}
            style={{ width: `${(frame ? meterPosition(frame.levelDb) : 0) * 100}%` }}
          />
          {frame ? (
            <span
              className="absolute inset-y-0 w-0.5 bg-fg"
              title={t("tuner.gate")}
              style={{ left: `${meterPosition(frame.gateDb) * 100}%` }}
            />
          ) : null}
        </div>
        <p className="mt-1 min-h-4 text-xs text-muted">
          {running && frame?.noisyRoom
            ? t("tuner.noisyRoom")
            : running && zone === "weak"
              ? t("tuner.weakHint")
              : running
                ? t("tuner.gateHint")
                : ""}
        </p>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{t("tuner.sensitivity")}</span>
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            aria-label={t("tuner.settings")}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm text-muted hover:bg-sunken"
          >
            <SlidersHorizontal className="size-4" /> {t("tuner.settingsShort")}
          </button>
        </div>
        <Segmented<SensitivityPreset>
          block
          ariaLabel={t("tuner.sensitivity")}
          value={presetOf(sensitivity)}
          onChange={(p) => changeSensitivity(SENSITIVITY_PRESETS[p])}
          options={(["low", "normal", "high"] as const).map((p) => ({
            value: p,
            label: t(`tuner.preset.${p}`),
          }))}
        />
        {settingsOpen ? (
          <div
            className="mt-3 flex flex-col gap-3 rounded-xl border border-line p-3"
            data-testid="tuner-settings"
          >
            <label className="flex flex-col gap-1 text-sm">
              <span className="flex items-center justify-between">
                {t("tuner.fine")}
                <span
                  className="font-mono tabular-nums text-muted"
                  data-testid="tuner-sensitivity-value"
                >
                  {sensitivity}
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={sensitivity}
                onChange={(e) => changeSensitivity(Number(e.target.value))}
                aria-label={t("tuner.fine")}
                className="h-11 w-full accent-accent-500"
              />
            </label>
            <p className="text-xs text-muted">{t("tuner.sensitivityHelp")}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">{t("tuner.a4")}</span>
              <span className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="md"
                  aria-label={t("tuner.a4Down")}
                  onClick={() => changeA4(a4 - 1)}
                  icon={<Minus className="size-4" />}
                />
                <span className="w-20 text-center font-mono tabular-nums" data-testid="tuner-a4">
                  {a4} Hz
                </span>
                <Button
                  variant="secondary"
                  size="md"
                  aria-label={t("tuner.a4Up")}
                  onClick={() => changeA4(a4 + 1)}
                  icon={<Plus className="size-4" />}
                />
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <Button
        size="lg"
        block
        variant={running ? "danger" : "primary"}
        onClick={running ? stop : start}
        loading={phase === "requesting"}
        icon={running ? <MicOff className="size-5" /> : <Mic className="size-5" />}
      >
        {running ? t("tuner.stop") : t("tuner.start")}
      </Button>
    </div>
  );
}

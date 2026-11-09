import {
  COMMON_TIME_SIGNATURES,
  initialMetronome,
  LIMITS,
  type MetronomeState,
  startAnchor,
} from "@bandsync/shared";
import { Minus, Play, Plus, Square } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Segmented, Select, useToast } from "../../components/ui";
import { audioEngine, type ClickSound } from "../../lib/audio/AudioEngine";
import { useAuth } from "../auth/AuthProvider";
import { BeatIndicator } from "../rehearsal/BeatIndicator";
import { useAudioStatus, useMetronome } from "../rehearsal/useMetronome";

/** Stand-alone metronome: the same scheduler as the live room, with a local timeline (offset 0). */
export function MetronomeTool() {
  const { t } = useTranslation(["tools", "rehearsal", "common"]);
  const { preferences } = useAuth();
  const { toast } = useToast();
  const [m, setM] = useState<MetronomeState>(() => ({ ...initialMetronome(), countInBars: 0 }));
  const [sound, setSound] = useState<ClickSound>((preferences?.clickSound as ClickSound) ?? "beep");
  const [volume, setVolume] = useState(preferences?.clickVolume ?? 0.8);
  const audioStatus = useAudioStatus();
  const getOffsetMs = useCallback(() => 0, []);
  const { beat } = useMetronome(m, {
    audible: audioStatus === "ready",
    getOffsetMs,
    volume,
    sound,
  });

  const setBpm = (bpm: number) => {
    const clamped = Math.max(LIMITS.bpmMin, Math.min(LIMITS.bpmMax, Math.round(bpm)));
    setM((s) => {
      if (!s.running || !s.anchor) return { ...s, bpm: clamped };
      // Local tempo change: re-anchor at the next bar like the server does.
      const beatMs = 60000 / s.anchor.bpm;
      const fractional = s.anchor.beatIndex + (Date.now() + 300 - s.anchor.serverMs) / beatMs;
      const boundary = Math.max(0, Math.ceil(fractional / s.beatsPerBar) * s.beatsPerBar);
      const serverMs = s.anchor.serverMs + (boundary - s.anchor.beatIndex) * beatMs;
      return { ...s, bpm: clamped, anchor: { serverMs, beatIndex: boundary, bpm: clamped } };
    });
  };

  const toggle = async () => {
    if (m.running) {
      setM((s) => ({ ...s, running: false, anchor: null }));
      return;
    }
    const ok = await audioEngine.unlock();
    if (!ok) toast(t("rehearsal:audio.blocked"), "error");
    const startAt = Date.now() + 150;
    setM((s) => ({
      ...s,
      running: true,
      startedAtServerMs: startAt,
      anchor: startAnchor(startAt, s.bpm, {
        beatsPerBar: s.beatsPerBar,
        countInBars: s.countInBars,
        subdivision: s.subdivision,
      }),
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      <BeatIndicator beat={beat} beatsPerBar={m.beatsPerBar} running={m.running} />
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="lg"
          aria-label="-1 BPM"
          onClick={() => setBpm(m.bpm - 1)}
          icon={<Minus className="size-5" />}
        />
        <input
          type="number"
          inputMode="numeric"
          aria-label={t("common:music.bpm")}
          className="h-14 flex-1 rounded-xl border border-line bg-elev text-center text-3xl font-semibold tabular-nums outline-none"
          value={Math.round(m.bpm)}
          min={LIMITS.bpmMin}
          max={LIMITS.bpmMax}
          onChange={(e) => setBpm(Number(e.target.value) || m.bpm)}
        />
        <Button
          variant="secondary"
          size="lg"
          aria-label="+1 BPM"
          onClick={() => setBpm(m.bpm + 1)}
          icon={<Plus className="size-5" />}
        />
      </div>
      <input
        type="range"
        min={LIMITS.bpmMin}
        max={LIMITS.bpmMax}
        value={m.bpm}
        onChange={(e) => setBpm(Number(e.target.value))}
        className="w-full accent-accent-500"
        aria-label={t("common:music.bpm")}
      />
      <div className="grid grid-cols-2 gap-3">
        <Select
          label={t("common:music.timeSignature")}
          value={`${m.beatsPerBar}/${m.beatUnit}`}
          onChange={(e) => {
            const [a, b] = e.target.value.split("/").map(Number);
            setM((s) => ({ ...s, beatsPerBar: a!, beatUnit: b!, running: false, anchor: null }));
          }}
        >
          {COMMON_TIME_SIGNATURES.map((ts) => (
            <option
              key={`${ts.beatsPerBar}/${ts.beatUnit}`}
              value={`${ts.beatsPerBar}/${ts.beatUnit}`}
            >
              {ts.beatsPerBar}/{ts.beatUnit}
            </option>
          ))}
        </Select>
        <Select
          label={t("tools:metronome.sound")}
          value={sound}
          onChange={(e) => setSound(e.target.value as ClickSound)}
        >
          {(["beep", "wood", "tick"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`tools:metronome.sounds.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">{t("rehearsal:controls.subdivision")}</p>
        <Segmented
          ariaLabel={t("rehearsal:controls.subdivision")}
          value={String(m.subdivision)}
          onChange={(v) => setM((s) => ({ ...s, subdivision: Number(v) as 1 | 2 | 3 | 4 }))}
          options={([1, 2, 3, 4] as const).map((n) => ({
            value: String(n),
            label: t(`rehearsal:controls.subdivisions.${n}`),
          }))}
        />
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">{t("rehearsal:controls.countIn")}</p>
        <Segmented
          ariaLabel={t("rehearsal:controls.countIn")}
          value={String(m.countInBars)}
          onChange={(v) => setM((s) => ({ ...s, countInBars: Number(v) }))}
          options={[0, 1, 2].map((n) => ({
            value: String(n),
            label: t("rehearsal:controls.countInBars", { count: n }),
          }))}
        />
      </div>
      <label className="flex items-center gap-3 text-sm">
        <span className="w-20 text-muted">{t("tools:metronome.volume")}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="flex-1 accent-accent-500"
        />
      </label>
      <Button
        size="xl"
        variant={m.running ? "danger" : "primary"}
        onClick={toggle}
        icon={
          m.running ? (
            <Square className="size-7 fill-current" />
          ) : (
            <Play className="size-7 fill-current" />
          )
        }
      >
        {m.running ? t("tools:metronome.stop") : t("tools:metronome.start")}
      </Button>
    </div>
  );
}

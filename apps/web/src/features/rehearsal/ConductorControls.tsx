import {
  type ClientMessage,
  COMMON_TIME_SIGNATURES,
  LIMITS,
  type RepertoireDto,
  type SessionState,
  type SongDto,
} from "@bandsync/shared";
import { ChevronLeft, ChevronRight, ListMusic, Minus, Play, Plus, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Dialog, Segmented, Select } from "../../components/ui";
import { cn } from "../../lib/cn";

export type ConductorPart = "transport" | "tempo" | "admin";

interface Props {
  state: SessionState;
  songs: SongDto[];
  repertoires: RepertoireDto[];
  send: (msg: ClientMessage) => boolean;
  onEnd: () => void;
  /** Which rows to show (all by default); the phone's bottom sheet shows them in stages. */
  parts?: ConductorPart[];
  /** Smaller controls, for the phone's bottom sheet. */
  compact?: boolean;
}

const ALL_PARTS: ConductorPart[] = ["transport", "tempo", "admin"];

export function ConductorControls({
  state,
  songs,
  repertoires,
  send,
  onEnd,
  parts = ALL_PARTS,
  compact = false,
}: Props) {
  const { t } = useTranslation(["rehearsal", "common"]);
  const m = state.metronome;
  const [songPicker, setSongPicker] = useState(false);
  const [settings, setSettings] = useState(false);
  const [bpmDraft, setBpmDraft] = useState(m.bpm);
  const bpmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setBpmDraft(m.bpm), [m.bpm]);

  const setBpm = (next: number) => {
    const clamped = Math.max(LIMITS.bpmMin, Math.min(LIMITS.bpmMax, Math.round(next)));
    setBpmDraft(clamped);
    if (bpmTimer.current) clearTimeout(bpmTimer.current);
    bpmTimer.current = setTimeout(() => send({ type: "set_tempo", bpm: clamped }), 250);
  };

  const taps = useRef<number[]>([]);
  const tap = () => {
    const now = performance.now();
    taps.current = taps.current.filter((t0) => now - t0 < 3000);
    taps.current.push(now);
    if (taps.current.length >= 3) {
      const intervals = taps.current.slice(1).map((v, i) => v - taps.current[i]!);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      setBpm(60000 / avg);
    }
  };

  const orderedSongs: SongDto[] =
    state.repertoireSongIds.length > 0
      ? (state.repertoireSongIds
          .map((id) => songs.find((s) => s.id === id))
          .filter(Boolean) as SongDto[])
      : songs;
  const idx = state.currentSong ? state.repertoireSongIds.indexOf(state.currentSong.songId) : -1;
  const hasPrev = idx > 0;
  const hasNext =
    idx !== -1 ? idx < state.repertoireSongIds.length - 1 : state.repertoireSongIds.length > 0;

  return (
    <div className={cn("flex flex-col", compact ? "gap-2" : "gap-3")}>
      {/* Transport row: the most important controls, oversized for stage use. */}
      <div
        className={cn(
          "grid grid-cols-[1fr_2fr_1fr] gap-2",
          !parts.includes("transport") && "hidden",
        )}
      >
        <Button
          size="lg"
          variant="secondary"
          disabled={!hasPrev}
          onClick={() => send({ type: "prev_song" })}
          aria-label={t("rehearsal:controls.prev")}
          icon={<ChevronLeft className="size-6" />}
        />
        {m.running ? (
          <Button
            size={compact ? "lg" : "xl"}
            variant="danger"
            onClick={() => send({ type: "stop" })}
            icon={<Square className={cn("fill-current", compact ? "size-5" : "size-7")} />}
          >
            {t("rehearsal:controls.stop")}
          </Button>
        ) : (
          <Button
            size={compact ? "lg" : "xl"}
            onClick={() => send({ type: "start" })}
            icon={<Play className={cn("fill-current", compact ? "size-5" : "size-7")} />}
          >
            {t("rehearsal:controls.start")}
          </Button>
        )}
        <Button
          size="lg"
          variant="secondary"
          disabled={!hasNext}
          onClick={() => send({ type: "next_song" })}
          aria-label={t("rehearsal:controls.next")}
          icon={<ChevronRight className="size-6" />}
        />
      </div>
      {/* Tempo row */}
      <div className={cn("flex items-center gap-2", !parts.includes("tempo") && "hidden")}>
        <Button
          variant="secondary"
          size="lg"
          aria-label="-1 BPM"
          onClick={() => setBpm(bpmDraft - 1)}
          icon={<Minus className="size-5" />}
        />
        <div className="flex flex-1 flex-col items-center rounded-xl border border-line bg-elev py-1">
          <input
            type="number"
            inputMode="numeric"
            aria-label={t("rehearsal:controls.bpm")}
            className={cn(
              "w-28 bg-transparent text-center font-semibold tabular-nums outline-none",
              compact ? "text-2xl" : "text-3xl",
            )}
            value={bpmDraft}
            min={LIMITS.bpmMin}
            max={LIMITS.bpmMax}
            onChange={(e) => setBpm(Number(e.target.value) || bpmDraft)}
          />
          <span className="text-[11px] uppercase tracking-wide text-muted">
            {t("rehearsal:controls.bpm")} · {m.beatsPerBar}/{m.beatUnit}
          </span>
        </div>
        <Button
          variant="secondary"
          size="lg"
          aria-label="+1 BPM"
          onClick={() => setBpm(bpmDraft + 1)}
          icon={<Plus className="size-5" />}
        />
        <Button variant="secondary" size="lg" onClick={tap}>
          {t("rehearsal:controls.tap")}
        </Button>
      </div>
      {m.running && parts.includes("tempo") ? (
        <p className="text-center text-xs text-muted">{t("rehearsal:controls.tempoChangeNote")}</p>
      ) : null}
      <div className={cn("grid grid-cols-2 gap-2", !parts.includes("admin") && "hidden")}>
        <Button
          variant="secondary"
          size="lg"
          icon={<ListMusic className="size-5" />}
          onClick={() => setSongPicker(true)}
        >
          {t("rehearsal:controls.selectSong")}
        </Button>
        <Button variant="secondary" size="lg" onClick={() => setSettings(true)}>
          {t("rehearsal:controls.title")}
        </Button>
      </div>

      <Dialog
        open={songPicker}
        onClose={() => setSongPicker(false)}
        title={t("rehearsal:controls.selectSong")}
      >
        <div className="mb-3">
          <Select
            label={t("rehearsal:controls.selectRepertoire")}
            value={state.repertoireId ?? ""}
            onChange={(e) => send({ type: "set_repertoire", repertoireId: e.target.value || null })}
          >
            <option value="">{t("rehearsal:controls.freeSongs")}</option>
            {repertoires.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <ul className="max-h-[55vh] divide-y divide-line overflow-y-auto">
          {orderedSongs.map((s, i) => {
            const active = state.currentSong?.songId === s.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 py-3 text-left",
                    active && "text-accent-500",
                  )}
                  onClick={() => {
                    send({ type: "set_song", songId: s.id });
                    setSongPicker(false);
                  }}
                >
                  <span className="w-6 text-center font-mono text-sm text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.title}</span>
                    <span className="block truncate text-sm text-muted">{s.artist ?? "—"}</span>
                  </span>
                  <span className="text-sm text-muted">
                    {s.version.bpm ? `${s.version.bpm} · ` : ""}
                    {s.version.beatsPerBar}/{s.version.beatUnit}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Dialog>

      <Dialog
        open={settings}
        onClose={() => setSettings(false)}
        title={t("rehearsal:controls.title")}
      >
        <div className="flex flex-col gap-5">
          <Select
            label={t("rehearsal:controls.timeSignature")}
            value={`${m.beatsPerBar}/${m.beatUnit}`}
            onChange={(e) => {
              const [a, b] = e.target.value.split("/").map(Number);
              send({ type: "set_time_signature", beatsPerBar: a!, beatUnit: b! });
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
          <div>
            <p className="mb-1.5 text-sm font-medium">{t("rehearsal:controls.countIn")}</p>
            <Segmented
              ariaLabel={t("rehearsal:controls.countIn")}
              value={String(m.countInBars)}
              onChange={(v) => send({ type: "set_count_in", bars: Number(v) })}
              options={[0, 1, 2].map((n) => ({
                value: String(n),
                label: t("rehearsal:controls.countInBars", { count: n }),
              }))}
            />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">{t("rehearsal:controls.subdivision")}</p>
            <Segmented
              ariaLabel={t("rehearsal:controls.subdivision")}
              value={String(m.subdivision)}
              onChange={(v) =>
                send({ type: "set_subdivision", subdivision: Number(v) as 1 | 2 | 3 | 4 })
              }
              options={([1, 2, 3, 4] as const).map((n) => ({
                value: String(n),
                label: t(`rehearsal:controls.subdivisions.${n}`),
              }))}
            />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">{t("rehearsal:controls.clickMode")}</p>
            <Segmented
              ariaLabel={t("rehearsal:controls.clickMode")}
              value={m.clickMode}
              onChange={(v) => send({ type: "set_click_mode", mode: v })}
              options={(["synced", "central"] as const).map((v) => ({
                value: v,
                label: t(`rehearsal:controls.clickModes.${v}`),
              }))}
            />
            <p className="mt-1.5 text-xs text-muted">
              {t(`rehearsal:controls.clickModeHelp.${m.clickMode}`)}
            </p>
            {m.clickMode === "central" ? (
              <Select
                className="mt-3"
                label={t("rehearsal:controls.centralDevice")}
                value={m.centralUserId ?? ""}
                onChange={(e) =>
                  send({
                    type: "set_click_mode",
                    mode: "central",
                    centralUserId: e.target.value || null,
                  })
                }
              >
                {state.participants
                  .filter((p) => p.connected)
                  .map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.displayName}
                    </option>
                  ))}
              </Select>
            ) : null}
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">{t("rehearsal:controls.transfer")}</p>
            <div className="flex flex-wrap gap-2">
              {state.participants
                .filter((p) => p.connected && p.canControl && p.userId !== state.conductorUserId)
                .map((p) => (
                  <Button
                    key={p.userId}
                    variant="secondary"
                    size="sm"
                    onClick={() => send({ type: "transfer_conductor", userId: p.userId })}
                  >
                    {t("rehearsal:controls.transferTo", { name: p.displayName })}
                  </Button>
                ))}
            </div>
          </div>
          <Button variant="danger" onClick={onEnd}>
            {t("rehearsal:controls.end")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

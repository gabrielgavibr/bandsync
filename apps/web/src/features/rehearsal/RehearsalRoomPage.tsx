import { deriveStatus, type Notation, type SongMaterialDto } from "@bandsync/shared";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Headphones,
  LogOut,
  Users,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { Avatar } from "../../app/AppShell";
import { Badge, Button, ConfirmDialog, Dialog, LoadingBlock, useToast } from "../../components/ui";
import { http } from "../../lib/api";
import type { ClickSound } from "../../lib/audio/AudioEngine";
import { audioEngine } from "../../lib/audio/AudioEngine";
import { cn } from "../../lib/cn";
import { resolvePreferredMaterial } from "../../lib/materials";
import { useAuth } from "../auth/AuthProvider";
import { ReferenceListen, ReferenceSummaryView } from "../autoarrange/reference";
import { useBand } from "../bands/queries";
import { MaterialViewer } from "../repertoire/MaterialViewer";
import { useRepertoires, useSong, useSongs } from "../repertoire/queries";
import { BeatIndicator } from "./BeatIndicator";
import { ConductorControls } from "./ConductorControls";
import { qualityTone, SyncDiagnostics } from "./SyncDiagnostics";
import { useAudioStatus, useMetronome } from "./useMetronome";
import { useRehearsalSession } from "./useRehearsalSession";

const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export function RehearsalRoomPage() {
  const { bandId = "", sessionId = "" } = useParams();
  const { t } = useTranslation(["rehearsal", "common"]);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, preferences } = useAuth();
  const band = useBand(bandId);
  const { snap, send, resync, getOffsetMs } = useRehearsalSession(bandId, sessionId);
  const state = snap?.state ?? null;
  const me = state?.participants.find((p) => p.userId === snap?.youUserId) ?? null;
  const isConductor = !!state && !!me && state.conductorUserId === me.userId;
  const conductor = state?.participants.find((p) => p.userId === state.conductorUserId) ?? null;

  const songQ = useSong(bandId, state?.currentSong?.songId);
  const songs = useSongs(bandId);
  const repertoires = useRepertoires(bandId);

  const audioStatus = useAudioStatus();
  const [audioPromptDismissed, setAudioPromptDismissed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [localVolume, setLocalVolume] = useState(preferences?.clickVolume ?? 0.8);

  const currentSongId = state?.currentSong?.songId ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per-song view state when the song changes
  useEffect(() => {
    setSelectedMaterialId(null);
    setTargetKey(null);
  }, [currentSongId]);

  // Poll the session row while the socket cannot connect, so an ended session is detected.
  const sessionPoll = useQuery({
    queryKey: ["rehearsal-poll", bandId, sessionId],
    enabled: snap?.connection === "reconnecting",
    refetchInterval: 5000,
    queryFn: () =>
      http.get<{ session: { status: string } }>(`/api/bands/${bandId}/rehearsals/${sessionId}`),
  });

  const materials = songQ.data?.materials ?? [];
  const preferred = useMemo(
    () =>
      resolvePreferredMaterial(
        materials,
        me?.instrument ?? user?.primaryInstrument ?? null,
        preferences?.materialPreferences,
      ),
    [materials, me?.instrument, user?.primaryInstrument, preferences?.materialPreferences],
  );
  const material: SongMaterialDto | null =
    materials.find((m) => m.id === selectedMaterialId) ?? preferred;

  const audible =
    !!me?.audioEnabled &&
    audioStatus === "ready" &&
    (state?.metronome.clickMode !== "central" || state.metronome.centralUserId === me?.userId);
  const { beat } = useMetronome(state?.metronome ?? null, {
    audible,
    getOffsetMs,
    volume: localVolume,
    sound: (preferences?.clickSound as ClickSound) ?? "beep",
  });

  const lastError = snap?.lastError ?? null;
  useEffect(() => {
    if (!lastError) return;
    const code = lastError.code;
    if (code !== "already_running" && code !== "not_running") {
      toast(t(`rehearsal:room.error.${code}`, { defaultValue: code }), "error");
    }
  }, [lastError, toast, t]);

  // The server commits status only on events; between events (e.g. when the count-in ends) the
  // musical status is derived locally from the shared timeline and our clock estimate.
  const [, forceTick] = useState(0);
  const running = !!state?.metronome.running;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => forceTick((x) => x + 1), 250);
    return () => clearInterval(id);
  }, [running]);
  const liveStatus = state ? deriveStatus(state, Date.now() + getOffsetMs()) : "created";

  const ended =
    snap?.connection === "ended" ||
    state?.status === "ended" ||
    sessionPoll.data?.session.status === "ended";

  if (!snap || (!state && snap.connection !== "rejected" && !ended))
    return <LoadingBlock className="min-h-screen" />;

  if (ended) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-3xl font-semibold">{t("rehearsal:room.endedTitle")}</h1>
        <p className="text-muted">{t("rehearsal:room.endedBody")}</p>
        <Link to={`/bands/${bandId}`}>
          <Button size="lg">{t("rehearsal:room.backToBand")}</Button>
        </Link>
      </main>
    );
  }
  if (snap.connection === "rejected" || !state) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-muted">{t("common:errors.forbidden")}</p>
        <Link to={`/bands/${bandId}`}>
          <Button size="lg">{t("rehearsal:room.backToBand")}</Button>
        </Link>
      </main>
    );
  }

  const m = state.metronome;
  const connectedCount = state.participants.filter((p) => p.connected).length;
  const needsAudioGate =
    !!me?.audioEnabled &&
    audioStatus !== "ready" &&
    audioStatus !== "unsupported" &&
    !audioPromptDismissed;
  const connectionBad = snap.connection === "reconnecting" || snap.connection === "connecting";
  const conductorOffline = !!conductor && !conductor.connected;
  const canClaim = !!me?.canControl && !isConductor && (!conductor || conductorOffline);
  const repertoireTotal = state.repertoireSongIds.length;
  const repertoireIndex = state.currentSong?.repertoireIndex;
  // The reference is read from the song, like on every other screen. Each device opens or plays
  // it through the platform itself: the session synchronises tempo and devices, never the audio.
  const reference =
    state.currentSong && songQ.data?.song.id === state.currentSong.songId
      ? songQ.data.song.reference
      : null;

  return (
    <div className="flex h-dvh flex-col bg-surface">
      {/* Top bar */}
      <header className="flex items-center gap-2 border-b border-line px-3 py-2 safe-top">
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("rehearsal:room.leave")}
          onClick={() => setConfirmLeave(true)}
          icon={<LogOut className="size-5 rotate-180" />}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold leading-tight">
            {state.currentSong ? state.currentSong.title : band.data?.name}
          </p>
          <p className="truncate text-xs text-muted">
            {state.currentSong
              ? [
                  state.currentSong.artist,
                  repertoireIndex !== null && repertoireIndex !== undefined
                    ? t("rehearsal:room.songOf", {
                        index: repertoireIndex + 1,
                        total: repertoireTotal,
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("rehearsal:room.noSong")}
          </p>
        </div>
        <Badge tone={m.running ? "accent" : "neutral"}>{t(`rehearsal:status.${liveStatus}`)}</Badge>
        {reference ? (
          <button
            type="button"
            onClick={() => setShowReference(true)}
            aria-label={t("rehearsal:room.reference")}
            data-testid="room-reference"
            className="rounded-lg p-1.5 hover:bg-elev"
          >
            <Headphones className="size-5 text-accent-500" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setShowSync(true)}
          aria-label={t("rehearsal:sync.title")}
          className="rounded-lg p-1.5 hover:bg-elev"
        >
          <Activity
            className={cn(
              "size-5",
              connectionBad
                ? "text-danger-500"
                : snap.clock.quality === "good"
                  ? "text-ok-500"
                  : snap.clock.quality === "fair"
                    ? "text-warn-500"
                    : "text-muted",
            )}
          />
        </button>
        <button
          type="button"
          onClick={() => setShowParticipants(true)}
          className="flex items-center gap-1 rounded-lg p-1.5 text-sm hover:bg-elev"
          aria-label={t("rehearsal:room.participants")}
        >
          <Users className="size-5" />
          <span className="tabular-nums">{connectedCount}</span>
        </button>
      </header>

      {connectionBad ? (
        <div className="bg-warn-500/15 px-4 py-1.5 text-center text-sm text-warn-500" role="status">
          {t("rehearsal:room.connectionLost")}
        </div>
      ) : null}
      {conductorOffline && !connectionBad ? (
        <div
          className="flex flex-wrap items-center justify-center gap-2 bg-warn-500/15 px-4 py-1.5 text-center text-sm text-warn-500"
          role="status"
        >
          {t("rehearsal:room.conductorOffline")}
          {canClaim ? (
            <Button size="sm" variant="secondary" onClick={() => send({ type: "claim_conductor" })}>
              {t("rehearsal:room.takeOver")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {!conductor && canClaim && !connectionBad ? (
        <div className="flex items-center justify-center gap-2 bg-accent-500/10 px-4 py-1.5 text-sm">
          <Button size="sm" onClick={() => send({ type: "claim_conductor" })}>
            {t("rehearsal:controls.claim")}
          </Button>
        </div>
      ) : null}

      {/* Beat + musical info */}
      <section className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-3xl font-semibold tabular-nums",
              state.currentSong?.bpmSource === "none" && "text-muted",
            )}
          >
            {Math.round(m.bpm)}
          </span>
          <span className="text-xs uppercase text-muted">{t("common:music.bpm")}</span>
          <span className="ml-2 text-xl font-medium tabular-nums">
            {m.beatsPerBar}/{m.beatUnit}
          </span>
          {state.currentSong?.key ? <Badge className="ml-2">{state.currentSong.key}</Badge> : null}
        </div>
        <BeatIndicator beat={beat} beatsPerBar={m.beatsPerBar} running={m.running} compact />
      </section>
      {state.currentSong &&
      (state.currentSong.bpmSource !== "band" || !state.currentSong.meterConfirmed) ? (
        <p
          className="border-b border-line bg-warn-500/10 px-4 py-1.5 text-xs text-warn-500"
          role="status"
          data-testid="tempo-source"
        >
          {state.currentSong.bpmSource !== "band"
            ? t(`rehearsal:room.bpmSource.${state.currentSong.bpmSource}`)
            : null}
          {state.currentSong.bpmSource !== "band" && !state.currentSong.meterConfirmed
            ? " · "
            : null}
          {!state.currentSong.meterConfirmed ? t("rehearsal:room.meterUnconfirmed") : null}
        </p>
      ) : null}

      {/* Material */}
      <main className="relative flex-1 overflow-y-auto">
        {!state.currentSong ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted">
            <p className="text-lg font-medium text-fg">{t("rehearsal:room.noSong")}</p>
            <p className="mt-1">
              {isConductor ? t("rehearsal:room.noSongConductor") : t("rehearsal:room.noSongBody")}
            </p>
          </div>
        ) : songQ.isPending ? (
          <LoadingBlock />
        ) : (
          <>
            <div className="sticky top-0 z-10 flex items-center gap-2 overflow-x-auto border-b border-line bg-surface/95 px-3 py-2 backdrop-blur">
              {materials.map((mat) => (
                <button
                  type="button"
                  key={mat.id}
                  onClick={() => setSelectedMaterialId(mat.id)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-sm",
                    material?.id === mat.id
                      ? "border-accent-500 bg-accent-500/10 text-fg"
                      : "border-line text-muted",
                  )}
                >
                  {t(`common:materialType.${mat.type}`)}
                  {mat.instrument ? ` · ${t(`common:instrument.${mat.instrument}`)}` : ""}
                  {mat.status === "pending" ? ` · ${t("rehearsal:member.pendingChip")}` : ""}
                </button>
              ))}
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {material?.type === "chords" && material.key ? (
                  <select
                    aria-label={t("rehearsal:member.transposeTo")}
                    className="h-8 rounded-lg border border-line bg-elev px-2 text-sm"
                    value={targetKey ?? ""}
                    onChange={(e) => setTargetKey(e.target.value || null)}
                  >
                    <option value="">{t("rehearsal:member.originalKey")}</option>
                    {KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("rehearsal:member.zoomOut")}
                  onClick={() => setZoom((z) => Math.max(0.7, z - 0.1))}
                  icon={<ZoomOut className="size-4" />}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("rehearsal:member.zoomIn")}
                  onClick={() => setZoom((z) => Math.min(2.2, z + 0.1))}
                  icon={<ZoomIn className="size-4" />}
                />
              </span>
            </div>
            {material ? (
              <MaterialViewer
                material={material}
                options={{
                  zoom,
                  notation: (preferences?.notation as Notation) ?? "english",
                  targetKey,
                }}
              />
            ) : (
              <div className="p-8 text-center text-muted">
                <p className="font-medium text-fg">{t("rehearsal:member.noMaterial")}</p>
                <p className="mt-1 text-sm">{t("rehearsal:member.noMaterialHint")}</p>
              </div>
            )}
            {songQ.data && songQ.data.song.sections.length > 0 ? (
              <div className="border-t border-line p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-muted">
                  {t("rehearsal:member.sections")}
                </p>
                <ol className="flex flex-wrap gap-1.5">
                  {songQ.data.song.sections.map((s) => (
                    <li key={s.id} className="rounded-lg bg-sunken px-2.5 py-1 text-sm">
                      <span className="font-medium">{s.name}</span>{" "}
                      <span className="text-muted">{s.bars}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </>
        )}

        {needsAudioGate ? (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-surface/90 p-6 text-center backdrop-blur-sm">
            <p className="max-w-sm text-muted">
              {audioStatus === "suspended"
                ? t("rehearsal:audio.suspended")
                : t("rehearsal:audio.enableBody")}
            </p>
            <Button
              size="xl"
              icon={<Volume2 className="size-7" />}
              onClick={async () => {
                const ok = await audioEngine.unlock();
                if (!ok) toast(t("rehearsal:audio.blocked"), "error");
              }}
            >
              {t("rehearsal:audio.enable")}
            </Button>
            <Button variant="ghost" onClick={() => setAudioPromptDismissed(true)}>
              {t("rehearsal:member.clickOff")}
            </Button>
          </div>
        ) : null}
      </main>

      {/* Bottom panel */}
      <footer className="border-t border-line bg-elev px-3 pt-3 safe-bottom">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Button
            variant={me?.audioEnabled ? "secondary" : "outline"}
            size="lg"
            onClick={() => send({ type: "set_audio", enabled: !me?.audioEnabled })}
            icon={
              me?.audioEnabled ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />
            }
            aria-pressed={!!me?.audioEnabled}
          >
            {me?.audioEnabled ? t("rehearsal:member.clickOn") : t("rehearsal:member.clickOff")}
          </Button>
          <label className="order-last flex min-w-40 basis-full items-center gap-2 text-sm text-muted sm:order-none sm:basis-auto sm:flex-1">
            <span className="sr-only">{t("rehearsal:member.volume")}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={localVolume}
              onChange={(e) => setLocalVolume(Number(e.target.value))}
              className="w-full accent-accent-500"
              aria-label={t("rehearsal:member.volume")}
            />
          </label>
          {m.clickMode === "central" ? (
            <Badge tone="warn">{t("rehearsal:controls.clickModes.central")}</Badge>
          ) : null}
          {!isConductor ? (
            <Button
              variant={me?.ready ? "primary" : "outline"}
              size="lg"
              onClick={() => send({ type: "set_ready", ready: !me?.ready })}
              aria-pressed={!!me?.ready}
            >
              {me?.ready ? t("rehearsal:member.ready") : t("rehearsal:member.notReady")}
            </Button>
          ) : null}
        </div>
        {isConductor ? (
          <ConductorControls
            state={state}
            songs={songs.data ?? []}
            repertoires={repertoires.data ?? []}
            send={send}
            onEnd={() => setConfirmEnd(true)}
          />
        ) : (
          <p className="pb-2 text-center text-sm text-muted">
            {t("rehearsal:room.conductor")}:{" "}
            <span className="font-medium text-fg">
              {conductor?.displayName ?? t("rehearsal:room.noConductor")}
            </span>
          </p>
        )}
      </footer>

      <Dialog
        open={showParticipants}
        onClose={() => setShowParticipants(false)}
        title={t("rehearsal:room.participants")}
      >
        <ul className="divide-y divide-line">
          {state.participants.map((p) => (
            <li key={p.userId} className="flex items-center gap-3 py-2">
              <Avatar name={p.displayName} url={p.avatarUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {p.displayName}
                  {p.userId === me?.userId ? (
                    <span className="text-xs text-muted"> ({t("rehearsal:room.you")})</span>
                  ) : null}
                </p>
                <p className="text-xs text-muted">
                  {p.instrument
                    ? t(`common:instrument.${p.instrument}`)
                    : t("common:instrument.none")}
                </p>
              </div>
              {p.userId === state.conductorUserId ? (
                <Badge tone="accent">{t("rehearsal:room.conductor")}</Badge>
              ) : null}
              {!p.audioEnabled ? <Badge>{t("rehearsal:room.muted")}</Badge> : null}
              {p.ready ? <Badge tone="ok">{t("rehearsal:member.ready")}</Badge> : null}
              <span
                className={cn(
                  "size-2.5 rounded-full",
                  p.connected ? "bg-ok-500" : "bg-sunken border border-line",
                )}
                title={p.connected ? t("rehearsal:room.connected") : t("rehearsal:room.offline")}
              />
            </li>
          ))}
        </ul>
      </Dialog>

      <Dialog
        open={showReference && !!reference}
        onClose={() => setShowReference(false)}
        title={t("rehearsal:room.reference")}
      >
        {reference ? (
          <div className="flex flex-col gap-3" data-testid="room-reference-panel">
            <ReferenceSummaryView reference={reference} size="sm" />
            {reference.url ? (
              <ReferenceListen reference={reference} />
            ) : (
              <p className="text-sm text-warn-500">{t("rehearsal:room.referenceNoLink")}</p>
            )}
            <p className="text-xs text-muted">{t("rehearsal:room.referenceLocal")}</p>
          </div>
        ) : null}
      </Dialog>

      <Dialog open={showSync} onClose={() => setShowSync(false)} title={t("rehearsal:sync.title")}>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <Badge tone={connectionBad ? "danger" : "ok"}>
            {connectionBad ? t("common:state.reconnecting") : t("common:state.connected")}
          </Badge>
          <Badge tone={qualityTone(snap.clock.quality)}>
            {t(`rehearsal:sync.quality.${snap.clock.quality}`)}
          </Badge>
          <span className="text-muted">seq {state.seq}</span>
        </div>
        <SyncDiagnostics clock={snap.clock} onResync={resync} />
        {audioStatus === "ready" && audioEngine.outputLatency() > 0.08 ? (
          <p className="mt-3 text-xs text-warn-500">{t("rehearsal:audio.bluetoothWarning")}</p>
        ) : null}
        {audioStatus === "suspended" ? (
          <p className="mt-3 text-xs text-danger-500">{t("rehearsal:audio.unreliable")}</p>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title={t("rehearsal:room.leave")}
        body={t("rehearsal:room.leaveConfirm")}
        onConfirm={() => navigate(`/bands/${bandId}`)}
      />
      <ConfirmDialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title={t("rehearsal:controls.end")}
        body={t("rehearsal:controls.endConfirm")}
        danger
        onConfirm={() => {
          send({ type: "end_session" });
          setConfirmEnd(false);
        }}
      />
      <div className="sr-only" aria-live="polite">
        {t(`rehearsal:status.${liveStatus}`)}
      </div>
    </div>
  );
}

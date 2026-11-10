import { deriveStatus, type Notation, type SongMaterialDto } from "@bandsync/shared";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronUp,
  Headphones,
  LogOut,
  Maximize2,
  MessageSquare,
  Minimize2,
  Play,
  Square,
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
import { useIsPhone } from "../../lib/useIsPhone";
import { Board } from "../agenda/Board";
import { InstrumentViews, viewFor } from "../arrangement/InstrumentViews";
import { useAuth } from "../auth/AuthProvider";
import { ReferenceListen, ReferenceSummaryView } from "../autoarrange/reference";
import { useBand } from "../bands/queries";
import { MaterialViewer } from "../repertoire/MaterialViewer";
import { useRepertoires, useSong, useSongs } from "../repertoire/queries";
import { BeatIndicator } from "./BeatIndicator";
import { ConductorControls } from "./ConductorControls";
import { ControlSheet, type SheetLevel } from "./ControlSheet";
import { qualityTone, SyncDiagnostics } from "./SyncDiagnostics";
import { useAudioStatus, useMetronome } from "./useMetronome";
import { useRehearsalSession } from "./useRehearsalSession";

const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export function RehearsalRoomPage() {
  const { bandId = "", sessionId = "" } = useParams();
  const { t } = useTranslation(["rehearsal", "common", "agenda"]);
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
  // On a phone the controls are a sheet that stays small until it is pulled up, and the
  // material can take the whole screen ("focus"): the music is what the screen is for.
  const phone = useIsPhone();
  const [sheet, setSheet] = useState<SheetLevel>("mini");
  const [focus, setFocus] = useState(false);
  const enterFocus = () => {
    setFocus(true);
    // Where the browser allows it (Android), also hide its own bars. iPhone has no such API.
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const leaveFocus = () => {
    setFocus(false);
    setSheet("mini");
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  };

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

  // Which rehearsal on the agenda this session belongs to: its board opens from the room.
  const sessionRow = useQuery({
    queryKey: ["rehearsal-session", bandId, sessionId],
    staleTime: 60_000,
    queryFn: () =>
      http.get<{ session: { eventId: string | null } }>(
        `/api/bands/${bandId}/rehearsals/${sessionId}`,
      ),
  });
  const eventId = sessionRow.data?.session.eventId ?? null;
  const [showBoard, setShowBoard] = useState(false);

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
        {eventId ? (
          <Link to={`/bands/${bandId}/agenda/${eventId}`} data-testid="ended-board">
            <Button size="lg" icon={<MessageSquare className="size-5" />}>
              {t("agenda:board.open")}
            </Button>
          </Link>
        ) : null}
        <Link to={`/bands/${bandId}`}>
          <Button size="lg" variant={eventId ? "ghost" : "primary"}>
            {t("rehearsal:room.backToBand")}
          </Button>
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

  const tempoNote =
    state.currentSong &&
    (state.currentSong.bpmSource !== "band" || !state.currentSong.meterConfirmed)
      ? [
          state.currentSong.bpmSource !== "band"
            ? t(`rehearsal:room.bpmSource.${state.currentSong.bpmSource}`)
            : null,
          !state.currentSong.meterConfirmed ? t("rehearsal:room.meterUnconfirmed") : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
  const clickLabel = me?.audioEnabled
    ? t("rehearsal:member.clickOn")
    : t("rehearsal:member.clickOff");
  const toggleClick = () => send({ type: "set_audio", enabled: !me?.audioEnabled });
  const volumeSlider = (
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
  );

  return (
    <div className="flex h-dvh flex-col bg-surface" data-phone={phone} data-focus={focus}>
      {/* Top bar */}
      <header
        className={cn(
          "flex items-center gap-2 border-b border-line px-3 safe-top",
          phone ? "py-1.5" : "py-2",
          focus && "hidden",
        )}
      >
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
        {eventId ? (
          <button
            type="button"
            onClick={() => setShowBoard(true)}
            aria-label={t("agenda:board.open")}
            title={t("agenda:board.open")}
            data-testid="board-open"
            className="rounded-lg p-1.5 hover:bg-elev"
          >
            <MessageSquare className="size-5" />
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

      {/* Beat + musical info (on a phone this lives in the bottom sheet) */}
      {!phone && !focus ? (
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
            {state.currentSong?.key ? (
              <Badge className="ml-2">{state.currentSong.key}</Badge>
            ) : null}
          </div>
          <BeatIndicator beat={beat} beatsPerBar={m.beatsPerBar} running={m.running} compact />
        </section>
      ) : null}
      {tempoNote && !phone && !focus ? (
        <p
          className="border-b border-line bg-warn-500/10 px-4 py-1.5 text-xs text-warn-500"
          role="status"
          data-testid="tempo-source"
        >
          {tempoNote}
        </p>
      ) : null}

      {/* Material */}
      <main
        className={cn(
          "relative flex-1 overflow-y-auto",
          phone && !focus && "pb-6",
          // Room for the first and last lines to scroll clear of the two floating controls.
          focus && "pb-14 pt-11",
        )}
        data-testid="room-material"
      >
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
            <div
              className={cn(
                "sticky top-0 z-10 flex items-center gap-2 overflow-x-auto border-b border-line bg-surface/95 px-3 backdrop-blur",
                phone ? "py-1.5" : "py-2",
                focus && "hidden",
              )}
            >
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
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("rehearsal:focus.enter")}
                  title={t("rehearsal:focus.enter")}
                  data-testid="focus-enter"
                  onClick={enterFocus}
                  icon={<Maximize2 className="size-4" />}
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
              <details className="border-t border-line p-3" data-testid="live-arrangement">
                <summary className="cursor-pointer text-xs uppercase tracking-wide text-muted">
                  {t("rehearsal:member.sections")} ·{" "}
                  {songQ.data.song.sections.map((s) => `${s.name} ${s.bars}`).join(" · ")}
                </summary>
                <div className="mt-3">
                  <InstrumentViews
                    compact
                    song={songQ.data.song}
                    materials={materials}
                    initial={viewFor(me?.instrument ?? user?.primaryInstrument)}
                  />
                </div>
              </details>
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

      {/* Focus: the material alone, with two small floating controls to read comfortably and
          to bring everything back. */}
      {focus ? (
        <>
          <div
            className="fixed right-2 z-40 flex items-center gap-1 rounded-full border border-line bg-elev/90 p-1 shadow-lg backdrop-blur"
            style={{ top: "max(env(safe-area-inset-top), 0.5rem)" }}
            data-testid="focus-tools"
          >
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
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("rehearsal:focus.exit")}
              data-testid="focus-exit"
              onClick={leaveFocus}
              icon={<Minimize2 className="size-4" />}
            />
          </div>
          <button
            type="button"
            data-testid="focus-handle"
            aria-label={t("rehearsal:focus.showControls")}
            onClick={leaveFocus}
            className="fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-elev/90 px-3 py-1.5 text-xs shadow-lg backdrop-blur"
            style={{ bottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
          >
            <BeatIndicator beat={beat} beatsPerBar={m.beatsPerBar} running={m.running} compact />
            <span className="font-semibold tabular-nums">{Math.round(m.bpm)}</span>
            <ChevronUp className="size-4 text-muted" aria-hidden="true" />
          </button>
        </>
      ) : null}

      {/* With everything open, a tap on the music puts the sheet away. */}
      {phone && !focus && sheet === "full" ? (
        <button
          type="button"
          aria-label={t("rehearsal:sheet.collapse")}
          data-testid="sheet-backdrop"
          className="fixed inset-0 z-20 bg-black/35"
          onClick={() => setSheet("mini")}
        />
      ) : null}

      {/* Phone: the controls are a sheet; one row until it is pulled up. */}
      {phone && !focus ? (
        <ControlSheet
          level={sheet}
          onLevel={setSheet}
          handleLabel={
            sheet === "full" ? t("rehearsal:sheet.collapse") : t("rehearsal:sheet.expand")
          }
          mini={
            <>
              {tempoNote ? (
                // Never a silent default: when the band has not confirmed tempo or meter, it says so.
                <button
                  type="button"
                  onClick={() => setSheet(sheet === "mini" ? "mid" : sheet)}
                  className="block w-full truncate pb-0.5 text-left text-[11px] text-warn-500"
                  data-testid="tempo-source"
                >
                  {tempoNote}
                </button>
              ) : null}
              <div className="flex items-center gap-2 pb-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setSheet(sheet === "mini" ? "mid" : "mini")}
                  aria-label={
                    sheet === "mini" ? t("rehearsal:sheet.expand") : t("rehearsal:sheet.collapse")
                  }
                  data-testid="sheet-summary"
                >
                  <span className="block truncate text-sm font-semibold leading-tight">
                    {state.currentSong ? state.currentSong.title : t("rehearsal:room.noSong")}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <span
                      className={cn(
                        "font-semibold tabular-nums text-fg",
                        state.currentSong?.bpmSource === "none" && "text-muted",
                      )}
                      data-testid="sheet-bpm"
                    >
                      {Math.round(m.bpm)} {t("common:music.bpm")}
                    </span>
                    <span className="tabular-nums">
                      {m.beatsPerBar}/{m.beatUnit}
                    </span>
                    {state.currentSong?.key ? <span>{state.currentSong.key}</span> : null}
                    <BeatIndicator
                      beat={beat}
                      beatsPerBar={m.beatsPerBar}
                      running={m.running}
                      compact
                    />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={toggleClick}
                  aria-pressed={!!me?.audioEnabled}
                  aria-label={clickLabel}
                  data-testid="sheet-click"
                  className={cn(
                    "inline-flex size-11 shrink-0 items-center justify-center rounded-xl border",
                    me?.audioEnabled
                      ? "border-accent-500/60 bg-accent-500/10 text-accent-600 dark:text-accent-300"
                      : "border-line text-muted",
                  )}
                >
                  {me?.audioEnabled ? (
                    <Volume2 className="size-5" />
                  ) : (
                    <VolumeX className="size-5" />
                  )}
                </button>
                {isConductor ? (
                  <button
                    type="button"
                    onClick={() => send({ type: m.running ? "stop" : "start" })}
                    aria-label={
                      m.running ? t("rehearsal:controls.stop") : t("rehearsal:controls.start")
                    }
                    data-testid="sheet-transport"
                    data-running={m.running}
                    className={cn(
                      "inline-flex size-11 shrink-0 items-center justify-center rounded-xl font-semibold",
                      m.running ? "bg-danger-600 text-white" : "bg-accent-500 text-[#04221f]",
                    )}
                  >
                    {m.running ? (
                      <Square className="size-5 fill-current" />
                    ) : (
                      <Play className="size-5 fill-current" />
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => send({ type: "set_ready", ready: !me?.ready })}
                    aria-pressed={!!me?.ready}
                    aria-label={
                      me?.ready ? t("rehearsal:member.ready") : t("rehearsal:member.notReady")
                    }
                    data-testid="sheet-ready"
                    className={cn(
                      "inline-flex size-11 shrink-0 items-center justify-center rounded-xl border",
                      me?.ready
                        ? "border-ok-500 bg-ok-500/15 text-ok-500"
                        : "border-line text-muted",
                    )}
                  >
                    <Check className="size-5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setSheet(sheet === "mini" ? "mid" : sheet === "mid" ? "full" : "mini")
                  }
                  aria-label={
                    sheet === "full" ? t("rehearsal:sheet.collapse") : t("rehearsal:sheet.expand")
                  }
                  data-testid="sheet-toggle"
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-sunken"
                >
                  {sheet === "full" ? (
                    <ChevronDown className="size-5" />
                  ) : (
                    <ChevronUp className="size-5" />
                  )}
                </button>
              </div>
            </>
          }
          mid={
            <div className="flex flex-col gap-2">
              {tempoNote ? (
                <p className="text-xs text-warn-500" role="status" data-testid="sheet-tempo-source">
                  {tempoNote}
                </p>
              ) : null}
              {isConductor ? (
                <ConductorControls
                  compact
                  parts={["transport", "tempo"]}
                  state={state}
                  songs={songs.data ?? []}
                  repertoires={repertoires.data ?? []}
                  send={send}
                  onEnd={() => setConfirmEnd(true)}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    variant={me?.ready ? "primary" : "outline"}
                    onClick={() => send({ type: "set_ready", ready: !me?.ready })}
                    aria-pressed={!!me?.ready}
                    className="flex-1"
                  >
                    {me?.ready ? t("rehearsal:member.ready") : t("rehearsal:member.notReady")}
                  </Button>
                  {canClaim ? (
                    <Button variant="secondary" onClick={() => send({ type: "claim_conductor" })}>
                      {t("rehearsal:controls.claim")}
                    </Button>
                  ) : null}
                </div>
              )}
              <div className="flex items-center gap-3">
                <span className="shrink-0 text-xs text-muted">{t("rehearsal:member.volume")}</span>
                {volumeSlider}
                {m.clickMode === "central" ? (
                  <Badge tone="warn">{t("rehearsal:controls.clickModes.central")}</Badge>
                ) : null}
              </div>
            </div>
          }
          full={
            <div className="flex flex-col gap-2">
              {isConductor ? (
                <ConductorControls
                  compact
                  parts={["admin"]}
                  state={state}
                  songs={songs.data ?? []}
                  repertoires={repertoires.data ?? []}
                  send={send}
                  onEnd={() => setConfirmEnd(true)}
                />
              ) : (
                <p className="text-center text-sm text-muted">
                  {t("rehearsal:room.conductor")}:{" "}
                  <span className="font-medium text-fg">
                    {conductor?.displayName ?? t("rehearsal:room.noConductor")}
                  </span>
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  icon={<Maximize2 className="size-4" />}
                  onClick={enterFocus}
                >
                  {t("rehearsal:focus.enter")}
                </Button>
                <Button
                  variant="secondary"
                  icon={<Users className="size-4" />}
                  onClick={() => setShowParticipants(true)}
                >
                  {t("rehearsal:room.participants")} · {connectedCount}
                </Button>
                <Button
                  variant="secondary"
                  icon={<Activity className="size-4" />}
                  onClick={() => setShowSync(true)}
                >
                  {t("rehearsal:sync.title")}
                </Button>
                {reference ? (
                  <Button
                    variant="secondary"
                    icon={<Headphones className="size-4" />}
                    onClick={() => setShowReference(true)}
                  >
                    {t("rehearsal:room.reference")}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  icon={<LogOut className="size-4 rotate-180" />}
                  onClick={() => setConfirmLeave(true)}
                >
                  {t("rehearsal:room.leave")}
                </Button>
              </div>
            </div>
          }
        />
      ) : null}

      {/* Bottom panel (larger screens) */}
      {!phone && !focus ? (
        <footer className="border-t border-line bg-elev px-3 pt-3 safe-bottom">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Button
              variant={me?.audioEnabled ? "secondary" : "outline"}
              size="lg"
              onClick={toggleClick}
              icon={
                me?.audioEnabled ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />
              }
              aria-pressed={!!me?.audioEnabled}
            >
              {clickLabel}
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
      ) : null}

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

      <Dialog
        open={showBoard && !!eventId}
        onClose={() => setShowBoard(false)}
        title={t("agenda:board.title")}
      >
        {eventId && showBoard ? <Board bandId={bandId} eventId={eventId} compact /> : null}
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

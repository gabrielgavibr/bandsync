import type { PreparationStage, RecordingArrangementDto, SongDto } from "@bandsync/shared";
import {
  AudioWaveform,
  Check,
  CircleDashed,
  Headphones,
  ListMusic,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { Badge, Button, Card, ErrorBlock, LoadingBlock, PageHeader } from "../../components/ui";
import { cn } from "../../lib/cn";
import { formatDateTime, formatDuration } from "../../lib/format";
import { ReviewForm } from "../autoarrange/parts";
import {
  type SongAnalysisOverview,
  useReportPlayerDuration,
  useSongAnalysis,
} from "../autoarrange/queries";
import { ReferencePlayer, ReferenceSummaryView } from "../autoarrange/reference";
import { useCurrentBand } from "../bands/BandLayout";
import { ArrangementEditor } from "./Editor";
import { GeneratePanel } from "./Generate";
import { InstrumentViews } from "./InstrumentViews";
import { currentStage, hasPlayerDuration, type LocalWork, referenceFacts } from "./prep";
import { letterColor, RecordingTimeline, sectionAt, useSectionTitle } from "./Timeline";
import { type PlayerControls, useYouTubePlayer } from "./youtube";

const STEPS: PreparationStage[] = [
  "reference_identified",
  "searching_information",
  "checking_analysis",
  "analysing_recording",
  "detecting_structure",
  "preparing_prearrangement",
  "awaiting_review",
  "ready",
];

/**
 * "Pré-arranjo": the reference recording (official player), the recording's pre-arrangement
 * (what an analysis or a member's marks found, never changed afterwards) and the band's own
 * arrangement, edited from it.
 */
export function ArrangementPage() {
  const { songId = "" } = useParams();
  const band = useCurrentBand();
  const bandId = band.id;
  const { t } = useTranslation(["autoarrange", "common"]);
  const overview = useSongAnalysis(bandId, songId, true);
  const canEdit = band.myPermissions.canEditRepertoire;

  if (overview.isLoading) return <LoadingBlock />;
  if (overview.error || !overview.data)
    return <ErrorBlock error={overview.error} onRetry={() => void overview.refetch()} />;
  const o = overview.data;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        backTo={`/bands/${bandId}/songs/${songId}`}
        title={o.song.title}
        subtitle={t("autoarrange:pre.pageSubtitle")}
      />
      <Workspace bandId={bandId} overview={o} canEdit={canEdit} />
    </div>
  );
}

function Workspace({
  bandId,
  overview: o,
  canEdit,
}: {
  bandId: string;
  overview: SongAnalysisOverview;
  canEdit: boolean;
}) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const song = o.song;
  const reference = song.reference;
  const isYouTube =
    !!reference?.externalId &&
    (reference.platform === "youtube" || reference.platform === "youtube_music") &&
    reference.embeddable !== false;
  const host = useRef<HTMLDivElement>(null);
  const yt = useYouTubePlayer(host, isYouTube ? reference!.externalId : null);
  const player: PlayerControls | null = isYouTube ? yt : null;
  const [local, setLocal] = useState<LocalWork | null>(null);
  const [regenerate, setRegenerate] = useState(false);
  const stage = currentStage(o, local);
  const pre = o.prearrangement;

  // The official player knows the video's duration: keep it once as a fact about the reference.
  const reportDuration = useReportPlayerDuration(bandId, song.id);
  const reported = useRef(false);
  useEffect(() => {
    if (!canEdit || reported.current || !yt.ready || yt.duration < 1) return;
    if (hasPlayerDuration(o)) return;
    reported.current = true;
    reportDuration.mutate(yt.duration);
  }, [canEdit, yt.ready, yt.duration, o, reportDuration]);

  const listen = player?.ready
    ? (s: number) => {
        player.seek(s);
        player.play();
        host.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    : undefined;

  return (
    <>
      <Card data-testid="reference-card">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Headphones className="size-4 text-accent-500" /> {t("autoarrange:reference.heading")}
        </h2>
        {reference ? (
          <div className="flex flex-col gap-3">
            <ReferenceSummaryView reference={reference} size="sm" />
            {isYouTube ? (
              <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
                <div ref={host} className="size-full" data-testid="youtube-player" />
              </div>
            ) : reference.platform && reference.externalId && reference.embeddable !== false ? (
              <ReferencePlayer
                platform={reference.platform}
                externalId={reference.externalId}
                title={reference.title}
              />
            ) : null}
            {yt.failed ? (
              <p className="text-sm text-warn-500">{t("autoarrange:pre.playerFailed")}</p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted">{t("autoarrange:reference.none")}</p>
            {canEdit ? (
              <Link to={`/bands/${bandId}/songs/add?song=${song.id}`}>
                <Button>{t("autoarrange:reference.set")}</Button>
              </Link>
            ) : null}
          </div>
        )}
      </Card>

      <Card data-testid="prearrangement-card" data-stage={stage}>
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <AudioWaveform className="size-4 text-accent-500" /> {t("autoarrange:pre.heading")}
        </h2>
        <p className="mb-4 text-sm text-muted">{t("autoarrange:pre.headingHint")}</p>
        <StageList stage={stage} hasReference={!!reference} />

        {pre ? (
          <PrearrangementView
            pre={pre}
            song={song}
            durationSec={yt.duration || pre.data.sections[pre.data.sections.length - 1]!.endSec}
            time={player?.time ?? 0}
            onSeek={listen}
          />
        ) : (
          <Unavailable overview={o} stage={stage} />
        )}

        {canEdit ? (
          <div className="mt-5 border-t border-line pt-4">
            {pre && !regenerate ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw className="size-4" />}
                onClick={() => setRegenerate(true)}
              >
                {t("autoarrange:pre.regenerate")}
              </Button>
            ) : (
              <>
                <h3 className="mb-3 font-semibold">{t("autoarrange:pre.generate")}</h3>
                <GeneratePanel
                  bandId={bandId}
                  songId={song.id}
                  overview={o}
                  player={player}
                  hasReference={!!reference}
                  busy={local !== null}
                  onStage={(s) => {
                    setLocal(s);
                    if (s === null) setRegenerate(false);
                  }}
                />
              </>
            )}
          </div>
        ) : null}
      </Card>

      <Card data-testid="band-arrangement-editor">
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <ListMusic className="size-4 text-accent-500" /> {t("autoarrange:editor.heading")}
        </h2>
        <p className="mb-4 text-sm text-muted">{t("autoarrange:editor.headingHint")}</p>
        <ArrangementEditor
          bandId={bandId}
          song={song}
          pre={pre}
          canEdit={canEdit}
          onListen={listen}
        />
        {canEdit ? (
          <details className="mt-5 border-t border-line pt-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t("autoarrange:editor.bandValues")}
            </summary>
            <div className="mt-3">
              <ReviewForm bandId={bandId} song={song} overview={o} />
            </div>
          </details>
        ) : null}
      </Card>

      {song.sections.length > 0 ? <InstrumentViews song={song} /> : null}
    </>
  );
}

function StageList({ stage, hasReference }: { stage: PreparationStage; hasReference: boolean }) {
  const { t } = useTranslation("autoarrange");
  const unavailable = stage === "analysis_unavailable";
  const current = unavailable ? 3 : STEPS.indexOf(stage);
  return (
    <ol className="mb-4 flex flex-col gap-1.5 text-sm" data-testid="stage-list">
      {STEPS.map((s, i) => {
        const state =
          i <= 1 && !hasReference
            ? "todo"
            : unavailable && i >= 3 && i <= 5
              ? i === 3
                ? "unavailable"
                : "todo"
              : i < current || (s === "ready" && stage === "ready")
                ? "done"
                : i === current
                  ? "current"
                  : "todo";
        const label =
          state === "unavailable" ? t("pre.stage.analysis_unavailable") : t(`pre.stage.${s}`);
        const Icon =
          state === "done"
            ? Check
            : state === "current"
              ? Loader2
              : state === "unavailable"
                ? TriangleAlert
                : CircleDashed;
        return (
          <li
            key={s}
            data-step={s}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "flex items-center gap-2",
              state === "todo" && "text-muted",
              state === "current" && "font-semibold",
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0",
                state === "done" && "text-ok-500",
                state === "current" && "text-accent-500",
                state === "current" &&
                  [
                    "searching_information",
                    "analysing_recording",
                    "detecting_structure",
                    "preparing_prearrangement",
                  ].includes(s) &&
                  "animate-spin",
                state === "unavailable" && "text-warn-500",
              )}
            />
            {label}
          </li>
        );
      })}
    </ol>
  );
}

/** No pre-arrangement yet: what is verified, and what still needs a recording BandSync may analyse. */
function Unavailable({
  overview,
  stage,
}: {
  overview: SongAnalysisOverview;
  stage: PreparationStage;
}) {
  const { t, i18n } = useTranslation(["autoarrange", "common"]);
  const facts = referenceFacts(overview);
  const fmt = (n: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(n);
  return (
    <div className="flex flex-col gap-3" data-testid="prearrangement-unavailable">
      {stage === "analysis_unavailable" ? (
        <p className="rounded-xl border border-dashed border-warn-500/60 bg-warn-500/5 p-3 text-sm">
          {t("autoarrange:pre.unavailableBody")}
        </p>
      ) : null}
      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          {t("autoarrange:pre.verified")}
        </h3>
        {facts.length === 0 ? (
          <p className="text-sm text-muted">{t("autoarrange:pre.verifiedNone")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm" data-testid="verified-facts">
            {facts.map((f) => (
              <li key={`${f.kind}:${f.method}`} data-kind={f.kind} data-origin={f.origin}>
                <span className="font-medium">
                  {f.kind === "duration"
                    ? `${t("autoarrange:results.kind.duration")}: ${formatDuration(Math.round(f.value))}`
                    : `${t("autoarrange:results.kind.bpm")}: ${fmt(f.value)}`}
                </span>{" "}
                <span className="text-muted">
                  · {t(`autoarrange:pre.factOrigin.${f.origin}`, { defaultValue: f.origin })}
                </span>
                {f.kind === "bpm" ? (
                  <Badge tone="warn" className="ml-1.5">
                    {t("autoarrange:pre.publishedEstimate")}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          {t("autoarrange:pre.stillNeeded")}
        </h3>
        <p className="text-sm text-muted">{t("autoarrange:pre.stillNeededBody")}</p>
      </div>
    </div>
  );
}

const SOURCE_ICON: Record<RecordingArrangementDto["source"], string> = {
  audio_file: "audio_file",
  microphone: "microphone",
  member_marks: "member_marks",
};

function PrearrangementView({
  pre,
  song,
  durationSec,
  time,
  onSeek,
}: {
  pre: RecordingArrangementDto;
  song: SongDto;
  durationSec: number;
  time: number;
  onSeek?: (s: number) => void;
}) {
  const { t, i18n } = useTranslation(["autoarrange", "common"]);
  const title = useSectionTitle();
  const d = pre.data;
  const fmt = (n: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(n);
  const active = sectionAt(d.sections, time);
  const reviewed = song.version.arrangementBaseId === pre.id && !!song.version.arrangementUpdatedAt;
  const fromAudio = pre.source !== "member_marks";

  return (
    <div className="flex flex-col gap-4" data-testid="prearrangement" data-source={pre.source}>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Fact label={t("common:music.bpm")}>
          {d.bpm ? fmt(d.bpm.value) : "—"}
          {d.bpm?.alternatives.length ? (
            <span className="text-xs text-muted">
              {" "}
              {t("autoarrange:listen.or", { values: d.bpm.alternatives.map(fmt).join(", ") })}
            </span>
          ) : null}
        </Fact>
        <Fact label={t("common:music.key")}>{d.key?.key ?? "—"}</Fact>
        <Fact label={t("common:music.timeSignature")}>{`${d.beatsPerBar}/4`}</Fact>
        <Fact label={t("autoarrange:pre.barsTotal")}>{d.bars}</Fact>
      </dl>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <Badge tone={reviewed ? "ok" : "warn"}>
          {reviewed ? t("autoarrange:pre.reviewedByBand") : t("autoarrange:pre.estimated")}
        </Badge>
        {t(`autoarrange:pre.source.${SOURCE_ICON[pre.source]}`)} · {pre.createdByName ?? "—"} ·{" "}
        {formatDateTime(pre.createdAt, i18n.language)}
        {fromAudio && d.analysedSeconds > 0
          ? ` · ${t("autoarrange:pre.analysed", { time: formatDuration(Math.round(d.analysedSeconds)) })}`
          : ""}
      </p>
      {d.bpm?.origin === "deezer" ? (
        <p className="text-xs text-muted">{t("autoarrange:pre.tempoFromDeezer")}</p>
      ) : null}

      <RecordingTimeline
        sections={d.sections}
        durationSec={durationSec}
        time={time}
        onSeek={onSeek}
        activeIndex={active >= 0 ? active : null}
      />

      <ol className="flex flex-col gap-1.5" data-testid="pre-sections">
        {d.sections.map((s, i) => {
          const prog = s.chords.filter((c, k) => c !== "N" && c !== s.chords[k - 1]);
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: sections have no id
              key={i}
              data-label={s.label}
              data-kind={s.kind}
              className={cn(
                "grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-0.5 rounded-lg bg-sunken px-3 py-2 text-sm",
                active === i && "ring-1 ring-accent-500",
              )}
            >
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex size-6 items-center justify-center rounded text-xs font-bold text-white"
                style={{ background: letterColor(s.label) }}
              >
                {s.label}
              </span>
              <span className="min-w-0">
                <span className="font-medium">{title(s)}</span>
                <span className="block text-xs text-muted">
                  {formatDuration(Math.round(s.startSec))}–{formatDuration(Math.round(s.endSec))} ·{" "}
                  {formatDuration(Math.round(s.endSec - s.startSec))} ·{" "}
                  {t("autoarrange:pre.barsCount", { count: s.bars })}
                  {s.kind !== "unknown"
                    ? ` · ${t(`autoarrange:pre.confidence.${s.kindConfidence}`)}`
                    : ""}
                </span>
                {prog.length ? (
                  <span className="block font-mono text-xs">{prog.join(" → ")}</span>
                ) : fromAudio ? null : (
                  <span className="block text-xs text-muted">
                    {t("autoarrange:pre.noChordsMarks")}
                  </span>
                )}
                {s.cues.length ? (
                  <span className="block text-xs text-muted">
                    {s.cues
                      .map(
                        (c) =>
                          `${t(`autoarrange:pre.cue.${c.type}`)} (${t("autoarrange:editor.cueBar", { bar: c.bar + 1 })})`,
                      )
                      .join(" · ")}
                  </span>
                ) : null}
              </span>
              {onSeek ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onSeek(s.startSec)}
                  aria-label={t("autoarrange:editor.listenFrom", { name: title(s) })}
                >
                  ▶
                </Button>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted">{t("autoarrange:pre.honesty")}</p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="text-lg font-semibold">{children}</dd>
    </div>
  );
}

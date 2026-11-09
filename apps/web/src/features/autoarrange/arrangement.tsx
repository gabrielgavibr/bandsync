import {
  AUDIO_RIGHTS,
  type PreparationState,
  type SongDto,
  type SongMaterialDto,
} from "@bandsync/shared";
import {
  AudioLines,
  Check,
  CircleDashed,
  ListMusic,
  Mic,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge, Button, Card, Dialog, Input, Select, useToast } from "../../components/ui";
import { cn } from "../../lib/cn";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { useUploadFile } from "../repertoire/queries";
import { ReferencesCard, SongSheet } from "../repertoire/SongSheet";
import { ListenError } from "./listen/audio";
import { ListenDialog, useAnalyseFile } from "./listen/ListenDialog";
import { JobProgress, ResultsList, ReviewForm } from "./parts";
import {
  type SongAnalysisOverview,
  useDeclareAudio,
  useJobAction,
  useSongAnalysis,
} from "./queries";
import { PLATFORM_NAMES } from "./reference";

type Tone = "ok" | "warn" | "neutral" | "accent";

function StateRow({
  item,
  state,
  tone,
  label,
  children,
}: {
  item: string;
  state: string;
  tone: Tone;
  label: string;
  children?: ReactNode;
}) {
  const Icon = tone === "ok" ? Check : tone === "warn" ? TriangleAlert : CircleDashed;
  return (
    <li className="flex items-start gap-2.5 text-sm" data-item={item} data-state={state}>
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "ok" && "text-ok-500",
          tone === "warn" && "text-warn-500",
          tone === "accent" && "text-accent-500",
          tone === "neutral" && "text-muted",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * Where the preparation stands. Knowing the link, having audio the band may process and having
 * analysed it are three separate lines, so a pasted link never reads as an analysis.
 */
export function PreparationList({
  bandId,
  songId,
  overview,
  canEdit,
}: {
  bandId: string;
  songId: string;
  overview: SongAnalysisOverview;
  canEdit: boolean;
}) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const p: PreparationState = overview.preparation;
  const action = useJobAction(bandId, songId);
  const [uploading, setUploading] = useState(false);
  const [listening, setListening] = useState(false);
  const fileAnalysis = useAnalyseFile(bandId, songId);
  const { toast } = useToast();
  const latestJob = overview.jobs[0] ?? null;
  const reference = overview.song.reference;
  // Files whose analysis is not stored yet.
  const analysedFiles = new Set(
    overview.results.filter((r) => r.audioAssetId).map((r) => r.audioAssetId!),
  );
  const unanalysed = overview.audioAssets.filter((a) => !analysedFiles.has(a.id));
  const analyseFile = async (assetId: string, fileId: string) => {
    try {
      await fileAnalysis.run(assetId, { fileId });
      toast(t("autoarrange:listen.saved"), "success");
    } catch (err) {
      toast(
        err instanceof ListenError ? t(`autoarrange:listen.error.${err.code}`) : errorText(err),
        "error",
      );
    }
  };
  const hint = (text: string) => <p className="text-xs text-muted">{text}</p>;

  return (
    <>
      <ul className="flex flex-col gap-2.5" data-testid="preparation-state">
        <StateRow
          item="reference"
          state={p.reference}
          tone={p.reference === "identified" ? "ok" : p.reference === "none" ? "neutral" : "warn"}
          label={t(`autoarrange:state.reference.${p.reference}`)}
        />
        {p.player === "unavailable" ? (
          <StateRow
            item="player"
            state="unavailable"
            tone="warn"
            label={t("autoarrange:state.player.unavailable")}
          >
            {hint(t("autoarrange:reference.playerUnavailable"))}
          </StateRow>
        ) : null}
        <StateRow
          item="audio"
          state={p.audio}
          tone={p.audio === "available" ? "ok" : "neutral"}
          label={t(`autoarrange:state.audio.${p.audio}`)}
        >
          {p.audio === "none" ? hint(t("autoarrange:state.audio.noneHint")) : null}
          {overview.audioAssets.length > 0 ? (
            <ul className="mt-1 text-xs text-muted">
              {overview.audioAssets.map((a) => (
                <li key={a.id}>
                  {a.fileName} · {t(`autoarrange:audio.rights.${a.rightsBasis}`)}
                </li>
              ))}
            </ul>
          ) : null}
          {canEdit && overview.recordings.some((r) => r.isReference) ? (
            <Button
              size="sm"
              variant="ghost"
              className="-ml-3 mt-1"
              icon={<Upload className="size-4" />}
              onClick={() => setUploading(true)}
            >
              {t("autoarrange:audio.add")}
            </Button>
          ) : null}
        </StateRow>
        <StateRow
          item="analysis"
          state={p.analysis}
          tone={p.analysis === "done" ? "ok" : p.analysis === "pending" ? "warn" : "neutral"}
          label={
            p.analysis === "done" && p.analysisFrom
              ? t(`autoarrange:state.analysis.doneFrom.${p.analysisFrom}`)
              : t(`autoarrange:state.analysis.${p.analysis}`)
          }
        >
          {p.analysis === "pending" ? hint(t("autoarrange:state.analysis.pendingHint")) : null}
          {p.analysis === "not_possible" ? hint(t("autoarrange:state.analysis.noneHint")) : null}
          {p.analysis === "done" ? hint(t("autoarrange:state.analysis.doneHint")) : null}
          {canEdit && reference ? (
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={p.analysis === "done" ? "ghost" : "primary"}
                icon={<Mic className="size-4" />}
                onClick={() => setListening(true)}
                className={p.analysis === "done" ? "-ml-3" : undefined}
              >
                {p.analysis === "done"
                  ? t("autoarrange:listen.listenAgain")
                  : t("autoarrange:listen.button")}
              </Button>
              {unanalysed.map((a) => (
                <Button
                  key={a.id}
                  size="sm"
                  variant="secondary"
                  icon={<AudioLines className="size-4" />}
                  loading={fileAnalysis.busy === a.id}
                  disabled={!!fileAnalysis.busy}
                  onClick={() => void analyseFile(a.id, a.fileId)}
                >
                  {t("autoarrange:listen.analyseFile", { name: a.fileName })}
                </Button>
              ))}
            </div>
          ) : null}
        </StateRow>
        <StateRow
          item="arrangement"
          state={p.arrangement}
          tone={
            p.arrangement === "reviewed"
              ? "ok"
              : p.arrangement === "ready_for_review"
                ? "accent"
                : "neutral"
          }
          label={t(`autoarrange:state.arrangement.${p.arrangement}`)}
        >
          {p.arrangement === "ready_for_review" ? (
            <>
              {hint(t("autoarrange:state.arrangement.reviewHint"))}
              {canEdit && latestJob ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-1.5"
                  loading={action.isPending}
                  onClick={() => action.mutate({ jobId: latestJob.id, action: "complete" })}
                >
                  {t("autoarrange:job.complete")}
                </Button>
              ) : null}
            </>
          ) : null}
        </StateRow>
      </ul>
      <AudioDialog
        open={uploading}
        onClose={() => setUploading(false)}
        bandId={bandId}
        songId={songId}
      />
      <ListenDialog
        open={listening}
        onClose={() => setListening(false)}
        bandId={bandId}
        songId={songId}
        reference={reference}
      />
    </>
  );
}

/** A file the band declares it may process. A link to a platform is never that. */
function AudioDialog({
  open,
  onClose,
  bandId,
  songId,
}: {
  open: boolean;
  onClose: () => void;
  bandId: string;
  songId: string;
}) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const upload = useUploadFile(bandId);
  const declare = useDeclareAudio(bandId, songId);
  const fileAnalysis = useAnalyseFile(bandId, songId);
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [declared, setDeclared] = useState(false);
  const busy = upload.isPending || declare.isPending || !!fileAnalysis.busy;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file || !declared) return;
    const fd = new FormData(e.currentTarget);
    try {
      const uploaded = await upload.mutateAsync(file);
      const asset = await declare.mutateAsync({
        fileId: uploaded.id,
        rightsBasis: String(fd.get("rights")),
        rightsNote: String(fd.get("note") ?? "").trim() || null,
      });
      toast(t("autoarrange:audio.saved"), "success");
      // The file is right here: analyse it now, on this device.
      try {
        await fileAnalysis.run(asset.id, file);
        toast(t("autoarrange:listen.saved"), "success");
      } catch (err) {
        toast(
          err instanceof ListenError ? t(`autoarrange:listen.error.${err.code}`) : errorText(err),
          "error",
        );
      }
      setFile(null);
      setDeclared(false);
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("autoarrange:audio.add")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-muted">{t("autoarrange:audio.explain")}</p>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("autoarrange:audio.file")}
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm font-normal file:mr-3 file:rounded-lg file:border-0 file:bg-elev file:px-3 file:py-2 file:text-fg"
          />
        </label>
        <Select
          name="rights"
          label={t("autoarrange:audio.rightsLabel")}
          defaultValue="own_recording"
        >
          {AUDIO_RIGHTS.map((r) => (
            <option key={r} value={r}>
              {t(`autoarrange:audio.rights.${r}`)}
            </option>
          ))}
        </Select>
        <Input name="note" label={t("autoarrange:audio.note")} maxLength={500} />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={declared}
            onChange={(e) => setDeclared(e.target.checked)}
            className="mt-0.5 size-5 accent-[var(--color-accent-500)]"
          />
          <span>{t("autoarrange:audio.declaration")}</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common:actions.cancel")}
          </Button>
          <Button type="submit" loading={busy} disabled={!file || !declared}>
            {t("autoarrange:audio.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>
  );
}

/**
 * Second block of the song sheet: what the band actually plays. Tempo, key and meter are the
 * band's own values (they feed the live rehearsal) and are never filled in from a guess.
 */
export function BandArrangementCard({
  bandId,
  song,
  materials,
  canEdit,
}: {
  bandId: string;
  song: SongDto;
  materials: SongMaterialDto[];
  canEdit: boolean;
}) {
  const { t } = useTranslation(["autoarrange", "repertoire", "common"]);
  const overview = useSongAnalysis(bandId, song.id, true);
  const pending = <span className="text-warn-500">{t("repertoire:song.bandPending")}</span>;
  const label = (m: SongMaterialDto) =>
    `${t(`common:materialType.${m.type}`)}${m.instrument ? ` · ${t(`common:instrument.${m.instrument}`)}` : ""}`;

  return (
    <Card data-testid="band-arrangement">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <ListMusic className="size-4 text-accent-500" /> {t("autoarrange:arrangement.heading")}
      </h2>

      {canEdit && overview.data ? (
        <ReviewForm bandId={bandId} song={overview.data.song} overview={overview.data} />
      ) : (
        <dl className="grid grid-cols-3 gap-3 text-sm" data-testid="band-values">
          <div>
            <dt className="text-muted">{t("common:music.bpm")}</dt>
            <dd className="text-lg font-semibold">{song.version.bpm ?? pending}</dd>
          </div>
          <div>
            <dt className="text-muted">{t("common:music.key")}</dt>
            <dd className="text-lg font-semibold">{song.version.key ?? pending}</dd>
          </div>
          <div>
            <dt className="text-muted">{t("common:music.timeSignature")}</dt>
            <dd className="text-lg font-semibold">
              {song.version.beatsPerBar}/{song.version.beatUnit}{" "}
              {song.version.meterConfirmed ? null : (
                <Badge tone="warn">{t("repertoire:song.meterUnconfirmed")}</Badge>
              )}
            </dd>
          </div>
        </dl>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <SubHeading>{t("repertoire:sections.title")}</SubHeading>
        {song.sections.length === 0 ? (
          <p className="text-sm text-muted">{t("repertoire:sections.empty")}</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {song.sections.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg bg-sunken px-3 py-2 text-sm"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-muted">{t("common:music.bars", { count: s.bars })}</span>
                {s.notes ? <span className="basis-full text-xs text-muted">{s.notes}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <SubHeading>{t("autoarrange:arrangement.materials")}</SubHeading>
        {materials.length === 0 ? (
          <p className="text-sm text-muted">{t("repertoire:materials.empty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" data-testid="materials-overview">
            {materials.map((m) => (
              <li key={m.id}>
                <Badge tone={m.status === "pending" ? "warn" : "ok"}>
                  {label(m)}
                  {m.status === "pending" ? ` · ${t("repertoire:materials.statusPending")}` : ""}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {song.version.notes ? (
        <div className="mt-5 border-t border-line pt-4">
          <SubHeading>{t("repertoire:song.fields.notes")}</SubHeading>
          <p className="whitespace-pre-wrap text-sm text-muted">{song.version.notes}</p>
        </div>
      ) : null}

      <div className="mt-5 border-t border-line pt-4">
        <SubHeading>{t("autoarrange:arrangement.preparation")}</SubHeading>
        {overview.data ? (
          <PreparationList
            bandId={bandId}
            songId={song.id}
            overview={overview.data}
            canEdit={canEdit}
          />
        ) : null}
        {canEdit && overview.data?.preparation.arrangement === "not_started" && song.reference ? (
          <Link to={`/bands/${bandId}/songs/add?song=${song.id}`} className="mt-2 inline-block">
            <Button size="sm" variant="secondary">
              {t("autoarrange:prepare.submit")}
            </Button>
          </Link>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Everything kept for provenance and audit, out of the way: catalogue data, sources, what each
 * preparation did, stored links and the history of confirmations and reference changes.
 */
export function TechnicalDetails({
  bandId,
  song,
  canEdit,
}: {
  bandId: string;
  song: SongDto;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation(["autoarrange", "repertoire"]);
  const overview = useSongAnalysis(bandId, song.id);
  const data = overview.data;
  const reference = data?.recordings.find((r) => r.isReference) ?? null;
  const previous = data?.recordings.filter((r) => !r.isReference) ?? [];
  const latestJob = data?.jobs[0] ?? null;
  const date = (iso: string | null) => (iso ? formatDateTime(iso, i18n.language) : "—");
  const targetLabel = (target: string) =>
    target === "reference"
      ? t("autoarrange:reference.heading")
      : t(
          `autoarrange:review.${target === "band_bpm" ? "bpm" : target === "band_key" ? "key" : "meter"}`,
        );

  return (
    <details className="mt-6 rounded-2xl border border-line" data-testid="technical-details">
      <summary className="cursor-pointer px-4 py-3 font-semibold">
        {t("autoarrange:technical.heading")}
        <span className="ml-2 text-sm font-normal text-muted">
          {t("autoarrange:technical.hint")}
        </span>
      </summary>
      <div className="grid gap-4 border-t border-line p-4 lg:grid-cols-2">
        <SongSheet song={song} />

        <Card>
          <h2 className="mb-3 font-semibold">{t("autoarrange:technical.identification")}</h2>
          {reference ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">{t("autoarrange:technical.identifiedBy")}</dt>
              <dd>{t(`autoarrange:technical.by.${reference.identifiedBy}`)}</dd>
              {reference.link ? (
                <>
                  <dt className="text-muted">{t("autoarrange:technical.platform")}</dt>
                  <dd>{PLATFORM_NAMES[reference.link.platform]}</dd>
                  <dt className="text-muted">{t("autoarrange:technical.platformTitle")}</dt>
                  <dd className="break-words">{reference.link.title ?? "—"}</dd>
                  <dt className="text-muted">{t("autoarrange:technical.platformAuthor")}</dt>
                  <dd>{reference.link.author ?? "—"}</dd>
                  <dt className="text-muted">{t("autoarrange:technical.link")}</dt>
                  <dd className="break-all">
                    <a
                      href={reference.link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-accent-600 underline dark:text-accent-300"
                    >
                      {reference.link.url}
                    </a>
                  </dd>
                  <dt className="text-muted">{t("autoarrange:technical.checkedAt")}</dt>
                  <dd>{date(reference.link.checkedAt)}</dd>
                </>
              ) : null}
              {reference.sourceUrl ? (
                <>
                  <dt className="text-muted">{t("autoarrange:technical.catalogue")}</dt>
                  <dd className="break-all">
                    <a
                      href={reference.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-accent-600 underline dark:text-accent-300"
                    >
                      {reference.sourceUrl}
                    </a>
                  </dd>
                </>
              ) : null}
              {reference.isrcs.length > 0 ? (
                <>
                  <dt className="text-muted">ISRC</dt>
                  <dd className="font-mono">{reference.isrcs.join(", ")}</dd>
                </>
              ) : null}
              {reference.disambiguation ? (
                <>
                  <dt className="text-muted">{t("autoarrange:technical.note")}</dt>
                  <dd>{reference.disambiguation}</dd>
                </>
              ) : null}
              <dt className="text-muted">{t("autoarrange:technical.since")}</dt>
              <dd>{date(reference.referenceSince)}</dd>
            </dl>
          ) : (
            <p className="text-sm text-muted">{t("autoarrange:reference.none")}</p>
          )}
          {previous.length > 0 ? (
            <div className="mt-4" data-testid="previous-references">
              <h3 className="mb-1 text-sm font-semibold">{t("autoarrange:technical.previous")}</h3>
              <ul className="flex flex-col gap-1 text-sm text-muted">
                {previous.map((r) => (
                  <li key={r.id}>
                    {r.title}
                    {r.artistCredit ? ` · ${r.artistCredit}` : ""}
                    {r.link ? ` · ${PLATFORM_NAMES[r.link.platform]}` : ""}
                    {r.retiredAt
                      ? ` · ${t("autoarrange:technical.until", { date: date(r.retiredAt) })}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">{t("autoarrange:results.heading")}</h2>
          {data ? <ResultsList results={data.results} /> : null}
        </Card>

        {latestJob ? (
          <Card>
            <h2 className="mb-3 font-semibold">{t("autoarrange:panel.lastJob")}</h2>
            <JobProgress bandId={bandId} job={latestJob} />
          </Card>
        ) : null}

        <ReferencesCard bandId={bandId} song={song} canEdit={canEdit} />

        <Card>
          <h2 className="mb-3 font-semibold">{t("autoarrange:panel.history")}</h2>
          {!data || data.reviews.length === 0 ? (
            <p className="text-sm text-muted">{t("autoarrange:technical.noHistory")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm" data-testid="history">
              {data.reviews.map((r) => (
                <li key={r.id} data-target={r.target}>
                  <span className="font-medium">{targetLabel(r.target)}</span>{" "}
                  <span className="text-muted">
                    · {r.userName ?? "—"} · {date(r.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </details>
  );
}

import {
  isLiveRecording,
  isRunningJob,
  type RecordingCandidate,
  type ReferenceDependents,
  type ReferenceLinkInfo,
  type SongDto,
  type SongReferenceSummary,
} from "@bandsync/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Headphones, Link2, Search } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorBlock,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  useToast,
} from "../../components/ui";
import { ApiError, errorCode, http } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDuration } from "../../lib/format";
import { useCurrentBand } from "../bands/BandLayout";
import { repKeys, useRepertoires, useSong } from "../repertoire/queries";
import { PreparationList } from "./arrangement";
import { JobProgress, ResultsList, ReviewForm } from "./parts";
import {
  type PrepareResponse,
  useIdentifyReference,
  useJob,
  usePrepare,
  useRecordingDetails,
  useRecordingSearch,
  useSetReferenceLink,
  useSongAnalysis,
} from "./queries";
import {
  PLATFORM_NAMES,
  PlatformBadge,
  ReferencePlayer,
  ReferenceSummaryView,
  ReferenceThumb,
} from "./reference";

type Mode = "link" | "catalogue";
type Choice = { kind: "musicbrainz"; candidate: RecordingCandidate } | { kind: "manual" };

/** "Natiruts feat. Luiz Melodia" -> "Natiruts": credits are written differently in every source. */
function mainArtist(artist: string | null | undefined): string {
  return (artist ?? "").split(/\s+(?:feat\.?|ft\.?|part\.?|participação|com)\s+/i)[0]!.trim();
}

function StepHeading({ n, children }: { n: number; children: string }) {
  const { t } = useTranslation("autoarrange");
  return (
    <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-full bg-accent-500/15 text-sm text-accent-600 dark:text-accent-300"
      >
        {n}
      </span>
      <span className="sr-only">{t("stepLabel", { n })}: </span>
      {children}
    </h2>
  );
}

/** Why a pasted link was refused, as one of the states the interface names. */
function linkProblem(err: unknown): string {
  if (!(err instanceof ApiError)) return "internal_error";
  const reason = (err.details as { reason?: string } | null | undefined)?.reason;
  if (reason) return reason; // invalid_url | unsupported_link | unsupported_platform | reference_not_found
  return err.code === "validation_error" ? "invalid_url" : err.code;
}

/**
 * Runs "prepare" and, when the server says confirmed values or arrangement work depend on the
 * current reference, asks the member before replacing it. Nothing is changed until they confirm.
 */
function usePrepareFlow(bandId: string, onPrepared: (res: PrepareResponse) => void) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const prepare = usePrepare(bandId);
  const { toast } = useToast();
  const [pending, setPending] = useState<{
    input: Record<string, unknown>;
    dependents: ReferenceDependents;
    current: SongReferenceSummary;
  } | null>(null);

  const run = async (input: Record<string, unknown>, confirmed = false) => {
    try {
      const res = await prepare.mutateAsync(confirmed ? { ...input, confirmReplace: true } : input);
      setPending(null);
      onPrepared(res);
    } catch (err) {
      if (err instanceof ApiError && err.code === "confirmation_required") {
        const d = err.details as { dependents: ReferenceDependents; current: SongReferenceSummary };
        setPending({ input, dependents: d.dependents, current: d.current });
        return;
      }
      toast(t(`common:errors.${errorCode(err)}`), "error");
    }
  };

  const d = pending?.dependents;
  const items: string[] = [];
  if (d) {
    for (const v of d.confirmedValues)
      items.push(
        t("autoarrange:replace.confirmed", {
          what: t(
            `autoarrange:review.${v === "band_bpm" ? "bpm" : v === "band_key" ? "key" : "meter"}`,
          ),
        }),
      );
    if (d.sections > 0) items.push(t("autoarrange:replace.sections", { count: d.sections }));
    if (d.readyMaterials > 0)
      items.push(t("autoarrange:replace.materials", { count: d.readyMaterials }));
    if (d.audioAssets > 0) items.push(t("autoarrange:replace.audio", { count: d.audioAssets }));
    if (d.analyses > 0) items.push(t("autoarrange:replace.analyses", { count: d.analyses }));
  }
  const dialog = (
    <ConfirmDialog
      open={!!pending}
      onClose={() => setPending(null)}
      title={t("autoarrange:replace.title")}
      confirmLabel={t("autoarrange:replace.confirm")}
      loading={prepare.isPending}
      onConfirm={() => pending && run(pending.input, true)}
      body={
        pending ? (
          <div className="flex flex-col gap-2 text-sm" data-testid="replace-warning">
            <p>
              {t("autoarrange:replace.body", {
                title: pending.current.title,
                artist: pending.current.artist ?? "—",
              })}
            </p>
            <ul className="list-disc pl-5">
              {items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
            <p className="text-muted">{t("autoarrange:replace.kept")}</p>
          </div>
        ) : null
      }
    />
  );
  return { run, loading: prepare.isPending, dialog };
}

export function AddSongWizardPage() {
  const { t } = useTranslation(["autoarrange", "common"]);
  const band = useCurrentBand();
  const [params] = useSearchParams();
  const existingSongId = params.get("song");
  const existing = useSong(band.id, existingSongId);
  const [mode, setMode] = useState<Mode>("link");
  const [prepared, setPrepared] = useState<PrepareResponse | null>(null);

  if (!band.myPermissions.canEditRepertoire) {
    return (
      <PageHeader
        title={t("autoarrange:title")}
        subtitle={t("common:errors.forbidden")}
        backTo={`/bands/${band.id}/songs`}
      />
    );
  }
  if (existingSongId && existing.isPending) return <LoadingBlock />;
  if (existingSongId && existing.isError) return <ErrorBlock error={existing.error} />;
  const song = existingSongId ? (existing.data?.song ?? null) : null;

  if (prepared) {
    return (
      <>
        <PageHeader
          title={prepared.song.title}
          subtitle={prepared.song.artist ?? undefined}
          backTo={`/bands/${band.id}/songs`}
        />
        <PreparedView bandId={band.id} songId={prepared.song.id} jobId={prepared.job.id} />
      </>
    );
  }

  const heading = !song
    ? t("autoarrange:title")
    : song.reference
      ? t("autoarrange:changeTitle")
      : t("autoarrange:existingTitle");
  const subtitle = song
    ? t("autoarrange:existingSubtitle", { title: song.title })
    : t("autoarrange:subtitle");

  return (
    <>
      <PageHeader
        title={heading}
        subtitle={subtitle}
        backTo={song ? `/bands/${band.id}/songs/${song.id}` : `/bands/${band.id}/songs`}
        actions={
          song ? null : (
            <Link to={`/bands/${band.id}/songs/new`}>
              <Button variant="outline">{t("autoarrange:manual")}</Button>
            </Link>
          )
        }
      />
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {song?.reference ? (
          <Card data-testid="current-reference">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {t("autoarrange:reference.current")}
            </p>
            <ReferenceSummaryView reference={song.reference} size="sm" />
          </Card>
        ) : null}
        {mode === "link" ? (
          <LinkFlow bandId={band.id} song={song} onPrepared={setPrepared} />
        ) : (
          <CatalogueFlow bandId={band.id} song={song} onPrepared={setPrepared} />
        )}
        <p className="text-center text-sm text-muted">
          {mode === "link" ? t("autoarrange:link.noLink") : t("autoarrange:search.haveLink")}{" "}
          <button
            type="button"
            className="font-medium text-accent-600 underline dark:text-accent-300"
            onClick={() => setMode(mode === "link" ? "catalogue" : "link")}
          >
            {mode === "link"
              ? t("autoarrange:link.searchInstead")
              : t("autoarrange:search.pasteInstead")}
          </button>
        </p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Main flow: paste a link, identify, confirm, prepare                 */
/* ------------------------------------------------------------------ */

/** What the platform said about a pasted link, with honest labels for what it did not say. */
function LinkPreview({
  info,
  testId = "reference-preview",
  children,
}: {
  info: ReferenceLinkInfo;
  testId?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation("autoarrange");
  const [listening, setListening] = useState(false);
  const canEmbed = info.embeddable !== false;
  return (
    <div
      className="flex flex-col gap-3"
      data-testid={testId}
      data-platform={info.platform}
      data-metadata={info.metadata}
    >
      <div className="flex items-start gap-3">
        <ReferenceThumb url={info.thumbnailUrl} className="size-20 sm:size-24" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">{info.title ?? t("link.noMetadataTitle")}</p>
          {info.author ? (
            <p className="text-sm text-muted">{t("link.channel", { name: info.author })}</p>
          ) : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <PlatformBadge platform={info.platform} />
            <Badge tone="ok">{t("state.reference.identified")}</Badge>
            {info.metadata === "missing" ? (
              <Badge tone="warn">{t("link.metadataMissing")}</Badge>
            ) : null}
            {!canEmbed ? <Badge tone="warn">{t("state.player.unavailable")}</Badge> : null}
          </p>
          <a
            href={info.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-flex max-w-full items-center gap-1 text-sm text-accent-600 underline dark:text-accent-300"
          >
            <span className="truncate">{info.url}</span>
            <ExternalLink className="size-3.5 shrink-0" />
          </a>
        </div>
      </div>
      {canEmbed ? (
        <div>
          <Button
            size="sm"
            variant="secondary"
            icon={<Headphones className="size-4" />}
            onClick={() => setListening((v) => !v)}
            aria-expanded={listening}
          >
            {listening ? t("reference.hidePlayer") : t("link.listenToCheck")}
          </Button>
          {listening ? (
            <div className="mt-2">
              <ReferencePlayer
                platform={info.platform}
                externalId={info.externalId}
                title={info.title ?? PLATFORM_NAMES[info.platform]}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-warn-500">{t("reference.playerUnavailable")}</p>
      )}
      {children}
    </div>
  );
}

function LinkFlow({
  bandId,
  song,
  onPrepared,
}: {
  bandId: string;
  song: SongDto | null;
  onPrepared: (res: PrepareResponse) => void;
}) {
  const { t, i18n } = useTranslation(["autoarrange", "common"]);
  const navigate = useNavigate();
  const { toast } = useToast();
  const identify = useIdentifyReference(bandId);
  const setLink = useSetReferenceLink(bandId, song?.id ?? "");
  const flow = usePrepareFlow(bandId, onPrepared);
  const [url, setUrl] = useState("");
  const [songTitle, setSongTitle] = useState(song?.title ?? "");
  const [artist, setArtist] = useState(song?.reference?.artist ?? song?.artist ?? "");
  // A song whose reference has no link yet most likely gets the link of that same recording.
  const [same, setSame] = useState(!!song?.reference && !song.reference.url);
  const info = identify.data ?? null;
  const problem = identify.isError ? linkProblem(identify.error) : null;
  const knownProblems = [
    "invalid_url",
    "unsupported_platform",
    "unsupported_link",
    "reference_not_found",
  ];

  const onIdentify = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() === "") return;
    identify.mutate(url.trim(), {
      onSuccess: (found) => {
        if (!song) {
          setSongTitle(found.title ?? "");
          setArtist(found.artistGuess ?? "");
        } else if (artist.trim() === "" && found.artistGuess) {
          setArtist(found.artistGuess);
        }
      },
    });
  };

  const onConfirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!info) return;
    if (song?.reference && same) {
      try {
        await setLink.mutateAsync(info.url);
        toast(t("autoarrange:link.saved"), "success");
        navigate(`/bands/${bandId}/songs/${song.id}`);
      } catch (err) {
        toast(t(`common:errors.${errorCode(err)}`), "error");
      }
      return;
    }
    await flow.run({
      ...(song ? { songId: song.id } : { newSong: { title: songTitle.trim() } }),
      recording: {
        source: "link",
        ...(song ? {} : { title: songTitle.trim() }),
        artistCredit: artist.trim() || null,
      },
      referenceUrl: info.url,
      locale: i18n.language.startsWith("pt") ? "pt-BR" : "en",
    });
  };

  return (
    <>
      <Card>
        <StepHeading n={1}>{t("autoarrange:link.heading")}</StepHeading>
        <form
          onSubmit={onIdentify}
          className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
          noValidate
        >
          <Input
            label={t("autoarrange:link.label")}
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://…"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (identify.isError || identify.data) identify.reset();
            }}
            autoFocus
            maxLength={2000}
          />
          <Button
            type="submit"
            size="lg"
            icon={<Link2 className="size-5" />}
            loading={identify.isPending}
            disabled={url.trim() === ""}
          >
            {t("autoarrange:link.identify")}
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted">{t("autoarrange:link.accepted")}</p>
        {problem ? (
          <p
            className="mt-3 rounded-xl border border-danger-500/40 bg-danger-500/5 p-3 text-sm"
            role="alert"
            data-testid="link-problem"
            data-state={problem}
          >
            {knownProblems.includes(problem)
              ? t(`autoarrange:link.problem.${problem}`)
              : t(`common:errors.${errorCode(identify.error)}`)}
          </p>
        ) : null}
      </Card>

      {info ? (
        <Card>
          <StepHeading n={2}>{t("autoarrange:link.confirmHeading")}</StepHeading>
          <LinkPreview info={info}>
            <form
              onSubmit={onConfirm}
              className="flex flex-col gap-3 border-t border-line pt-4"
              noValidate
            >
              {song ? null : (
                <Input
                  label={t("autoarrange:link.songTitle")}
                  value={songTitle}
                  onChange={(e) => setSongTitle(e.target.value)}
                  required
                  maxLength={160}
                  hint={info.platform === "spotify" ? undefined : t("autoarrange:link.titleHint")}
                />
              )}
              <Input
                label={t("autoarrange:reference.artist")}
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                maxLength={200}
                hint={
                  info.artistGuess
                    ? undefined
                    : info.platform === "spotify"
                      ? t("autoarrange:link.artistHintSpotify")
                      : t("autoarrange:link.artistHint")
                }
              />
              {song?.reference ? (
                <fieldset className="flex flex-col gap-2 text-sm" data-testid="same-or-other">
                  <legend className="mb-1 font-medium">
                    {t("autoarrange:link.whichRecording")}
                  </legend>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="which"
                      checked={same}
                      onChange={() => setSame(true)}
                      className="mt-1 accent-[var(--color-accent-500)]"
                    />
                    <span>
                      {t("autoarrange:link.same")}
                      <span className="block text-xs text-muted">
                        {t("autoarrange:link.sameHint")}
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="which"
                      checked={!same}
                      onChange={() => setSame(false)}
                      className="mt-1 accent-[var(--color-accent-500)]"
                    />
                    <span>
                      {t("autoarrange:link.other")}
                      <span className="block text-xs text-muted">
                        {t("autoarrange:link.otherHint")}
                      </span>
                    </span>
                  </label>
                </fieldset>
              ) : null}
              <p className="text-sm text-muted">{t("autoarrange:prepare.explain")}</p>
              <Button
                type="submit"
                size="lg"
                block
                loading={flow.loading || setLink.isPending}
                disabled={!song && songTitle.trim() === ""}
              >
                {song?.reference && same
                  ? t("autoarrange:link.saveLink")
                  : t("autoarrange:link.confirmAndPrepare")}
              </Button>
            </form>
          </LinkPreview>
        </Card>
      ) : null}
      {flow.dialog}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Secondary flow: no link at hand, search the open catalogue          */
/* ------------------------------------------------------------------ */

function CatalogueFlow({
  bandId,
  song,
  onPrepared,
}: {
  bandId: string;
  song: SongDto | null;
  onPrepared: (res: PrepareResponse) => void;
}) {
  const { t, i18n } = useTranslation(["autoarrange", "common"]);
  const [title, setTitle] = useState(song?.title ?? "");
  const [artist, setArtist] = useState(mainArtist(song?.artist));
  const [query, setQuery] = useState<{ title: string; artist: string } | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [releaseMbid, setReleaseMbid] = useState<string>("");
  const [songTitle, setSongTitle] = useState(song?.title ?? "");
  const [manual, setManual] = useState({ artist: "", release: "", year: "" });
  const [linkUrl, setLinkUrl] = useState("");

  const search = useRecordingSearch(bandId, query);
  const mbid = choice?.kind === "musicbrainz" ? choice.candidate.mbid : null;
  const details = useRecordingDetails(bandId, mbid);
  const identify = useIdentifyReference(bandId);
  const flow = usePrepareFlow(bandId, onPrepared);
  const problem = identify.isError ? linkProblem(identify.error) : null;

  useEffect(() => {
    if (details.data) setReleaseMbid(details.data.defaultRelease?.mbid ?? "");
  }, [details.data]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 2) return;
    setChoice(null);
    setQuery({ title: title.trim(), artist: artist.trim() });
  };

  const choose = (c: Choice) => {
    setChoice(c);
    if (!song) setSongTitle(c.kind === "musicbrainz" ? c.candidate.title : title.trim());
  };

  const onPrepare = () => {
    if (!choice) return;
    const recording =
      choice.kind === "musicbrainz"
        ? { source: "musicbrainz", mbid: choice.candidate.mbid, releaseMbid: releaseMbid || null }
        : {
            source: "manual",
            title: (song ? song.title : songTitle) || title.trim(),
            artistCredit: manual.artist.trim() || null,
            releaseTitle: manual.release.trim() || null,
            releaseDate: /^\d{4}$/.test(manual.year.trim()) ? manual.year.trim() : null,
          };
    void flow.run({
      ...(song ? { songId: song.id } : { newSong: { title: songTitle.trim() } }),
      recording,
      referenceUrl: identify.data ? identify.data.url : null,
      locale: i18n.language.startsWith("pt") ? "pt-BR" : "en",
    });
  };

  return (
    <>
      <Card>
        <StepHeading n={1}>{t("autoarrange:search.heading")}</StepHeading>
        <form
          onSubmit={onSearch}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          noValidate
        >
          <Input
            label={t("autoarrange:search.title")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={160}
            autoFocus={!song}
          />
          <Input
            label={t("autoarrange:search.artist")}
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            maxLength={160}
          />
          <Button
            type="submit"
            size="lg"
            icon={<Search className="size-5" />}
            loading={search.isFetching}
            disabled={title.trim().length < 2}
          >
            {t("autoarrange:search.submit")}
          </Button>
        </form>

        {query && !choice ? (
          <div className="mt-5" aria-live="polite">
            {search.isPending ? (
              <LoadingBlock className="py-8" />
            ) : search.isError ? (
              <ErrorBlock error={search.error} onRetry={() => search.refetch()} />
            ) : (
              <>
                <p className="text-sm font-medium">
                  {search.data.length === 0
                    ? t("autoarrange:search.empty")
                    : t("autoarrange:search.results", { count: search.data.length })}
                </p>
                <p className="mb-3 text-xs text-muted">
                  {search.data.length === 0
                    ? t("autoarrange:search.emptyHint")
                    : t("autoarrange:search.versionsHint")}{" "}
                  {t("autoarrange:search.source")}
                </p>
                <ul className="flex flex-col gap-2" data-testid="recording-results">
                  {search.data.map((c) => (
                    <CandidateRow
                      key={c.mbid}
                      candidate={c}
                      onSelect={() => choose({ kind: "musicbrainz", candidate: c })}
                    />
                  ))}
                </ul>
                <Button variant="ghost" className="mt-3" onClick={() => choose({ kind: "manual" })}>
                  {t("autoarrange:search.withoutIdentifier")}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </Card>

      {choice ? (
        <Card>
          <StepHeading n={2}>
            {choice.kind === "musicbrainz"
              ? t("autoarrange:recording.heading")
              : t("autoarrange:recording.manualHeading")}
          </StepHeading>
          {choice.kind === "musicbrainz" ? (
            details.isPending ? (
              <LoadingBlock className="py-8" />
            ) : details.isError ? (
              <ErrorBlock error={details.error} onRetry={() => details.refetch()} />
            ) : (
              <div className="flex flex-col gap-3" data-testid="recording-preview">
                <div>
                  <p className="text-xl font-semibold">{details.data.recording.title}</p>
                  <p className="text-muted">{details.data.recording.artistCredit}</p>
                  {details.data.recording.disambiguation ? (
                    <p className="text-sm text-muted">{details.data.recording.disambiguation}</p>
                  ) : null}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted">{t("autoarrange:recording.composer")}</dt>
                  <dd>
                    {details.data.authors.length > 0 ? (
                      details.data.authors.join(", ")
                    ) : (
                      <span className="text-warn-500">
                        {t("autoarrange:recording.composerUnknown")}
                      </span>
                    )}
                  </dd>
                  <dt className="text-muted">{t("autoarrange:recording.duration")}</dt>
                  <dd>
                    {details.data.recording.durationMs
                      ? formatDuration(Math.round(details.data.recording.durationMs / 1000))
                      : "—"}
                  </dd>
                </dl>
                {details.data.recording.releases.length > 0 ? (
                  <Select
                    label={t("autoarrange:recording.release")}
                    value={releaseMbid}
                    onChange={(e) => setReleaseMbid(e.target.value)}
                  >
                    {details.data.recording.releases.map((r) => (
                      <option key={r.mbid} value={r.mbid}>
                        {r.title}
                        {r.date ? ` (${r.date})` : ""}
                        {r.secondaryTypes.length > 0 ? ` · ${r.secondaryTypes.join(", ")}` : ""}
                      </option>
                    ))}
                  </Select>
                ) : null}
              </div>
            )
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_6rem]">
              <Input
                label={t("autoarrange:recording.manualArtist")}
                value={manual.artist}
                onChange={(e) => setManual({ ...manual, artist: e.target.value })}
                maxLength={200}
              />
              <Input
                label={t("autoarrange:recording.manualRelease")}
                value={manual.release}
                onChange={(e) => setManual({ ...manual, release: e.target.value })}
                maxLength={200}
              />
              <Input
                label={t("autoarrange:recording.manualYear")}
                value={manual.year}
                onChange={(e) => setManual({ ...manual, year: e.target.value })}
                inputMode="numeric"
                maxLength={4}
              />
            </div>
          )}
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => setChoice(null)}>
            {t("autoarrange:recording.change")}
          </Button>

          <div className="mt-5 border-t border-line pt-4">
            <h3 className="mb-2 font-semibold">{t("autoarrange:link.optionalHeading")}</h3>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <Input
                label={t("autoarrange:link.label")}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://…"
                value={linkUrl}
                onChange={(e) => {
                  setLinkUrl(e.target.value);
                  identify.reset();
                }}
                maxLength={2000}
              />
              <Button
                variant="secondary"
                size="lg"
                onClick={() => identify.mutate(linkUrl.trim())}
                loading={identify.isPending}
                disabled={linkUrl.trim() === ""}
              >
                {t("autoarrange:link.identify")}
              </Button>
            </div>
            {problem ? (
              <p
                className="mt-2 text-sm text-danger-500"
                role="alert"
                data-testid="link-problem"
                data-state={problem}
              >
                {t(`autoarrange:link.problem.${problem}`, {
                  defaultValue: t(`common:errors.${errorCode(identify.error)}`),
                })}
              </p>
            ) : null}
            {identify.data ? (
              <div className="mt-3">
                <LinkPreview info={identify.data} testId="link-preview" />
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted">{t("autoarrange:link.accepted")}</p>
            )}
          </div>
        </Card>
      ) : null}

      {choice && (choice.kind === "manual" || details.data) ? (
        <Card>
          <StepHeading n={3}>{t("autoarrange:prepare.heading")}</StepHeading>
          {!song ? (
            <Input
              label={t("autoarrange:prepare.songTitle")}
              value={songTitle}
              onChange={(e) => setSongTitle(e.target.value)}
              required
              maxLength={160}
              className="mb-3"
            />
          ) : null}
          <p className="mb-4 text-sm text-muted">{t("autoarrange:prepare.explain")}</p>
          <Button
            size="lg"
            block
            onClick={onPrepare}
            loading={flow.loading}
            disabled={!song && songTitle.trim() === ""}
          >
            {t("autoarrange:prepare.submit")}
          </Button>
        </Card>
      ) : null}
      {flow.dialog}
    </>
  );
}

function CandidateRow({
  candidate: c,
  onSelect,
}: {
  candidate: RecordingCandidate;
  onSelect: () => void;
}) {
  const { t } = useTranslation("autoarrange");
  const live = isLiveRecording(c);
  const compilationOnly =
    c.releases.length > 0 && c.releases.every((r) => r.secondaryTypes.includes("Compilation"));
  const year = (c.firstReleaseDate ?? "").slice(0, 4);
  const shown = c.releases.slice(0, 2);
  return (
    <li
      className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-elev p-3"
      data-mbid={c.mbid}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {c.title} <span className="font-normal text-muted">· {c.artistCredit || "—"}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
          {year ? <Badge>{year}</Badge> : null}
          <Badge>
            {c.durationMs
              ? formatDuration(Math.round(c.durationMs / 1000))
              : t("search.noDuration")}
          </Badge>
          {live ? <Badge tone="accent">{t("search.live")}</Badge> : null}
          {compilationOnly ? <Badge>{t("search.compilation")}</Badge> : null}
          {c.isVideo ? <Badge>{t("search.video")}</Badge> : null}
        </p>
        <p className={cn("mt-1 text-sm", shown.length === 0 && "hidden")}>
          {shown.map((r) => `${r.title}${r.date ? ` (${r.date.slice(0, 4)})` : ""}`).join(" · ")}
          {c.releases.length > shown.length
            ? ` · ${t("search.moreReleases", { count: c.releases.length - shown.length })}`
            : ""}
        </p>
        {c.disambiguation ? <p className="text-xs text-muted">{c.disambiguation}</p> : null}
      </div>
      <Button variant="secondary" onClick={onSelect}>
        {t("search.select")}
      </Button>
    </li>
  );
}

/** After "prepare": where things stand, the band's own values, and the repertoire. */
function PreparedView({
  bandId,
  songId,
  jobId,
}: {
  bandId: string;
  songId: string;
  jobId: string;
}) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const job = useJob(bandId, jobId);
  const running = !job.data || isRunningJob(job.data.status);
  const overview = useSongAnalysis(bandId, songId, true);
  const qc = useQueryClient();
  const repertoires = useRepertoires(bandId);
  const { toast } = useToast();
  const [repId, setRepId] = useState("");
  const [addedTo, setAddedTo] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Refresh the overview when the pipeline stops running.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch only when the running flag flips
  useEffect(() => {
    if (!running) void overview.refetch();
  }, [running]);

  const addToRepertoire = async () => {
    const rep = repertoires.data?.find((r) => r.id === repId);
    if (!rep) return;
    setAdding(true);
    try {
      await http.post(`/api/bands/${bandId}/repertoires/${rep.id}/items`, { songId });
      await qc.invalidateQueries({ queryKey: repKeys.repertoires(bandId) });
      setAddedTo(rep.name);
    } catch (err) {
      toast(t(`common:errors.${errorCode(err)}`), "error");
    } finally {
      setAdding(false);
    }
  };

  const data = overview.data;
  const reference = data?.song.reference ?? null;
  return (
    <div className="grid gap-6 lg:grid-cols-2" data-testid="prepared" data-running={running}>
      <div className="flex min-w-0 flex-col gap-6">
        {reference ? (
          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t("autoarrange:reference.heading")}</h2>
            <ReferenceSummaryView reference={reference} />
          </Card>
        ) : null}
        <Card>
          <h2 className="mb-3 text-lg font-semibold">{t("autoarrange:arrangement.preparation")}</h2>
          {running || !data ? (
            job.data ? (
              <JobProgress bandId={bandId} job={job.data} />
            ) : (
              <LoadingBlock className="py-6" />
            )
          ) : (
            <>
              <PreparationList bandId={bandId} songId={songId} overview={data} canEdit />
              <details className="mt-4" data-testid="prepare-details">
                <summary className="cursor-pointer text-sm font-semibold">
                  {t("autoarrange:technical.heading")}
                </summary>
                <div className="mt-3 flex flex-col gap-4">
                  {job.data ? <JobProgress bandId={bandId} job={job.data} /> : null}
                  <ResultsList results={data.results} />
                </div>
              </details>
            </>
          )}
        </Card>
      </div>
      {!running && data ? (
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t("autoarrange:arrangement.heading")}</h2>
            <ReviewForm bandId={bandId} song={data.song} overview={data} />
          </Card>
          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t("autoarrange:repertoire.heading")}</h2>
            {repertoires.data && repertoires.data.length > 0 ? (
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <Select
                  label={t("autoarrange:repertoire.choose")}
                  value={repId}
                  onChange={(e) => setRepId(e.target.value)}
                >
                  <option value="">…</option>
                  {repertoires.data.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={addToRepertoire}
                  disabled={!repId}
                  loading={adding}
                >
                  {t("autoarrange:repertoire.add")}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted">{t("autoarrange:repertoire.none")}</p>
            )}
            {addedTo ? (
              <p className="mt-2 text-sm text-ok-500" role="status">
                {t("autoarrange:repertoire.added", { name: addedTo })}
              </p>
            ) : null}
          </Card>
          <div className="flex flex-wrap gap-2">
            <Link to={`/bands/${bandId}/songs/${songId}`}>
              <Button size="lg">{t("autoarrange:done.openSong")}</Button>
            </Link>
            <Link to={`/bands/${bandId}/songs/add`} reloadDocument>
              <Button size="lg" variant="ghost">
                {t("autoarrange:done.another")}
              </Button>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

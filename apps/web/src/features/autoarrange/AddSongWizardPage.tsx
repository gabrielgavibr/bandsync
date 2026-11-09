import { isLiveRecording, isRunningJob, type RecordingCandidate } from "@bandsync/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import {
  Badge,
  Button,
  Card,
  ErrorBlock,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  useToast,
} from "../../components/ui";
import { errorCode, http } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDuration } from "../../lib/format";
import { useCurrentBand } from "../bands/BandLayout";
import { repKeys, useRepertoires, useSong } from "../repertoire/queries";
import { JobProgress, ResultsList, ReviewForm, SourcesCard, YouTubePlayer } from "./parts";
import {
  type PrepareResponse,
  useJob,
  useJobAction,
  usePrepare,
  useRecordingDetails,
  useRecordingSearch,
  useSongAnalysis,
  useYouTubeLookup,
} from "./queries";

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

export function AddSongWizardPage() {
  const { t, i18n } = useTranslation(["autoarrange", "common", "repertoire"]);
  const band = useCurrentBand();
  const [params] = useSearchParams();
  const existingSongId = params.get("song");
  const existing = useSong(band.id, existingSongId);
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [query, setQuery] = useState<{ title: string; artist: string } | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [releaseMbid, setReleaseMbid] = useState<string>("");
  const [songTitle, setSongTitle] = useState("");
  const [manual, setManual] = useState({ artist: "", release: "", year: "" });
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [prepared, setPrepared] = useState<PrepareResponse | null>(null);

  const search = useRecordingSearch(band.id, query);
  const mbid = choice?.kind === "musicbrainz" ? choice.candidate.mbid : null;
  const details = useRecordingDetails(band.id, mbid);
  const youtube = useYouTubeLookup(band.id);
  const prepare = usePrepare(band.id);
  const job = useJob(band.id, prepared?.job.id ?? null);
  const currentJob = job.data ?? prepared?.job ?? null;

  // Existing song: start from its title and main artist.
  useEffect(() => {
    if (existing.data && title === "" && query === null) {
      setTitle(existing.data.song.title);
      setArtist(mainArtist(existing.data.song.artist));
      setSongTitle(existing.data.song.title);
    }
  }, [existing.data, title, query]);

  useEffect(() => {
    if (details.data) setReleaseMbid(details.data.defaultRelease?.mbid ?? "");
  }, [details.data]);

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

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 2) return;
    setChoice(null);
    setQuery({ title: title.trim(), artist: artist.trim() });
  };

  const choose = (c: Choice) => {
    setChoice(c);
    if (!existingSongId) setSongTitle(c.kind === "musicbrainz" ? c.candidate.title : title.trim());
  };

  const onPrepare = async () => {
    if (!choice) return;
    const recording =
      choice.kind === "musicbrainz"
        ? { source: "musicbrainz", mbid: choice.candidate.mbid, releaseMbid: releaseMbid || null }
        : {
            source: "manual",
            title: (existingSongId ? existing.data?.song.title : songTitle) || title.trim(),
            artistCredit: manual.artist.trim() || null,
            releaseTitle: manual.release.trim() || null,
            releaseDate: /^\d{4}$/.test(manual.year.trim()) ? manual.year.trim() : null,
          };
    try {
      const res = await prepare.mutateAsync({
        ...(existingSongId ? { songId: existingSongId } : { newSong: { title: songTitle.trim() } }),
        recording,
        youtubeUrl: youtube.data ? youtube.data.url : null,
        locale: i18n.language.startsWith("pt") ? "pt-BR" : "en",
      });
      setPrepared(res);
    } catch (err) {
      toast(t(`common:errors.${errorCode(err)}`), "error");
    }
  };

  const heading = existingSongId ? t("autoarrange:existingTitle") : t("autoarrange:title");
  const subtitle = existingSongId
    ? t("autoarrange:existingSubtitle", { title: existing.data?.song.title ?? "" })
    : t("autoarrange:subtitle");

  if (prepared && currentJob) {
    return (
      <>
        <PageHeader
          title={prepared.song.title}
          subtitle={prepared.recording.artistCredit ?? undefined}
          backTo={`/bands/${band.id}/songs`}
        />
        <PreparedView bandId={band.id} songId={prepared.song.id} jobId={currentJob.id} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={heading}
        subtitle={subtitle}
        backTo={
          existingSongId ? `/bands/${band.id}/songs/${existingSongId}` : `/bands/${band.id}/songs`
        }
        actions={
          existingSongId ? null : (
            <Link to={`/bands/${band.id}/songs/new`}>
              <Button variant="outline">{t("autoarrange:manual")}</Button>
            </Link>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
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
                autoFocus={!existingSongId}
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
                    <Button
                      variant="ghost"
                      className="mt-3"
                      onClick={() => choose({ kind: "manual" })}
                    >
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
                        <p className="text-sm text-muted">
                          {details.data.recording.disambiguation}
                        </p>
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
                      {details.data.recording.isrcs.length > 0 ? (
                        <>
                          <dt className="text-muted">{t("autoarrange:recording.isrc")}</dt>
                          <dd className="font-mono">{details.data.recording.isrcs.join(", ")}</dd>
                        </>
                      ) : null}
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
                    <p className="text-xs text-muted">{t("autoarrange:recording.linked")}</p>
                    <a
                      href={details.data.recording.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-sm text-accent-600 underline dark:text-accent-300"
                    >
                      {t("autoarrange:recording.openSource")} <ExternalLink className="size-3.5" />
                    </a>
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
                <h3 className="mb-2 font-semibold">{t("autoarrange:youtube.heading")}</h3>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                  <Input
                    label={t("autoarrange:youtube.label")}
                    type="url"
                    inputMode="url"
                    placeholder="https://www.youtube.com/watch?v=…"
                    value={youtubeUrl}
                    onChange={(e) => {
                      setYoutubeUrl(e.target.value);
                      youtube.reset();
                    }}
                    error={youtube.isError ? t("autoarrange:youtube.invalid") : undefined}
                  />
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() => youtube.mutate(youtubeUrl.trim())}
                    loading={youtube.isPending}
                    disabled={youtubeUrl.trim() === ""}
                  >
                    {t("autoarrange:youtube.check")}
                  </Button>
                </div>
                {youtube.data ? (
                  <div className="mt-3" data-testid="youtube-preview">
                    <p className="font-medium">{youtube.data.title}</p>
                    <p className="mb-2 text-sm text-muted">
                      {t("autoarrange:youtube.channel", { name: youtube.data.channelName })}
                    </p>
                    <YouTubePlayer videoId={youtube.data.videoId} title={youtube.data.title} />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1"
                      onClick={() => {
                        youtube.reset();
                        setYoutubeUrl("");
                      }}
                    >
                      {t("autoarrange:youtube.remove")}
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted">{t("autoarrange:youtube.notice")}</p>
                )}
              </div>
            </Card>
          ) : null}

          {choice && (choice.kind === "manual" || details.data) ? (
            <Card>
              <StepHeading n={3}>{t("autoarrange:prepare.heading")}</StepHeading>
              {!existingSongId ? (
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
                size="xl"
                block
                onClick={onPrepare}
                loading={prepare.isPending}
                disabled={!existingSongId && songTitle.trim() === ""}
              >
                {t("autoarrange:prepare.submit")}
              </Button>
            </Card>
          ) : null}
        </div>
        <SourcesCard bandId={band.id} />
      </div>
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

/** Progress of the preparation, then what was found, the band's review and the repertoire choice. */
function PreparedView({
  bandId,
  songId,
  jobId,
}: {
  bandId: string;
  songId: string;
  jobId: string;
}) {
  const { t } = useTranslation(["autoarrange", "common", "repertoire"]);
  const job = useJob(bandId, jobId);
  const running = !job.data || isRunningJob(job.data.status);
  const overview = useSongAnalysis(bandId, songId, true);
  const qc = useQueryClient();
  const action = useJobAction(bandId, songId);
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

  const reference = useMemo(
    () => overview.data?.recordings.find((r) => r.isReference) ?? null,
    [overview.data],
  );

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

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">{t("autoarrange:prepare.heading")}</h2>
          {job.data ? (
            <JobProgress bandId={bandId} job={job.data} />
          ) : (
            <LoadingBlock className="py-6" />
          )}
        </Card>
        {!running && overview.data ? (
          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t("autoarrange:results.heading")}</h2>
            <ResultsList results={overview.data.results} />
          </Card>
        ) : null}
        {!running && reference?.youtube ? (
          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t("autoarrange:panel.listen")}</h2>
            <YouTubePlayer videoId={reference.youtube.videoId} title={reference.youtube.title} />
          </Card>
        ) : null}
      </div>
      {!running && overview.data ? (
        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t("autoarrange:review.heading")}</h2>
            <ReviewForm bandId={bandId} song={overview.data.song} overview={overview.data} />
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
            {job.data?.status === "awaiting_review" ? (
              <Button
                size="lg"
                onClick={() => action.mutate({ jobId, action: "complete" })}
                loading={action.isPending}
              >
                {t("autoarrange:job.complete")}
              </Button>
            ) : null}
            <Link to={`/bands/${bandId}/songs/${songId}`}>
              <Button size="lg" variant="secondary">
                {t("autoarrange:done.openSong")}
              </Button>
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

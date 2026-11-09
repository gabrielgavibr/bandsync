import { ExternalLink, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge, Button, Card } from "../../components/ui";
import { formatDateTime, formatDuration } from "../../lib/format";
import { JobProgress, ResultsList, ReviewForm, YouTubePlayer } from "./parts";
import { useSongAnalysis } from "./queries";

/**
 * AutoArrange on the song sheet: the identified reference recording, the latest preparation,
 * what was found (each with origin, method and review state) and the band's own confirmations.
 */
export function AutoArrangePanel({
  bandId,
  songId,
  canEdit,
}: {
  bandId: string;
  songId: string;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation("autoarrange");
  const overview = useSongAnalysis(bandId, songId, true);
  const [playing, setPlaying] = useState(false);
  if (!overview.data) return null;
  const { recordings, jobs, results, reviews, song } = overview.data;
  const reference = recordings.find((r) => r.isReference) ?? null;
  const latestJob = jobs[0] ?? null;
  const wizard = `/bands/${bandId}/songs/add?song=${songId}`;

  return (
    <Card data-testid="autoarrange-panel">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4 text-accent-500" /> {t("panel.heading")}
        </h2>
        {canEdit ? (
          <Link to={wizard}>
            <Button size="sm" variant="secondary">
              {reference ? t("panel.prepareAgain") : t("panel.identify")}
            </Button>
          </Link>
        ) : null}
      </div>

      {reference ? (
        <div className="rounded-xl bg-sunken p-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted">{t("recording.heading")}</p>
          <p className="font-medium">
            {reference.title}
            {reference.artistCredit ? (
              <span className="font-normal text-muted"> · {reference.artistCredit}</span>
            ) : null}
          </p>
          <p className="text-muted">
            {[
              reference.releaseTitle,
              reference.releaseDate?.slice(0, 4),
              reference.durationMs ? formatDuration(Math.round(reference.durationMs / 1000)) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {reference.disambiguation ? (
            <p className="text-xs text-muted">{reference.disambiguation}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {reference.sourceUrl ? (
              <a
                href={reference.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-accent-600 underline dark:text-accent-300"
              >
                {t("recording.openSource")} <ExternalLink className="size-3.5" />
              </a>
            ) : null}
            {reference.youtube ? (
              <Button size="sm" variant="ghost" onClick={() => setPlaying((v) => !v)}>
                {playing ? t("panel.hidePlayer") : t("panel.listen")}
              </Button>
            ) : null}
          </div>
          {playing && reference.youtube ? (
            <div className="mt-2">
              <YouTubePlayer videoId={reference.youtube.videoId} title={reference.youtube.title} />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">{t("panel.noRecording")}</p>
      )}

      {latestJob ? (
        <details className="mt-4" open={latestJob.status !== "completed"}>
          <summary className="cursor-pointer text-sm font-semibold">
            {t("panel.lastJob")}{" "}
            <Badge className="ml-1">{t(`job.status.${latestJob.status}`)}</Badge>
          </summary>
          <div className="mt-3">
            <JobProgress bandId={bandId} job={latestJob} />
          </div>
        </details>
      ) : null}

      {reference || results.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">{t("results.heading")}</h3>
          <ResultsList results={results} />
        </div>
      ) : null}

      {canEdit ? (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="mb-2 text-sm font-semibold">{t("review.heading")}</h3>
          <ReviewForm bandId={bandId} song={song} overview={overview.data} />
        </div>
      ) : null}

      {reviews.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold">
            {t("panel.history")} ({reviews.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
            {reviews.map((r) => (
              <li key={r.id}>
                {t(
                  `review.${r.target === "band_bpm" ? "bpm" : r.target === "band_key" ? "key" : "meter"}`,
                )}
                : {JSON.stringify(r.after)} ·{" "}
                {t("panel.changed", {
                  name: r.userName ?? "—",
                  date: formatDateTime(r.createdAt, i18n.language),
                })}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

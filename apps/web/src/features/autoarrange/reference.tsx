import {
  type ReferencePlatform,
  referenceEmbedUrl,
  type SongDto,
  type SongReferenceSummary,
} from "@bandsync/shared";
import { ExternalLink, Headphones, Link2, Music2, Pencil } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge, Button, Card, Dialog, Input, useToast } from "../../components/ui";
import { cn } from "../../lib/cn";
import { errorText } from "../../lib/errors";
import { formatDuration } from "../../lib/format";
import { useEditReference } from "./queries";

export const PLATFORM_NAMES: Record<ReferencePlatform, string> = {
  youtube: "YouTube",
  youtube_music: "YouTube Music",
  spotify: "Spotify",
};

export function PlatformBadge({ platform }: { platform: ReferencePlatform }) {
  return (
    <Badge tone="accent" data-platform={platform}>
      {PLATFORM_NAMES[platform]}
    </Badge>
  );
}

/**
 * The platform's own embedded player. The address is built from platform and id only, and the
 * frame is sandboxed. Audio and video never leave the platform: nothing is downloaded or relayed.
 */
export function ReferencePlayer({
  platform,
  externalId,
  title,
}: {
  platform: ReferencePlatform;
  externalId: string;
  title: string;
}) {
  const { t } = useTranslation("autoarrange");
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-xl bg-black",
        platform === "spotify" ? "h-[152px]" : "aspect-video",
      )}
      data-testid="reference-player"
    >
      <iframe
        src={referenceEmbedUrl(platform, externalId)}
        title={`${t("reference.player", { platform: PLATFORM_NAMES[platform] })}: ${title}`}
        className="size-full border-0"
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
        allow="encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    </div>
  );
}

/** Cover or thumbnail, straight from the platform's image host; a neutral tile when there is none. */
export function ReferenceThumb({ url, className }: { url: string | null; className?: string }) {
  // An image the device cannot load (offline, blocked host) falls back to the neutral tile.
  const [failed, setFailed] = useState<string | null>(null);
  return url && failed !== url ? (
    <img
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(url)}
      className={cn("shrink-0 rounded-lg bg-sunken object-cover", className)}
    />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-sunken text-muted",
        className,
      )}
    >
      <Music2 className="size-6" />
    </span>
  );
}

function metaLine(r: SongReferenceSummary): string {
  return [
    r.releaseTitle,
    r.year,
    r.durationMs ? formatDuration(Math.round(r.durationMs / 1000)) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Listen here (official player) or open the recording on its platform. Local to each device. */
export function ReferenceListen({ reference }: { reference: SongReferenceSummary }) {
  const { t } = useTranslation("autoarrange");
  const [playing, setPlaying] = useState(false);
  if (!reference.platform || !reference.externalId || !reference.url) return null;
  const canEmbed = reference.embeddable !== false;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canEmbed ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<Headphones className="size-4" />}
            onClick={() => setPlaying((v) => !v)}
            aria-expanded={playing}
          >
            {playing ? t("reference.hidePlayer") : t("reference.listen")}
          </Button>
        ) : null}
        <a
          href={reference.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-accent-600 underline dark:text-accent-300"
        >
          {t("reference.openOriginal")} <ExternalLink className="size-3.5" />
        </a>
      </div>
      {!canEmbed ? (
        <p className="text-sm text-warn-500" data-testid="player-unavailable">
          {t("reference.playerUnavailable")}
        </p>
      ) : null}
      {playing && canEmbed ? (
        <ReferencePlayer
          platform={reference.platform}
          externalId={reference.externalId}
          title={reference.title}
        />
      ) : null}
    </div>
  );
}

/** Title, artist and where it lives. The same for every member. */
export function ReferenceSummaryView({
  reference,
  size = "md",
}: {
  reference: SongReferenceSummary;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation("autoarrange");
  const meta = metaLine(reference);
  return (
    <div className="flex min-w-0 items-start gap-3">
      <ReferenceThumb
        url={reference.thumbnailUrl}
        className={size === "sm" ? "size-12" : "size-20 sm:size-24"}
      />
      <div className="min-w-0 flex-1">
        <p className={cn("font-semibold leading-snug", size === "md" && "text-lg")}>
          {reference.title}
        </p>
        <p className="text-sm text-muted">{reference.artist ?? t("reference.artistUnknown")}</p>
        {meta ? <p className="text-sm text-muted">{meta}</p> : null}
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {reference.platform ? (
            <PlatformBadge platform={reference.platform} />
          ) : (
            <Badge tone="warn">{t("reference.linkPending")}</Badge>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * First block of the song sheet: the one recording the whole band studies from.
 * Changing it goes through the add-song flow, which asks before replacing a recording that
 * confirmed values or arrangement work depend on.
 */
export function ReferenceBlock({
  bandId,
  song,
  canEdit,
}: {
  bandId: string;
  song: SongDto;
  canEdit: boolean;
}) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const [editing, setEditing] = useState(false);
  const reference = song.reference;
  const wizard = `/bands/${bandId}/songs/add?song=${song.id}`;
  const state = !reference ? "none" : reference.url ? "identified" : "link_pending";

  return (
    <Card data-testid="reference-block" data-state={state}>
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <Headphones className="size-4 text-accent-500" /> {t("autoarrange:reference.heading")}
      </h2>
      {reference ? (
        <div className="flex flex-col gap-3">
          <ReferenceSummaryView reference={reference} />
          {reference.url ? (
            <ReferenceListen reference={reference} />
          ) : (
            <p className="rounded-xl border border-dashed border-warn-500/60 bg-warn-500/5 p-3 text-sm">
              {t("autoarrange:reference.linkPendingBody")}
            </p>
          )}
          {canEdit ? (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Link to={wizard}>
                <Button size="sm" variant="secondary" icon={<Link2 className="size-4" />}>
                  {reference.url
                    ? t("autoarrange:reference.change")
                    : t("autoarrange:reference.addLink")}
                </Button>
              </Link>
              <Button
                size="sm"
                variant="ghost"
                icon={<Pencil className="size-4" />}
                onClick={() => setEditing(true)}
              >
                {t("autoarrange:reference.fix")}
              </Button>
            </div>
          ) : null}
          <p className="text-xs text-muted">{t("autoarrange:reference.shared")}</p>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted">{t("autoarrange:reference.none")}</p>
          {song.version.referenceUrl ? (
            // A link typed before references existed: shown as it is, not yet identified.
            <a
              href={song.version.referenceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex max-w-full items-center gap-1 truncate text-sm text-accent-600 underline dark:text-accent-300"
            >
              {t("autoarrange:reference.legacyLink")} <ExternalLink className="size-3.5" />
            </a>
          ) : null}
          {canEdit ? (
            <Link to={wizard}>
              <Button icon={<Link2 className="size-4" />}>{t("autoarrange:reference.set")}</Button>
            </Link>
          ) : null}
        </div>
      )}
      {reference ? (
        <EditReferenceDialog
          open={editing}
          onClose={() => setEditing(false)}
          bandId={bandId}
          songId={song.id}
          reference={reference}
        />
      ) : null}
    </Card>
  );
}

function EditReferenceDialog({
  open,
  onClose,
  bandId,
  songId,
  reference,
}: {
  open: boolean;
  onClose: () => void;
  bandId: string;
  songId: string;
  reference: SongReferenceSummary;
}) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const edit = useEditReference(bandId, songId);
  const { toast } = useToast();
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") ?? "").trim();
    const artist = String(fd.get("artist") ?? "").trim();
    if (!title) return;
    try {
      await edit.mutateAsync({ title, artistCredit: artist || null });
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t("autoarrange:reference.fix")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-muted">{t("autoarrange:reference.fixHint")}</p>
        <Input
          name="title"
          label={t("autoarrange:reference.recordingTitle")}
          defaultValue={reference.title}
          required
          maxLength={160}
        />
        <Input
          name="artist"
          label={t("autoarrange:reference.artist")}
          defaultValue={reference.artist ?? ""}
          maxLength={200}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common:actions.cancel")}
          </Button>
          <Button type="submit" loading={edit.isPending}>
            {t("common:actions.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** One line for lists: opens the recording on its platform. */
export function ReferenceOpenLink({
  reference,
  className,
}: {
  reference: SongReferenceSummary | null;
  className?: string;
}) {
  const { t } = useTranslation("autoarrange");
  if (!reference?.url || !reference.platform) return null;
  return (
    <a
      href={reference.url}
      target="_blank"
      rel="noreferrer noopener"
      title={t("reference.openOn", { platform: PLATFORM_NAMES[reference.platform] })}
      aria-label={`${t("reference.openOn", { platform: PLATFORM_NAMES[reference.platform] })}: ${reference.title}`}
      data-testid="reference-open"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-accent-600 hover:bg-elev dark:text-accent-300",
        className,
      )}
    >
      <Headphones className="size-4" />
    </a>
  );
}

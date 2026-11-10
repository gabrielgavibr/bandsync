import { ChevronRight, Headphones, ListMusic, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  Button,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  RowList,
  rowClass,
} from "../../components/ui";
import { ReferenceThumb } from "../autoarrange/reference";
import { useCurrentBand } from "../bands/BandLayout";
import { useSongs } from "./queries";

export function SongsPage() {
  const { t } = useTranslation(["repertoire", "common"]);
  const band = useCurrentBand();
  const songs = useSongs(band.id);
  const [q, setQ] = useState("");
  const canEdit = band.myPermissions.canEditRepertoire;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!songs.data) return [];
    if (!needle) return songs.data;
    return songs.data.filter(
      (s) =>
        s.title.toLowerCase().includes(needle) || (s.artist ?? "").toLowerCase().includes(needle),
    );
  }, [songs.data, q]);

  return (
    <>
      <PageHeader
        title={t("repertoire:songs.title")}
        subtitle={t("repertoire:songs.subtitle")}
        actions={
          canEdit ? (
            <Link to={`/bands/${band.id}/songs/add`}>
              <Button icon={<Plus className="size-4" />}>{t("repertoire:songs.add")}</Button>
            </Link>
          ) : null
        }
      />
      {songs.isPending ? (
        <LoadingBlock />
      ) : songs.isError ? (
        <ErrorBlock error={songs.error} onRetry={() => songs.refetch()} />
      ) : songs.data.length === 0 ? (
        <EmptyState
          title={t("repertoire:songs.empty")}
          body={t("repertoire:songs.emptyHint")}
          action={
            canEdit ? (
              <Link to={`/bands/${band.id}/songs/add`}>
                <Button icon={<Plus className="size-4" />}>{t("repertoire:songs.add")}</Button>
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <label className="mb-3 flex h-11 items-center gap-2 rounded-xl border border-line bg-elev px-3.5">
            <Search className="size-4 text-muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("repertoire:songs.search")}
              className="w-full bg-transparent outline-none placeholder:text-muted/70"
              aria-label={t("common:actions.search")}
            />
          </label>
          {filtered.length === 0 ? (
            <p className="text-muted">{t("repertoire:songs.noResults")}</p>
          ) : (
            <RowList data-testid="song-list">
              {filtered.map((s) => {
                const count = s.materialSummary.reduce((n, m) => n + m.count, 0);
                return (
                  <li key={s.id}>
                    <Link
                      to={`/bands/${band.id}/songs/${s.id}`}
                      className={rowClass}
                      data-testid="song-row"
                    >
                      <ReferenceThumb url={s.reference?.thumbnailUrl ?? null} className="size-10" />
                      <span className="min-w-0 flex-1">
                        {/* Long names stay readable: two lines before cutting. */}
                        <span className="line-clamp-2 break-words font-medium leading-snug">
                          {s.title}
                        </span>
                        <span className="block truncate text-sm text-muted">{s.artist ?? "—"}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted">
                        {s.version.bpm ? (
                          <span className="font-medium tabular-nums text-fg" data-testid="song-bpm">
                            {s.version.bpm} BPM
                          </span>
                        ) : (
                          <span className="text-warn-500">{t("repertoire:songs.bpmPending")}</span>
                        )}
                        <span className="flex items-center gap-1.5">
                          {s.version.key ? <span>{s.version.key}</span> : null}
                          {s.reference ? (
                            <Headphones
                              className="size-3.5 text-accent-500"
                              aria-label={t("repertoire:songs.hasReference")}
                            />
                          ) : null}
                          {s.sections.length > 0 ? (
                            <ListMusic
                              className="size-3.5 text-accent-500"
                              aria-label={t("repertoire:songs.hasArrangement")}
                            />
                          ) : null}
                          <span className="hidden sm:inline">
                            {t("repertoire:songs.materials", { count })}
                          </span>
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </RowList>
          )}
        </>
      )}
    </>
  );
}

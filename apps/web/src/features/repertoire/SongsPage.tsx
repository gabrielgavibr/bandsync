import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
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
          <label className="mb-4 flex h-12 items-center gap-2 rounded-xl border border-line bg-elev px-3.5">
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
            <ul className="grid gap-2">
              {filtered.map((s) => {
                const count = s.materialSummary.reduce((n, m) => n + m.count, 0);
                return (
                  <li key={s.id}>
                    <Link to={`/bands/${band.id}/songs/${s.id}`}>
                      <Card className="flex items-center gap-4 py-3 transition-colors hover:border-accent-500/60">
                        <ReferenceThumb
                          url={s.reference?.thumbnailUrl ?? null}
                          className="size-11"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{s.title}</p>
                          <p className="truncate text-sm text-muted">{s.artist ?? "—"}</p>
                        </div>
                        <div className="hidden items-center gap-2 text-sm text-muted sm:flex">
                          {s.version.key ? <Badge>{s.version.key}</Badge> : null}
                          {s.version.bpm ? <Badge>{s.version.bpm} BPM</Badge> : null}
                          <Badge>
                            {s.version.beatsPerBar}/{s.version.beatUnit}
                          </Badge>
                        </div>
                        <span className="text-sm text-muted">
                          {t("repertoire:songs.materials", { count })}
                        </span>
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}

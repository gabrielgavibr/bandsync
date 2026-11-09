import { ArrowDown, ArrowUp, Plus, Radio, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  useToast,
} from "../../components/ui";
import { errorText } from "../../lib/errors";
import { ReferenceOpenLink } from "../autoarrange/reference";
import { useCurrentBand } from "../bands/BandLayout";
import { useRepertoire, useRepertoireMutations, useSongs } from "./queries";

export function RepertoireDetailPage() {
  const { repertoireId = "" } = useParams();
  const { t } = useTranslation(["repertoire", "common"]);
  const band = useCurrentBand();
  const navigate = useNavigate();
  const { toast } = useToast();
  const rep = useRepertoire(band.id, repertoireId);
  const songs = useSongs(band.id);
  const { addItem, removeItem, reorder, remove } = useRepertoireMutations(band.id, repertoireId);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const canEdit = band.myPermissions.canEditRepertoire;
  const fail = (err: unknown) => toast(errorText(err), "error");

  if (rep.isPending) return <LoadingBlock />;
  if (rep.isError) return <ErrorBlock error={rep.error} onRetry={() => rep.refetch()} />;
  const items = rep.data.items ?? [];
  const inList = new Set(items.map((i) => i.songId));
  const available = (songs.data ?? []).filter((s) => !inList.has(s.id));

  const move = (index: number, dir: -1 | 1) => {
    const ids = items.map((i) => i.songId);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    reorder.mutate(ids, { onError: fail });
  };

  return (
    <>
      <PageHeader
        title={rep.data.name}
        subtitle={
          rep.data.description ??
          t(`repertoire:repertoires.kinds.${rep.data.kind}`, { defaultValue: rep.data.kind })
        }
        backTo={`/bands/${band.id}/repertoires`}
        actions={
          <>
            {band.myPermissions.canControlRehearsal ? (
              <Link to={`/bands/${band.id}/rehearsal?repertoire=${rep.data.id}`}>
                <Button icon={<Radio className="size-4" />}>
                  {t("repertoire:repertoires.startRehearsal")}
                </Button>
              </Link>
            ) : null}
            {canEdit ? (
              <>
                <Button
                  variant="secondary"
                  icon={<Plus className="size-4" />}
                  onClick={() => setAdding(true)}
                >
                  {t("repertoire:repertoires.addSong")}
                </Button>
                <Button
                  variant="ghost"
                  icon={<Trash2 className="size-4" />}
                  onClick={() => setDeleting(true)}
                  aria-label={t("common:actions.delete")}
                />
              </>
            ) : null}
          </>
        }
      />
      {items.length === 0 ? (
        <p className="text-muted">{t("repertoire:repertoires.emptyList")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((it, i) => (
            <li key={it.id}>
              <Card className="flex items-center gap-3 py-3">
                <span className="w-7 text-center font-mono text-sm text-muted">{i + 1}</span>
                <Link to={`/bands/${band.id}/songs/${it.songId}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium">{it.song.title}</p>
                  <p className="truncate text-sm text-muted">
                    {it.song.artist ?? "—"}
                    {it.notes ? ` · ${it.notes}` : ""}
                  </p>
                </Link>
                <span className="hidden gap-1 sm:flex">
                  {it.song.key ? <Badge>{it.song.key}</Badge> : null}
                  {it.song.bpm ? <Badge>{it.song.bpm} BPM</Badge> : null}
                </span>
                <ReferenceOpenLink reference={it.song.reference} />
                {canEdit ? (
                  <span className="flex items-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("repertoire:repertoires.moveUp")}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      icon={<ArrowUp className="size-4" />}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("repertoire:repertoires.moveDown")}
                      disabled={i === items.length - 1}
                      onClick={() => move(i, 1)}
                      icon={<ArrowDown className="size-4" />}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("repertoire:repertoires.removeFromList")}
                      onClick={() => removeItem.mutate(it.songId, { onError: fail })}
                      icon={<X className="size-4" />}
                    />
                  </span>
                ) : null}
              </Card>
            </li>
          ))}
        </ol>
      )}
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={t("repertoire:repertoires.addSongTitle", { name: rep.data.name })}
      >
        {available.length === 0 ? (
          <p className="text-muted">{t("repertoire:repertoires.noMoreSongs")}</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {available.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.title}</p>
                  <p className="truncate text-sm text-muted">{s.artist ?? "—"}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => addItem.mutate(s.id, { onError: fail })}
                  loading={addItem.isPending && addItem.variables === s.id}
                >
                  {t("common:actions.add")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={t("common:confirm.deleteTitle")}
        body={t("repertoire:repertoires.deleteConfirm", { name: rep.data.name })}
        danger
        loading={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync();
            navigate(`/bands/${band.id}/repertoires`);
          } catch (err) {
            fail(err);
          }
        }}
      />
    </>
  );
}

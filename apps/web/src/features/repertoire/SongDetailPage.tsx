import type { Notation, SongMaterialDto } from "@bandsync/shared";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { errorCode } from "../../lib/api";
import { cn } from "../../lib/cn";
import { resolvePreferredMaterial } from "../../lib/materials";
import { useAuth } from "../auth/AuthProvider";
import { useCurrentBand } from "../bands/BandLayout";
import { useMembers } from "../bands/queries";
import { MaterialEditor } from "./MaterialEditor";
import { MaterialViewer } from "./MaterialViewer";
import { useDeleteMaterial, useDeleteSong, useSong } from "./queries";

export function SongDetailPage() {
  const { songId = "" } = useParams();
  const { t } = useTranslation(["repertoire", "common"]);
  const band = useCurrentBand();
  const { user, preferences } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const q = useSong(band.id, songId);
  const members = useMembers(band.id);
  const del = useDeleteSong(band.id);
  const delMaterial = useDeleteMaterial(band.id, songId);
  const [editing, setEditing] = useState<SongMaterialDto | null | "new">(null);
  const [deleting, setDeleting] = useState(false);
  const [deletingMaterial, setDeletingMaterial] = useState<SongMaterialDto | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canEdit = band.myPermissions.canEditRepertoire;

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  const { song, materials } = q.data;
  const myInstrument =
    members.data?.find((m) => m.userId === user?.id)?.instrument ?? user?.primaryInstrument ?? null;
  const preferred = resolvePreferredMaterial(
    materials,
    myInstrument,
    preferences?.materialPreferences,
  );
  const selected = materials.find((m) => m.id === selectedId) ?? preferred;

  return (
    <>
      <PageHeader
        title={song.title}
        subtitle={song.artist ?? undefined}
        backTo={`/bands/${band.id}/songs`}
        actions={
          canEdit ? (
            <>
              <Link to={`/bands/${band.id}/songs/${song.id}/edit`}>
                <Button variant="secondary" icon={<Pencil className="size-4" />}>
                  {t("common:actions.edit")}
                </Button>
              </Link>
              <Button
                variant="ghost"
                icon={<Trash2 className="size-4" />}
                onClick={() => setDeleting(true)}
              >
                {t("common:actions.delete")}
              </Button>
            </>
          ) : null
        }
      />
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 font-semibold">{t("repertoire:song.bandVersion")}</h2>
            <dl className="grid grid-cols-3 gap-3 text-center">
              <Stat
                label={t("common:music.bpm")}
                value={song.version.bpm ?? "—"}
                sub={
                  song.originalBpm
                    ? `${t("repertoire:song.original")}: ${song.originalBpm}`
                    : undefined
                }
              />
              <Stat
                label={t("common:music.key")}
                value={song.version.key ?? "—"}
                sub={
                  song.originalKey
                    ? `${t("repertoire:song.original")}: ${song.originalKey}`
                    : undefined
                }
              />
              <Stat
                label={t("common:music.timeSignature")}
                value={`${song.version.beatsPerBar}/${song.version.beatUnit}`}
              />
            </dl>
            {song.version.notes ? (
              <p className="mt-4 whitespace-pre-wrap text-sm text-muted">{song.version.notes}</p>
            ) : null}
            {song.version.referenceUrl ? (
              <a
                href={song.version.referenceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block truncate text-sm text-accent-600 underline dark:text-accent-300"
              >
                {song.version.referenceUrl}
              </a>
            ) : null}
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold">{t("repertoire:sections.title")}</h2>
            {song.sections.length === 0 ? (
              <p className="text-sm text-muted">{t("repertoire:sections.empty")}</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {song.sections.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-baseline justify-between gap-3 rounded-lg bg-sunken px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted">{t("common:music.bars", { count: s.bars })}</span>
                    {s.notes ? (
                      <span className="basis-full text-xs text-muted">{s.notes}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
        <Card className="flex min-h-[50vh] flex-col p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <h2 className="mr-auto font-semibold">{t("repertoire:materials.title")}</h2>
            {canEdit ? (
              <Button
                size="sm"
                icon={<Plus className="size-4" />}
                onClick={() => setEditing("new")}
              >
                {t("repertoire:materials.add")}
              </Button>
            ) : null}
          </div>
          {materials.length === 0 ? (
            <p className="p-6 text-muted">{t("repertoire:materials.empty")}</p>
          ) : (
            <>
              <div className="flex gap-2 overflow-x-auto border-b border-line p-3">
                {materials.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className={cn(
                      "flex shrink-0 flex-col items-start rounded-xl border px-3 py-2 text-left text-sm",
                      selected?.id === m.id
                        ? "border-accent-500 bg-accent-500/10"
                        : "border-line hover:bg-sunken",
                    )}
                  >
                    <span className="font-medium">{m.title}</span>
                    <span className="text-xs text-muted">
                      {t(`common:materialType.${m.type}`)}
                      {m.instrument ? ` · ${t(`common:instrument.${m.instrument}`)}` : ""} ·{" "}
                      {t("repertoire:materials.version", { version: m.version })}
                    </span>
                  </button>
                ))}
              </div>
              {selected ? (
                <>
                  <div className="flex items-center gap-2 px-3 pt-3">
                    {selected.id === preferred?.id ? (
                      <Badge tone="accent">
                        {t("rehearsal:member.material", { ns: "rehearsal" })}
                      </Badge>
                    ) : null}
                    {canEdit ? (
                      <span className="ml-auto flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(selected)}
                          icon={<Pencil className="size-4" />}
                        >
                          {t("common:actions.edit")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingMaterial(selected)}
                          icon={<Trash2 className="size-4" />}
                        >
                          {t("common:actions.delete")}
                        </Button>
                      </span>
                    ) : null}
                  </div>
                  <MaterialViewer
                    material={selected}
                    options={{
                      zoom: 1,
                      notation: (preferences?.notation as Notation) ?? "english",
                    }}
                  />
                </>
              ) : null}
            </>
          )}
        </Card>
      </div>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? t("repertoire:materials.add") : t("repertoire:materials.edit")}
      >
        {editing !== null ? (
          <MaterialEditor
            bandId={band.id}
            songId={song.id}
            material={editing === "new" ? null : editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={t("common:confirm.deleteTitle")}
        body={t("repertoire:song.deleteConfirm", { title: song.title })}
        danger
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(song.id);
            navigate(`/bands/${band.id}/songs`);
          } catch (err) {
            toast(t(`common:errors.${errorCode(err)}`), "error");
          }
        }}
      />
      <ConfirmDialog
        open={!!deletingMaterial}
        onClose={() => setDeletingMaterial(null)}
        title={t("common:confirm.deleteTitle")}
        body={t("repertoire:materials.deleteConfirm")}
        danger
        loading={delMaterial.isPending}
        onConfirm={async () => {
          if (!deletingMaterial) return;
          try {
            await delMaterial.mutateAsync(deletingMaterial.id);
            setDeletingMaterial(null);
            setSelectedId(null);
          } catch (err) {
            toast(t(`common:errors.${errorCode(err)}`), "error");
          }
        }}
      />
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl bg-sunken p-3">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-semibold">{value}</dd>
      {sub ? <dd className="mt-0.5 text-[11px] text-muted">{sub}</dd> : null}
    </div>
  );
}

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
import { cn } from "../../lib/cn";
import { errorText } from "../../lib/errors";
import { resolvePreferredMaterial } from "../../lib/materials";
import { InstrumentViews, viewFor } from "../arrangement/InstrumentViews";
import { useAuth } from "../auth/AuthProvider";
import { BandArrangementCard, TechnicalDetails } from "../autoarrange/arrangement";
import { ReferenceBlock } from "../autoarrange/reference";
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[26rem_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <ReferenceBlock bandId={band.id} song={song} canEdit={canEdit} />
          <BandArrangementCard
            bandId={band.id}
            song={song}
            materials={materials}
            canEdit={canEdit}
          />
          {song.sections.length > 0 ? (
            <InstrumentViews
              song={song}
              materials={materials}
              initial={viewFor(user?.primaryInstrument)}
            />
          ) : null}
        </div>
        <Card className="flex min-h-[50vh] min-w-0 flex-col p-0">
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
                      {m.status === "pending"
                        ? ` · ${t("repertoire:materials.statusPending")}`
                        : ""}
                      {m.isExample ? ` · ${t("repertoire:materials.example")}` : ""}
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
                    onAddMaterial={canEdit ? () => setEditing(selected) : undefined}
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
      <TechnicalDetails bandId={band.id} song={song} canEdit={canEdit} />

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
            toast(errorText(err), "error");
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
            toast(errorText(err), "error");
          }
        }}
      />
    </>
  );
}

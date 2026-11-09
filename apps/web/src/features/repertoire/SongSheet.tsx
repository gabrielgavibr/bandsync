import type { FactStatus, SongDto, SongMaterialDto } from "@bandsync/shared";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  Input,
  Select,
  useToast,
} from "../../components/ui";
import { errorText } from "../../lib/errors";
import { formatDuration } from "../../lib/format";
import { useAddReference, useDeleteReference } from "./queries";

const KINDS = [
  "official_video",
  "official_audio",
  "metadata",
  "chords",
  "tabs",
  "lyrics",
  "article",
  "other",
] as const;

function statusTone(s: FactStatus): "ok" | "warn" | "neutral" {
  return s === "confirmed" ? "ok" : s === "estimated" ? "warn" : "neutral";
}

/** Identity of the song: who wrote it, which recording is the reference, and the two versions side by side. */
export function SongSheet({ song }: { song: SongDto }) {
  const { t } = useTranslation(["repertoire", "common"]);
  const pending = <span className="text-warn-500">{t("repertoire:song.bandPending")}</span>;
  const refValue = (value: string | number | null, status: FactStatus) =>
    value === null || value === "" ? (
      <Badge tone="neutral">{t("repertoire:song.factStatus.unknown")}</Badge>
    ) : (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold">{value}</span>
        <Badge tone={statusTone(status)}>{t(`repertoire:song.factStatus.${status}`)}</Badge>
      </span>
    );
  const meter = `${song.version.beatsPerBar}/${song.version.beatUnit}`;
  return (
    <Card>
      <h2 className="mb-3 font-semibold">{t("repertoire:song.sheet")}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">{t("repertoire:song.fields.title")}</dt>
        <dd className="font-medium">{song.title}</dd>
        <dt className="text-muted">{t("repertoire:song.fields.composer")}</dt>
        <dd>{song.composer ?? "—"}</dd>
        <dt className="text-muted">{t("repertoire:song.fields.referenceArtist")}</dt>
        <dd>{song.artist ?? "—"}</dd>
        <dt className="text-muted">{t("repertoire:song.fields.referenceRecording")}</dt>
        <dd>
          {song.referenceRecording ?? (
            <span className="text-warn-500">{t("repertoire:song.factStatus.unknown")}</span>
          )}
          {song.referenceYear ? ` (${song.referenceYear})` : ""}
        </dd>
        {song.durationSeconds ? (
          <>
            <dt className="text-muted">{t("repertoire:song.fields.duration")}</dt>
            <dd>{formatDuration(song.durationSeconds)}</dd>
          </>
        ) : null}
      </dl>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3 font-medium" scope="col">
                <span className="sr-only">{t("repertoire:song.details")}</span>
              </th>
              <th className="py-1.5 pr-3 font-medium" scope="col">
                {t("repertoire:song.compare.reference")}
              </th>
              <th className="py-1.5 font-medium" scope="col">
                {t("repertoire:song.compare.band")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr>
              <th scope="row" className="py-2 pr-3 font-medium text-muted">
                {t("common:music.bpm")}
              </th>
              <td className="py-2 pr-3">{refValue(song.originalBpm, song.originalBpmStatus)}</td>
              <td className="py-2 font-semibold">{song.version.bpm ?? pending}</td>
            </tr>
            <tr>
              <th scope="row" className="py-2 pr-3 font-medium text-muted">
                {t("common:music.key")}
              </th>
              <td className="py-2 pr-3">{refValue(song.originalKey, song.originalKeyStatus)}</td>
              <td className="py-2 font-semibold">{song.version.key ?? pending}</td>
            </tr>
            <tr>
              <th scope="row" className="py-2 pr-3 font-medium text-muted">
                {t("common:music.timeSignature")}
              </th>
              <td className="py-2 pr-3">
                {refValue(
                  song.originalTimeSignature,
                  song.originalTimeSignature ? "confirmed" : "unknown",
                )}
              </td>
              <td className="py-2">
                <span className="font-semibold">{meter}</span>{" "}
                {song.version.meterConfirmed ? null : (
                  <Badge tone="warn">{t("repertoire:song.meterUnconfirmed")}</Badge>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <details
        className="mt-4"
        open={song.metadataSources.length > 0 && song.metadataSources.length <= 6}
      >
        <summary className="cursor-pointer text-sm font-semibold">
          {t("repertoire:song.sources")} ({song.metadataSources.length})
        </summary>
        {song.metadataSources.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("repertoire:song.noSources")}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {song.metadataSources.map((src, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: sources have no id and never reorder here
              <li key={i} className="rounded-lg bg-sunken px-3 py-2">
                <span className="font-medium">{t(`repertoire:song.sourceField.${src.field}`)}</span>
                {src.value ? `: ${src.value}` : ""}
                {src.note ? <span className="block text-xs text-muted">{src.note}</span> : null}
                {src.url ? (
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block truncate text-xs text-accent-600 underline dark:text-accent-300"
                  >
                    {src.url}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </details>
    </Card>
  );
}

/** Which instruments already have usable material and which slots are still pending. */
export function MaterialsOverview({ materials }: { materials: SongMaterialDto[] }) {
  const { t } = useTranslation(["repertoire", "common"]);
  const label = (m: SongMaterialDto) =>
    `${t(`common:materialType.${m.type}`)}${m.instrument ? ` · ${t(`common:instrument.${m.instrument}`)}` : ""}`;
  const ready = materials.filter((m) => m.status !== "pending");
  const pendingList = materials.filter((m) => m.status === "pending");
  return (
    <Card>
      <h2 className="mb-3 font-semibold">{t("repertoire:materials.title")}</h2>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {t("repertoire:materials.available")}
      </p>
      {ready.length === 0 ? (
        <p className="mb-3 mt-1 text-sm text-muted">{t("repertoire:materials.noneAvailable")}</p>
      ) : (
        <ul className="mb-3 mt-1 flex flex-wrap gap-1.5">
          {ready.map((m) => (
            <li key={m.id}>
              <Badge tone="ok">{label(m)}</Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {t("repertoire:materials.pendingList")}
      </p>
      {pendingList.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{t("repertoire:materials.nonePending")}</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {pendingList.map((m) => (
            <li key={m.id}>
              <Badge tone="warn">{label(m)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** External links (official videos, metadata, chord/lyric pages). Content is never copied. */
export function ReferencesCard({
  bandId,
  song,
  canEdit,
}: {
  bandId: string;
  song: SongDto;
  canEdit: boolean;
}) {
  const { t } = useTranslation(["repertoire", "common"]);
  const add = useAddReference(bandId, song.id);
  const del = useDeleteReference(bandId, song.id);
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await add.mutateAsync({
        kind: String(fd.get("kind")),
        title: String(fd.get("title")),
        url: String(fd.get("url")).trim(),
        note: String(fd.get("note") || "").trim() || null,
      });
      setAdding(false);
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t("repertoire:references.title")}</h2>
        {canEdit ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="size-4" />}
            onClick={() => setAdding(true)}
          >
            {t("repertoire:references.add")}
          </Button>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-muted">{t("repertoire:references.linksOnly")}</p>
      {song.references.length === 0 ? (
        <p className="text-sm text-muted">{t("repertoire:references.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {song.references.map((r) => (
            <li
              key={r.id}
              className="flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <Badge>
                  {t(`repertoire:references.kinds.${r.kind}`, { defaultValue: r.kind })}
                </Badge>{" "}
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 font-medium text-accent-600 underline dark:text-accent-300"
                >
                  {r.title} <ExternalLink className="size-3.5" />
                </a>
                {r.note ? <span className="mt-0.5 block text-xs text-muted">{r.note}</span> : null}
              </div>
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("common:actions.remove")}
                  onClick={() => setRemoving(r.id)}
                  icon={<Trash2 className="size-4" />}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title={t("repertoire:references.add")}>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Select name="kind" label={t("repertoire:references.kind")} defaultValue="official_video">
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`repertoire:references.kinds.${k}`)}
              </option>
            ))}
          </Select>
          <Input
            name="title"
            label={t("repertoire:references.titleField")}
            required
            maxLength={160}
          />
          <Input
            name="url"
            type="url"
            label={t("repertoire:references.url")}
            required
            inputMode="url"
          />
          <Input
            name="note"
            label={`${t("repertoire:references.note")} (${t("common:state.optional")})`}
            maxLength={500}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" loading={add.isPending}>
              {t("common:actions.save")}
            </Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={t("repertoire:references.deleteConfirm")}
        danger
        loading={del.isPending}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await del.mutateAsync(removing);
            setRemoving(null);
          } catch (err) {
            toast(errorText(err), "error");
          }
        }}
      />
    </Card>
  );
}

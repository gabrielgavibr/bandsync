import {
  INSTRUMENTS,
  MATERIAL_TYPES,
  type SongMaterialDto,
  TEXT_MATERIAL_TYPES,
} from "@bandsync/shared";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Segmented, Select, Textarea, Toggle, useToast } from "../../components/ui";
import { errorText } from "../../lib/errors";
// removed "../../lib/api";
import { useSaveMaterial, useUploadFile } from "./queries";

export function MaterialEditor({
  bandId,
  songId,
  material,
  onDone,
}: {
  bandId: string;
  songId: string;
  material: SongMaterialDto | null;
  onDone: () => void;
}) {
  const { t } = useTranslation(["repertoire", "common"]);
  const save = useSaveMaterial(bandId, songId);
  const upload = useUploadFile(bandId);
  const { toast } = useToast();
  const [type, setType] = useState(material?.type ?? "chords");
  const [fileId, setFileId] = useState<string | null>(material?.fileId ?? null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<"ready" | "pending">(material?.status ?? "ready");
  const [isExample, setIsExample] = useState(material?.isExample ?? false);
  const isText = (TEXT_MATERIAL_TYPES as readonly string[]).includes(type);
  const isFile = type === "pdf" || type === "sheet_music" || type === "audio";
  const isLink = type === "video_reference" || status === "pending";

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const str = (k: string) =>
      String(fd.get(k) ?? "").trim() === "" ? null : String(fd.get(k)).trim();
    try {
      await save.mutateAsync({
        id: material?.id,
        input: {
          type,
          title: String(fd.get("title")),
          instrument: str("instrument"),
          body: isText || type === "sheet_music" ? str("body") : null,
          externalUrl:
            isLink || type === "video_reference" || type === "audio" ? str("externalUrl") : null,
          fileId: isFile ? fileId : null,
          key: str("key"),
          status,
          isExample,
        },
      });
      onDone();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div>
        <p className="mb-1.5 text-sm font-medium">{t("repertoire:materials.status")}</p>
        <Segmented
          ariaLabel={t("repertoire:materials.status")}
          value={status}
          onChange={setStatus}
          options={[
            { value: "ready", label: t("repertoire:materials.statusReady") },
            { value: "pending", label: t("repertoire:materials.statusPending") },
          ]}
        />
        <p className="mt-1.5 text-xs text-muted">{t("repertoire:materials.pendingHint")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select
          label={t("repertoire:materials.type")}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {MATERIAL_TYPES.map((m) => (
            <option key={m} value={m}>
              {t(`common:materialType.${m}`)}
            </option>
          ))}
        </Select>
        <Select
          name="instrument"
          label={t("repertoire:materials.instrument")}
          defaultValue={material?.instrument ?? ""}
        >
          <option value="">{t("repertoire:materials.anyInstrument")}</option>
          {INSTRUMENTS.map((i) => (
            <option key={i} value={i}>
              {t(`common:instrument.${i}`)}
            </option>
          ))}
        </Select>
      </div>
      <Input
        name="title"
        label={t("repertoire:materials.titleField")}
        defaultValue={material?.title ?? t(`common:materialType.${type}`)}
        required
        maxLength={120}
      />
      {type === "chords" ? (
        <Input
          name="key"
          label={t("repertoire:materials.key")}
          defaultValue={material?.key ?? ""}
          maxLength={12}
          placeholder="C, Am…"
        />
      ) : null}
      {isText || type === "sheet_music" ? (
        <Textarea
          name="body"
          label={t("repertoire:materials.body")}
          hint={t("repertoire:materials.bodyHint")}
          defaultValue={material?.body ?? ""}
          className="font-mono"
          rows={12}
          spellCheck={false}
        />
      ) : null}
      {isLink || type === "audio" ? (
        <Input
          name="externalUrl"
          type="url"
          label={t("repertoire:materials.externalUrl")}
          defaultValue={material?.externalUrl ?? ""}
        />
      ) : null}
      {isFile ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t("repertoire:materials.file")}</span>
          <input
            type="file"
            accept="application/pdf,audio/*,image/png,image/jpeg,image/webp"
            className="text-sm"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const uploaded = await upload.mutateAsync(f);
                setFileId(uploaded.id);
                setFileName(uploaded.name);
              } catch (err) {
                toast(errorText(err), "error");
              }
            }}
          />
          <p className="text-sm text-muted">
            {upload.isPending
              ? t("repertoire:materials.uploading")
              : (fileName ?? (fileId ? "✓" : ""))}
          </p>
        </div>
      ) : null}
      <Toggle
        label={t("repertoire:materials.isExample")}
        checked={isExample}
        onChange={setIsExample}
      />
      <p className="text-xs text-muted">{t("repertoire:materials.rights")}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {t("common:actions.save")}
        </Button>
      </div>
    </form>
  );
}

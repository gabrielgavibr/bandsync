import {
  intervalBetween,
  type Notation,
  parseKey,
  respellChordSheet,
  type SongMaterialDto,
  transposeChordSheet,
} from "@bandsync/shared";
import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { isMonospaceMaterial, isTextMaterial } from "../../lib/materials";

export interface ViewerOptions {
  /** Font scale multiplier, 1 = default. */
  zoom: number;
  notation: Notation;
  /** Target key for chord charts; null = as written. */
  targetKey?: string | null;
}

export function MaterialViewer({
  material,
  options,
  className,
  addMaterialHref,
  onAddMaterial,
}: {
  material: SongMaterialDto;
  options: ViewerOptions;
  className?: string;
  /** Where "Add material" leads for pending slots; omitted when the viewer cannot edit. */
  addMaterialHref?: string;
  /** Alternative to the link: open an editor in place. */
  onAddMaterial?: () => void;
}) {
  if (material.status === "pending") {
    return (
      <PendingMaterial
        material={material}
        className={className}
        addMaterialHref={addMaterialHref}
        onAddMaterial={onAddMaterial}
      />
    );
  }
  return (
    <>
      {material.isExample ? <ExampleBanner /> : null}
      <MaterialContent material={material} options={options} className={className} />
    </>
  );
}

function ExampleBanner() {
  const { t } = useTranslation("repertoire");
  return (
    <p
      className="mx-4 mt-3 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-1.5 text-sm"
      role="note"
    >
      {t("materials.example")}
    </p>
  );
}

function PendingMaterial({
  material,
  className,
  addMaterialHref,
  onAddMaterial,
}: {
  material: SongMaterialDto;
  className?: string;
  addMaterialHref?: string;
  onAddMaterial?: () => void;
}) {
  const { t } = useTranslation(["repertoire", "common"]);
  return (
    <div
      className={cn(
        "m-4 rounded-2xl border border-dashed border-warn-500/60 bg-warn-500/5 p-5",
        className,
      )}
      role="status"
    >
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        <span className="rounded-full bg-warn-500/15 px-2.5 py-0.5 text-xs font-medium text-warn-500">
          {t("repertoire:materials.statusPending")}
        </span>
        {t(`common:materialType.${material.type}`)}
        {material.instrument ? ` · ${t(`common:instrument.${material.instrument}`)}` : ""}
      </p>
      <p className="mt-2 text-muted">{t("repertoire:materials.pendingBody")}</p>
      {material.body ? <p className="mt-2 whitespace-pre-wrap text-sm">{material.body}</p> : null}
      {material.externalUrl ? (
        <a
          href={material.externalUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-flex items-center gap-2 text-sm text-accent-600 underline dark:text-accent-300"
        >
          <ExternalLink className="size-4" /> {material.externalUrl}
        </a>
      ) : null}
      {onAddMaterial ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={onAddMaterial}
            className="inline-flex h-11 items-center rounded-xl bg-accent-500 px-4 font-semibold text-[#04221f]"
          >
            {t("repertoire:materials.addMaterial")}
          </button>
        </div>
      ) : addMaterialHref ? (
        <div className="mt-4">
          <Link
            to={addMaterialHref}
            className="inline-flex h-11 items-center rounded-xl bg-accent-500 px-4 font-semibold text-[#04221f]"
          >
            {t("repertoire:materials.addMaterial")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function MaterialContent({
  material,
  options,
  className,
}: {
  material: SongMaterialDto;
  options: ViewerOptions;
  className?: string;
}) {
  const { t } = useTranslation(["repertoire", "rehearsal"]);
  const body = useMemo(() => {
    if (!material.body) return "";
    if (material.type !== "chords" && material.type !== "lyrics") return material.body;
    let text = material.body;
    if (options.targetKey && material.key) {
      const from = parseKey(material.key);
      const to = parseKey(options.targetKey);
      if (from && to) {
        const semis = intervalBetween(from, to);
        if (semis !== 0)
          text = transposeChordSheet(text, {
            semitones: semis,
            targetKey: to,
            notation: options.notation,
          });
        else text = respellChordSheet(text, options.notation);
        return text;
      }
    }
    return respellChordSheet(text, options.notation);
  }, [material, options.targetKey, options.notation]);

  const fontSize = `${Math.round(16 * options.zoom)}px`;

  if (
    material.fileUrl &&
    (material.type === "pdf" || material.type === "sheet_music" || material.type === "audio")
  ) {
    if (material.type === "audio") {
      return (
        <div className={cn("p-4", className)}>
          {/* biome-ignore lint/a11y/useMediaCaption: user-provided rehearsal audio has no captions */}
          <audio controls src={material.fileUrl} className="w-full" preload="metadata" />
        </div>
      );
    }
    return (
      <div className={cn("flex h-full min-h-[60vh] flex-col", className)}>
        <object
          data={material.fileUrl}
          type="application/pdf"
          className="min-h-[60vh] w-full flex-1 rounded-xl bg-white"
        >
          <a
            href={material.fileUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="m-4 inline-flex items-center gap-2 underline"
          >
            <ExternalLink className="size-4" /> {t("repertoire:materials.openFile")}
          </a>
        </object>
      </div>
    );
  }

  if (material.externalUrl && !material.body) {
    return (
      <div className={cn("p-6", className)}>
        <a
          href={material.externalUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-2 text-accent-600 underline dark:text-accent-300"
        >
          <ExternalLink className="size-4" /> {material.externalUrl}
        </a>
      </div>
    );
  }

  if (isTextMaterial(material.type) || material.body) {
    return (
      <pre
        className={cn(
          "whitespace-pre-wrap break-words p-4 leading-relaxed",
          isMonospaceMaterial(material.type) ? "font-mono" : "font-sans",
          className,
        )}
        style={{ fontSize, tabSize: 4 }}
      >
        {body}
      </pre>
    );
  }
  return <p className={cn("p-6 text-muted", className)}>{t("rehearsal:member.noMaterial")}</p>;
}

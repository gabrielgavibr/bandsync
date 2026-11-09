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
            rel="noreferrer"
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
          rel="noreferrer"
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

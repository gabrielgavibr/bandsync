import type { Instrument, SongDto, SongMaterialDto } from "@bandsync/shared";
import { Drum, Guitar, KeyboardMusic, Mic2, Music } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Segmented } from "../../components/ui";
import { progression } from "./model";

export const ARRANGEMENT_VIEWS = ["drums", "bass", "guitar", "keys", "vocals"] as const;
export type ArrangementView = (typeof ARRANGEMENT_VIEWS)[number];

const ICONS: Record<ArrangementView, typeof Drum> = {
  drums: Drum,
  bass: Music,
  guitar: Guitar,
  keys: KeyboardMusic,
  vocals: Mic2,
};

/** The view that fits a member's instrument (or the structure view for everyone else). */
export function viewFor(instrument: Instrument | string | null | undefined): ArrangementView {
  if (instrument === "drums" || instrument === "percussion") return "drums";
  if (instrument === "bass") return "bass";
  if (instrument === "keys") return "keys";
  if (instrument === "vocals") return "vocals";
  if (instrument === "guitar") return "guitar";
  return "drums";
}

/** Materials the band added itself for this part (tabs, lyrics); never generated. */
const MATERIALS_FOR: Record<ArrangementView, string[]> = {
  drums: ["drum_map", "arrangement_map"],
  bass: ["bass_tab"],
  guitar: ["guitar_tab", "chords"],
  keys: ["chords", "sheet_music"],
  vocals: ["lyrics"],
};

/** "| Am | Am | F | G |" in lines of four bars. */
function barLines(chords: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < chords.length; i += 4) out.push(chords.slice(i, i + 4));
  return out;
}

/**
 * The band's arrangement as each instrument needs it. Only what the arrangement holds is shown:
 * structure, bars, tempo, cues and the harmony the band reviewed. No instrumental line is
 * transcribed or invented; tabs and lyrics appear only when the band added them as materials.
 */
export function InstrumentViews({
  song,
  materials = [],
  initial,
  compact = false,
}: {
  song: SongDto;
  materials?: SongMaterialDto[];
  initial?: ArrangementView;
  compact?: boolean;
}) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const [view, setView] = useState<ArrangementView>(initial ?? "drums");
  const v = song.version;
  const meter = `${v.beatsPerBar}/${v.beatUnit}`;
  const authorised = materials.filter((m) => MATERIALS_FOR[view].includes(m.type));
  const hasChords = song.sections.some((s) => s.chords.some((c) => c !== "N"));

  const body = (
    <div className="flex flex-col gap-3" data-testid="instrument-view" data-view={view}>
      <Segmented<ArrangementView>
        value={view}
        onChange={setView}
        ariaLabel={t("autoarrange:views.label")}
        options={ARRANGEMENT_VIEWS.map((k) => {
          const Icon = ICONS[k];
          return {
            value: k,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Icon className="size-4" aria-hidden="true" />
                {t(`autoarrange:views.${k}`)}
              </span>
            ),
          };
        })}
      />

      <p className="text-sm">
        <span className="font-semibold">
          {v.bpm ? `${v.bpm} BPM` : t("autoarrange:views.bpmPending")}
        </span>{" "}
        · {meter}
        {v.key ? ` · ${v.key}` : ""}
        {v.arrangementTranspose
          ? ` · ${t("autoarrange:editor.transposed", { count: v.arrangementTranspose })}`
          : ""}
      </p>

      {view === "bass" ? (
        <p className="rounded-lg border border-warn-500/50 bg-warn-500/5 px-3 py-2 text-sm">
          {t("autoarrange:views.bassNotice")}
        </p>
      ) : null}
      {(view === "guitar" || view === "keys" || view === "bass") && !hasChords ? (
        <p className="text-sm text-muted">{t("autoarrange:views.noChords")}</p>
      ) : null}

      <ol className="flex flex-col gap-2">
        {song.sections.map((s) => {
          const entries = s.cues.filter((c) => c.type === "entry");
          const marks = s.cues.filter((c) => c.type !== "note");
          return (
            <li
              key={s.id}
              className="rounded-lg bg-sunken px-3 py-2 text-sm"
              data-testid="view-section"
            >
              <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-semibold">{s.name}</span>
                <span className="text-muted">{t("common:music.bars", { count: s.bars })}</span>
              </p>
              {view === "drums" ? (
                marks.length ? (
                  <p className="text-xs">
                    {marks
                      .map(
                        (c) =>
                          `${t(`autoarrange:editor.cueType.${c.type}`)}${c.bar ? ` (${t("autoarrange:editor.cueBar", { bar: c.bar })})` : ""}${c.text && c.text !== t(`autoarrange:editor.cueType.${c.type}`) ? `: ${c.text}` : ""}`,
                      )
                      .join(" · ")}
                  </p>
                ) : null
              ) : view === "vocals" ? (
                entries.length ? (
                  <p className="text-xs">
                    {entries
                      .map(
                        (c) =>
                          `${t("autoarrange:editor.cueType.entry")}${c.bar ? ` (${t("autoarrange:editor.cueBar", { bar: c.bar })})` : ""}${c.text && c.text !== t("autoarrange:editor.cueType.entry") ? `: ${c.text}` : ""}`,
                      )
                      .join(" · ")}
                  </p>
                ) : null
              ) : s.chords.some((c) => c !== "N") ? (
                view === "bass" ? (
                  <p className="font-mono text-xs">{progression(s.chords).join(" → ")}</p>
                ) : (
                  <div className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
                    {barLines(s.chords).map((line, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional bar lines
                      <span key={i}>| {line.map((c) => (c === "N" ? "%" : c)).join(" | ")} |</span>
                    ))}
                  </div>
                )
              ) : null}
              {s.notes ? <p className="text-xs text-muted">{s.notes}</p> : null}
            </li>
          );
        })}
      </ol>

      <div className="text-xs text-muted">
        {authorised.length ? (
          <p>
            {t("autoarrange:views.authorisedMaterials", {
              list: authorised.map((m) => m.title || t(`common:materialType.${m.type}`)).join(", "),
            })}
          </p>
        ) : (
          <p>{t(`autoarrange:views.noMaterial.${view}`)}</p>
        )}
      </div>
    </div>
  );

  if (compact) return body;
  return (
    <Card data-testid="instrument-views">
      <h2 className="mb-3 font-semibold">{t("autoarrange:views.heading")}</h2>
      {body}
    </Card>
  );
}

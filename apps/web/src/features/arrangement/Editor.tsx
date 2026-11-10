import {
  formatKey,
  keyPrefersFlats,
  parseKey,
  type RecordingArrangementDto,
  SECTION_KINDS,
  type SectionCue,
  type SectionKind,
  type SongDto,
  transposeKey,
} from "@bandsync/shared";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Flag,
  GitMerge as Merge,
  Play,
  Plus,
  Scissors,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, ConfirmDialog, Select, useToast } from "../../components/ui";
import { cn } from "../../lib/cn";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { useSaveArrangement } from "../autoarrange/queries";
import {
  addCue,
  type EditableSection,
  fromPrearrangement,
  fromSaved,
  mergeWithNext,
  move,
  newSection,
  parseChordLine,
  progression,
  remove,
  repeat,
  setBars,
  setTimes,
  split,
  splitAtTime,
  toSaved,
  totalBars,
  transposeChordLabel,
} from "./model";
import { clockTenths } from "./PlayerBar";
import { BandTimeline, letterColor } from "./Timeline";
import type { Passage, SectionPlayback, Transport } from "./transport";

const CUE_TYPES = ["stop", "entry", "convention", "note"] as const;

/**
 * The band's own arrangement: what the band plays, in order. Starts from the recording's
 * pre-arrangement when there is one; editing it never changes that pre-arrangement.
 */
export function ArrangementEditor({
  bandId,
  song,
  pre,
  canEdit,
  transport,
  playback,
  onPassages,
}: {
  bandId: string;
  song: SongDto;
  pre: RecordingArrangementDto | null;
  canEdit: boolean;
  /** The recording being reviewed (uploaded file or official player), when there is one. */
  transport: Transport | null;
  playback: SectionPlayback | null;
  /** Tells the page where the band's sections are in the recording, as they are edited. */
  onPassages?: (list: Passage[]) => void;
}) {
  const { t, i18n } = useTranslation(["autoarrange", "repertoire", "common"]);
  const { toast } = useToast();
  const save = useSaveArrangement(bandId, song.id);
  const nameFor = (kind: SectionKind | null, label: string, nth: number) =>
    kind
      ? `${t(`autoarrange:editor.kind.${kind}`)}${nth > 1 ? ` ${nth}` : ""}`
      : `${t("autoarrange:pre.letter", { label })}${nth > 1 ? ` (${nth})` : ""}`;
  const cueText = (type: "stop" | "entry") => t(`autoarrange:editor.cueType.${type}`);

  const [sections, setSections] = useState<EditableSection[]>(() => fromSaved(song.sections));
  const [transpose, setTranspose] = useState(song.version.arrangementTranspose);
  const [baseId, setBaseId] = useState<string | null>(song.version.arrangementBaseId);
  const [dirty, setDirty] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  // Server data changed (saved elsewhere, or a reload) and nothing is being edited here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh only on a new saved version
  useEffect(() => {
    if (dirty) return;
    setSections(fromSaved(song.sections));
    setTranspose(song.version.arrangementTranspose);
    setBaseId(song.version.arrangementBaseId);
  }, [song.version.arrangementUpdatedAt, song.version.id]);

  // Where each section is heard: the player follows the limits as they are edited.
  const passages = useMemo<Passage[]>(
    () =>
      sections
        .filter((x) => x.startMs !== null && x.endMs !== null)
        .map((x) => ({
          id: x.key,
          startSec: x.startMs! / 1000,
          endSec: x.endMs! / 1000,
          name: x.name,
        })),
    [sections],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: report only when the limits change
  useEffect(() => onPassages?.(passages), [passages]);
  const barSeconds = pre?.data.barSeconds ?? null;
  const currentKey = playback?.current.band ?? null;
  const listenTo = (x: EditableSection) => {
    if (playback && x.startMs !== null && x.endMs !== null)
      playback.playPassage({
        id: x.key,
        startSec: x.startMs / 1000,
        endSec: x.endMs / 1000,
        name: x.name,
      });
  };

  const baseKey = parseKey(pre?.data.key?.key ?? song.version.key ?? "");
  const shownKey = baseKey ? transposeKey(baseKey, transpose) : null;
  const flats = shownKey ? keyPrefersFlats(shownKey) : transpose < 0;

  const edit = (next: EditableSection[]) => {
    setSections(next);
    setDirty(true);
  };
  const patch = (i: number, p: Partial<EditableSection>) =>
    edit(sections.map((s, k) => (k === i ? { ...s, ...p } : s)));

  const startFromPre = () => {
    if (!pre) return;
    setSections(fromPrearrangement(pre, nameFor, cueText));
    setBaseId(pre.id);
    setTranspose(0);
    setDirty(true);
  };

  const shift = (by: number) => {
    const next = ((((transpose + by) % 12) + 18) % 12) - 6; // keep within -6..5
    const delta = by;
    const target = baseKey ? transposeKey(baseKey, next) : null;
    const useFlats = target ? keyPrefersFlats(target) : next < 0;
    edit(
      sections.map((s) => ({
        ...s,
        chords: s.chords.map((c) => transposeChordLabel(c, delta, useFlats)),
      })),
    );
    setTranspose(next);
  };

  const onSave = async () => {
    try {
      await save.mutateAsync({ baseId, transpose, sections: toSaved(sections) });
      setDirty(false);
      toast(t("autoarrange:editor.saved"), "success");
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  const bars = useMemo(() => totalBars(sections), [sections]);

  return (
    <div className="flex flex-col gap-4" data-testid="arrangement-editor">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span>{t("autoarrange:editor.summary", { sections: sections.length, bars })}</span>
        {shownKey ? (
          <span data-testid="arrangement-key">
            {t("common:music.key")}: <strong>{formatKey(shownKey)}</strong>
            {transpose !== 0 ? (
              <span className="text-muted">
                {" "}
                ({t("autoarrange:editor.transposed", { count: transpose })})
              </span>
            ) : null}
          </span>
        ) : null}
        {song.version.arrangementUpdatedAt ? (
          <span className="text-xs text-muted">
            {t("autoarrange:editor.lastSaved", {
              when: formatDateTime(song.version.arrangementUpdatedAt, i18n.language),
            })}
          </span>
        ) : null}
        {dirty ? <Badge tone="warn">{t("autoarrange:editor.unsaved")}</Badge> : null}
      </div>

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {pre ? (
            <Button
              size="sm"
              variant={sections.length ? "ghost" : "primary"}
              icon={<Wand2 className="size-4" />}
              onClick={() => (sections.length ? setConfirmRestart(true) : startFromPre())}
              data-testid="start-from-pre"
            >
              {sections.length
                ? t("autoarrange:editor.restartFromPre")
                : t("autoarrange:editor.startFromPre")}
            </Button>
          ) : null}
          {sections.length > 0 ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => shift(-1)}>
                {t("autoarrange:editor.transposeDown")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => shift(1)}>
                {t("autoarrange:editor.transposeUp")}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {transport && passages.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs text-muted">
            {canEdit
              ? t("autoarrange:timeline.bandHint")
              : t("autoarrange:timeline.bandHintReadOnly")}
          </p>
          <BandTimeline
            sections={sections}
            durationSec={transport.duration}
            time={transport.time}
            currentKey={currentKey}
            onPlay={(i) => listenTo(sections[i]!)}
            onSeek={(sec) => {
              playback?.release();
              transport.seek(sec);
            }}
            onMoveBoundary={
              canEdit
                ? (i, ms) => edit(setTimes(sections, i, { endMs: ms }, barSeconds))
                : undefined
            }
          />
        </div>
      ) : null}

      {sections.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
          {pre ? t("autoarrange:editor.emptyWithPre") : t("autoarrange:editor.empty")}
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {sections.map((s, i) => (
            <SectionRow
              key={s.key}
              index={i}
              count={sections.length}
              section={s}
              canEdit={canEdit}
              flats={flats}
              onPatch={(p) => patch(i, p)}
              onBars={(n) => edit(setBars(sections, i, n))}
              onMove={(by) => edit(move(sections, i, by))}
              onRepeat={() => edit(repeat(sections, i))}
              onSplit={() => {
                // While listening: split where playback is. Otherwise: in half.
                const at = transport ? Math.round(transport.now() * 1000) : -1;
                const inside =
                  s.startMs !== null && s.endMs !== null && at > s.startMs && at < s.endMs;
                edit(
                  inside
                    ? splitAtTime(sections, i, at, barSeconds)
                    : split(sections, i, Math.floor(s.bars / 2)),
                );
              }}
              onMerge={() => edit(mergeWithNext(sections, i))}
              onRemove={() => edit(remove(sections, i))}
              onCue={(c) => edit(addCue(sections, i, c))}
              current={currentKey === s.key}
              onListen={
                transport && s.startMs !== null && s.endMs !== null ? () => listenTo(s) : undefined
              }
              now={transport ? () => Math.round(transport.now() * 1000) : undefined}
              onTimes={(p) => edit(setTimes(sections, i, p, barSeconds))}
            />
          ))}
        </ol>
      )}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button
            variant="secondary"
            icon={<Plus className="size-4" />}
            onClick={() => edit([...sections, newSection(t("repertoire:sections.name"))])}
          >
            {t("repertoire:sections.add")}
          </Button>
          <Button
            onClick={() => void onSave()}
            loading={save.isPending}
            disabled={!dirty}
            data-testid="save-arrangement"
          >
            {t("autoarrange:editor.save")}
          </Button>
          <p className="basis-full text-xs text-muted">{t("autoarrange:editor.saveHint")}</p>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmRestart}
        onClose={() => setConfirmRestart(false)}
        onConfirm={() => {
          setConfirmRestart(false);
          startFromPre();
        }}
        title={t("autoarrange:editor.restartFromPre")}
        body={t("autoarrange:editor.restartConfirm")}
        confirmLabel={t("autoarrange:editor.restartFromPre")}
      />
    </div>
  );
}

function SectionRow({
  index,
  count,
  section: s,
  canEdit,
  flats,
  onPatch,
  onBars,
  onMove,
  onRepeat,
  onSplit,
  onMerge,
  onRemove,
  onCue,
  onListen,
  current,
  now,
  onTimes,
}: {
  index: number;
  count: number;
  section: EditableSection;
  canEdit: boolean;
  flats: boolean;
  onPatch: (p: Partial<EditableSection>) => void;
  onBars: (n: number) => void;
  onMove: (by: number) => void;
  onRepeat: () => void;
  onSplit: () => void;
  onMerge: () => void;
  onRemove: () => void;
  onCue: (c: SectionCue) => void;
  onListen?: () => void;
  /** This section is the one sounding now. */
  current: boolean;
  /** Playback position in milliseconds, when a recording is loaded. */
  now?: () => number;
  onTimes: (p: { startMs?: number; endMs?: number }) => void;
}) {
  const { t } = useTranslation(["autoarrange", "repertoire", "common"]);
  const [chordText, setChordText] = useState(s.chords.join(" "));
  const [cueType, setCueType] = useState<(typeof CUE_TYPES)[number]>("stop");
  const [cueBar, setCueBar] = useState("");
  useEffect(() => setChordText(s.chords.join(" ")), [s.chords]);
  const prog = progression(s.chords);
  const n = index + 1;
  const iconBtn =
    "inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-elev hover:text-fg disabled:opacity-40";

  return (
    <li
      className={cn(
        "rounded-xl border bg-elev/40 p-3",
        current ? "border-accent-500 ring-1 ring-accent-500" : "border-line",
      )}
      data-testid="arrangement-section"
      data-name={s.name}
      data-current={current}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
          style={{ background: letterColor(s.label) }}
        >
          {s.label ?? n}
        </span>
        <input
          aria-label={t("autoarrange:editor.nameOf", { n })}
          value={s.name}
          disabled={!canEdit}
          maxLength={60}
          onChange={(e) => onPatch({ name: e.target.value })}
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-elev px-2.5 font-medium"
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="number"
            aria-label={t("autoarrange:editor.barsOf", { n })}
            min={0}
            max={999}
            value={s.bars}
            disabled={!canEdit}
            onChange={(e) => onBars(Math.max(0, Math.min(999, Number(e.target.value) || 0)))}
            className="h-9 w-16 rounded-lg border border-line bg-elev px-2 text-right tabular-nums"
          />
          <span className="text-muted">{t("autoarrange:editor.barsShort")}</span>
        </label>
        {onListen ? (
          <button
            type="button"
            className={cn(iconBtn, "bg-accent-500/15 text-accent-600 dark:text-accent-300")}
            onClick={onListen}
            aria-label={t("autoarrange:editor.listenSection", { name: s.name })}
            title={t("autoarrange:editor.listenSection", { name: s.name })}
          >
            <Play className="size-4" />
          </button>
        ) : null}
      </div>

      {s.startMs !== null && s.endMs !== null ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm"
          data-testid="section-times"
        >
          {(["startMs", "endMs"] as const).map((edge) => {
            const value = s[edge]!;
            const label = t(
              edge === "startMs" ? "autoarrange:editor.start" : "autoarrange:editor.end",
            );
            return (
              <div key={edge} className="flex items-center gap-1" data-edge={edge}>
                <span className="text-muted">{label}</span>
                <span className="w-14 font-mono tabular-nums" data-testid={`time-${edge}`}>
                  {clockTenths(value / 1000)}
                </span>
                {canEdit ? (
                  <>
                    <button
                      type="button"
                      className={iconBtn}
                      onClick={() => onTimes({ [edge]: value - 500 })}
                      aria-label={t("autoarrange:editor.earlier", { what: label, name: s.name })}
                      title={t("autoarrange:editor.earlier", { what: label, name: s.name })}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className={iconBtn}
                      onClick={() => onTimes({ [edge]: value + 500 })}
                      aria-label={t("autoarrange:editor.later", { what: label, name: s.name })}
                      title={t("autoarrange:editor.later", { what: label, name: s.name })}
                    >
                      +
                    </button>
                    {now ? (
                      <button
                        type="button"
                        className={cn(iconBtn, "w-auto gap-1 px-2 text-xs")}
                        onClick={() => onTimes({ [edge]: now() })}
                        aria-label={t("autoarrange:editor.setHere", { what: label, name: s.name })}
                        title={t("autoarrange:editor.setHere", { what: label, name: s.name })}
                      >
                        <Flag className="size-3.5" /> {t("autoarrange:editor.here")}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-2 grid gap-2 sm:grid-cols-[12rem_1fr]">
        <Select
          label={t("autoarrange:editor.kindLabel")}
          value={s.kind ?? ""}
          disabled={!canEdit}
          onChange={(e) => onPatch({ kind: (e.target.value || null) as SectionKind | null })}
        >
          <option value="">{t("autoarrange:editor.kindNone")}</option>
          {SECTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`autoarrange:editor.kind.${k}`)}
            </option>
          ))}
        </Select>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("autoarrange:editor.chords")}
          <input
            value={chordText}
            disabled={!canEdit}
            placeholder={t("autoarrange:editor.chordsPlaceholder")}
            onChange={(e) => setChordText(e.target.value)}
            onBlur={() => {
              const next = parseChordLine(chordText, s.bars);
              if (next.join(" ") !== s.chords.join(" ")) onPatch({ chords: next });
            }}
            className="h-12 rounded-xl border border-line bg-elev px-3 font-mono text-sm font-normal"
            data-testid="section-chords"
          />
          <span className="text-xs font-normal text-muted">
            {prog.length
              ? t("autoarrange:editor.progression", {
                  chords: prog.map((c) => transposeChordLabel(c, 0, flats)).join(" → "),
                })
              : t("autoarrange:editor.noChords")}
          </span>
        </label>
      </div>

      {s.cues.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="section-cues">
          {s.cues.map((c, k) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: cues have no id
              key={k}
              className="inline-flex items-center gap-1 rounded-lg bg-warn-500/10 px-2 py-1 text-xs"
            >
              {t(`autoarrange:editor.cueType.${c.type}`)}
              {c.bar ? ` · ${t("autoarrange:editor.cueBar", { bar: c.bar })}` : ""}
              {c.text && c.text !== t(`autoarrange:editor.cueType.${c.type}`) ? `: ${c.text}` : ""}
              {canEdit ? (
                <button
                  type="button"
                  aria-label={t("autoarrange:editor.removeCue")}
                  onClick={() => onPatch({ cues: s.cues.filter((_, x) => x !== k) })}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <select
              aria-label={t("autoarrange:editor.cueKind")}
              value={cueType}
              onChange={(e) => setCueType(e.target.value as (typeof CUE_TYPES)[number])}
              className="h-9 rounded-lg border border-line bg-elev px-2 text-sm"
            >
              {CUE_TYPES.map((c) => (
                <option key={c} value={c}>
                  {t(`autoarrange:editor.cueType.${c}`)}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={Math.max(1, s.bars)}
              aria-label={t("autoarrange:editor.cueAtBar")}
              placeholder={t("autoarrange:editor.cueAtBar")}
              value={cueBar}
              onChange={(e) => setCueBar(e.target.value)}
              className="h-9 w-24 rounded-lg border border-line bg-elev px-2 text-sm"
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-4" />}
              onClick={() => {
                const bar = Number(cueBar);
                onCue({
                  type: cueType,
                  text: t(`autoarrange:editor.cueType.${cueType}`),
                  bar: bar >= 1 ? Math.min(bar, Math.max(1, s.bars)) : Math.max(1, s.bars),
                });
                setCueBar("");
              }}
            >
              {t("autoarrange:editor.addCue")}
            </Button>
          </div>
          <input
            aria-label={t("repertoire:sections.notes")}
            placeholder={t("repertoire:sections.notes")}
            value={s.notes}
            maxLength={500}
            onChange={(e) => onPatch({ notes: e.target.value })}
            className="mt-2 h-9 w-full rounded-lg border border-line bg-elev px-2.5 text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-0.5 border-t border-line pt-2">
            <button
              type="button"
              className={iconBtn}
              disabled={index === 0}
              onClick={() => onMove(-1)}
              aria-label={t("autoarrange:editor.moveUp")}
              title={t("autoarrange:editor.moveUp")}
            >
              <ArrowUp className="size-4" />
            </button>
            <button
              type="button"
              className={iconBtn}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
              aria-label={t("autoarrange:editor.moveDown")}
              title={t("autoarrange:editor.moveDown")}
            >
              <ArrowDown className="size-4" />
            </button>
            <button
              type="button"
              className={cn(iconBtn, "w-auto gap-1 px-2 text-xs")}
              onClick={onRepeat}
            >
              <Copy className="size-4" /> {t("autoarrange:editor.repeat")}
            </button>
            <button
              type="button"
              className={cn(iconBtn, "w-auto gap-1 px-2 text-xs")}
              disabled={s.bars < 2}
              onClick={onSplit}
            >
              <Scissors className="size-4" /> {t("autoarrange:editor.split")}
            </button>
            <button
              type="button"
              className={cn(iconBtn, "w-auto gap-1 px-2 text-xs")}
              disabled={index === count - 1}
              onClick={onMerge}
            >
              <Merge className="size-4" /> {t("autoarrange:editor.merge")}
            </button>
            <button
              type="button"
              className={cn(iconBtn, "ml-auto w-auto gap-1 px-2 text-xs hover:text-danger-500")}
              onClick={onRemove}
            >
              <Trash2 className="size-4" /> {t("autoarrange:editor.remove")}
            </button>
          </div>
        </>
      ) : s.notes ? (
        <p className="mt-2 text-sm text-muted">{s.notes}</p>
      ) : null}
    </li>
  );
}

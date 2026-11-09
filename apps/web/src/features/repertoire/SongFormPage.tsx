import { COMMON_TIME_SIGNATURES } from "@bandsync/shared";
import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import {
  Button,
  Card,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from "../../components/ui";
import { errorCode } from "../../lib/api";
import { useCurrentBand } from "../bands/BandLayout";
import { useSaveSong, useSong } from "./queries";

interface SectionDraft {
  /** Stable client-side id so React keys survive reordering and edits. */
  uid: number;
  name: string;
  bars: number;
  notes: string;
}
let sectionUid = 0;
const nextUid = () => ++sectionUid;

export function SongFormPage() {
  const { songId } = useParams();
  const { t } = useTranslation(["repertoire", "common"]);
  const band = useCurrentBand();
  const navigate = useNavigate();
  const { toast } = useToast();
  const existing = useSong(band.id, songId);
  const save = useSaveSong(band.id, songId);
  const [sections, setSections] = useState<SectionDraft[]>([]);
  const [meter, setMeter] = useState("4/4");

  useEffect(() => {
    if (existing.data) {
      setSections(
        existing.data.song.sections.map((s) => ({
          uid: nextUid(),
          name: s.name,
          bars: s.bars,
          notes: s.notes ?? "",
        })),
      );
      setMeter(`${existing.data.song.version.beatsPerBar}/${existing.data.song.version.beatUnit}`);
    }
  }, [existing.data]);

  if (songId && existing.isPending) return <LoadingBlock />;
  const song = existing.data?.song;
  const num = (v: FormDataEntryValue | null) =>
    v === null || String(v).trim() === "" ? null : Number(v);
  const str = (v: FormDataEntryValue | null) =>
    v === null || String(v).trim() === "" ? null : String(v).trim();

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const [bpb, bu] = meter.split("/").map(Number);
    try {
      const saved = await save.mutateAsync({
        title: String(fd.get("title")),
        artist: str(fd.get("artist")),
        album: str(fd.get("album")),
        durationSeconds: num(fd.get("durationSeconds")),
        originalBpm: num(fd.get("originalBpm")),
        originalKey: str(fd.get("originalKey")),
        version: {
          bpm: num(fd.get("bpm")),
          key: str(fd.get("key")),
          beatsPerBar: bpb,
          beatUnit: bu,
          notes: str(fd.get("notes")),
          referenceUrl: str(fd.get("referenceUrl")),
        },
        sections: sections
          .filter((s) => s.name.trim())
          .map((s) => ({ name: s.name.trim(), bars: s.bars, notes: s.notes || null })),
      });
      toast(t("repertoire:song.saved"), "success");
      navigate(`/bands/${band.id}/songs/${saved.id}`);
    } catch (err) {
      toast(t(`common:errors.${errorCode(err)}`), "error");
    }
  };

  const presets = ["intro", "verse", "chorus", "bridge", "solo", "outro"] as const;

  return (
    <>
      <PageHeader
        title={song ? t("repertoire:song.edit") : t("repertoire:song.new")}
        backTo={song ? `/bands/${band.id}/songs/${song.id}` : `/bands/${band.id}/songs`}
      />
      <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-2" noValidate>
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">{t("repertoire:song.details")}</h2>
          <Input
            name="title"
            label={t("repertoire:song.fields.title")}
            defaultValue={song?.title}
            required
            maxLength={160}
            autoFocus={!song}
          />
          <Input
            name="artist"
            label={t("repertoire:song.fields.artist")}
            defaultValue={song?.artist ?? ""}
            maxLength={160}
          />
          <Input
            name="album"
            label={t("repertoire:song.fields.album")}
            defaultValue={song?.album ?? ""}
            maxLength={160}
          />
          <Input
            name="durationSeconds"
            type="number"
            min={0}
            label={t("repertoire:song.fields.duration")}
            defaultValue={song?.durationSeconds ?? ""}
          />
          <p className="text-xs text-muted">{t("repertoire:song.externalSearch")}</p>
          <h3 className="mt-2 font-semibold">{t("repertoire:song.original")}</h3>
          <div className="grid grid-cols-2 gap-3">
            <Input
              name="originalBpm"
              type="number"
              min={20}
              max={400}
              label={t("repertoire:song.fields.originalBpm")}
              defaultValue={song?.originalBpm ?? ""}
            />
            <Input
              name="originalKey"
              label={t("repertoire:song.fields.originalKey")}
              defaultValue={song?.originalKey ?? ""}
              maxLength={12}
              placeholder="D, Am, Bb…"
            />
          </div>
        </Card>
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-4">
            <div>
              <h2 className="font-semibold">{t("repertoire:song.bandVersion")}</h2>
              <p className="text-sm text-muted">{t("repertoire:song.bandVersionHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                name="bpm"
                type="number"
                min={20}
                max={400}
                step="0.1"
                label={t("repertoire:song.fields.bpm")}
                hint={t("repertoire:song.fields.bpmHint")}
                defaultValue={song?.version.bpm ?? ""}
              />
              <Input
                name="key"
                label={t("repertoire:song.fields.key")}
                defaultValue={song?.version.key ?? ""}
                maxLength={12}
                placeholder="C, Am, Bb…"
              />
            </div>
            <Select
              label={t("common:music.timeSignature")}
              value={meter}
              onChange={(e) => setMeter(e.target.value)}
            >
              {COMMON_TIME_SIGNATURES.map((ts) => {
                const v = `${ts.beatsPerBar}/${ts.beatUnit}`;
                return (
                  <option key={v} value={v}>
                    {v}
                  </option>
                );
              })}
            </Select>
            <Input
              name="referenceUrl"
              type="url"
              label={t("repertoire:song.fields.referenceUrl")}
              defaultValue={song?.version.referenceUrl ?? ""}
            />
            <Textarea
              name="notes"
              label={t("repertoire:song.fields.notes")}
              defaultValue={song?.version.notes ?? ""}
              maxLength={2000}
            />
          </Card>
          <Card className="flex flex-col gap-3">
            <div>
              <h2 className="font-semibold">{t("repertoire:sections.title")}</h2>
              <p className="text-sm text-muted">{t("repertoire:sections.hint")}</p>
            </div>
            {sections.length === 0 ? (
              <p className="text-sm text-muted">{t("repertoire:sections.empty")}</p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {sections.map((s, i) => (
                <li key={s.uid} className="grid grid-cols-[1fr_5rem_auto] items-end gap-2">
                  <Input
                    label={t("repertoire:sections.name")}
                    value={s.name}
                    onChange={(e) =>
                      setSections(
                        sections.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      )
                    }
                    list="section-presets"
                  />
                  <Input
                    type="number"
                    min={0}
                    label={t("repertoire:sections.bars")}
                    value={s.bars}
                    onChange={(e) =>
                      setSections(
                        sections.map((x, j) =>
                          j === i ? { ...x, bars: Number(e.target.value) } : x,
                        ),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    aria-label={t("common:actions.remove")}
                    onClick={() => setSections(sections.filter((_, j) => j !== i))}
                    icon={<Trash2 className="size-4" />}
                  />
                  <Input
                    className="col-span-3"
                    label={t("repertoire:sections.notes")}
                    value={s.notes}
                    onChange={(e) =>
                      setSections(
                        sections.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
            <datalist id="section-presets">
              {presets.map((p) => (
                <option key={p} value={t(`repertoire:sections.presets.${p}`)} />
              ))}
            </datalist>
            <Button
              variant="secondary"
              icon={<Plus className="size-4" />}
              onClick={() =>
                setSections([...sections, { uid: nextUid(), name: "", bars: 8, notes: "" }])
              }
            >
              {t("repertoire:sections.add")}
            </Button>
          </Card>
          <Button type="submit" size="lg" loading={save.isPending}>
            {t("common:actions.save")}
          </Button>
        </div>
      </form>
    </>
  );
}

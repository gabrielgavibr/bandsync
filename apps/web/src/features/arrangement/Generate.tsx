import { AUDIO_RIGHTS, type AudioAssetDto } from "@bandsync/shared";
import { Flag, Mic, Play, Square, Trash2, Upload } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Segmented, Select, useToast } from "../../components/ui";
import { errorText } from "../../lib/errors";
import { formatDuration } from "../../lib/format";
import {
  decodeFile,
  ListenError,
  type MicCapture,
  type Pcm,
  prearrangeOnDevice,
  startMicCapture,
  toSubmission,
} from "../autoarrange/listen/audio";
import {
  type SongAnalysisOverview,
  useDeclareAudio,
  useSubmitPrearrangement,
} from "../autoarrange/queries";
import { useUploadFile } from "../repertoire/queries";
import { type LocalWork, prearrangementFromMarks, tempoForMarks } from "./prep";
import type { PlayerControls } from "./youtube";

/** Longest recording the microphone keeps (a full song with room to spare). */
export const MIC_MAX_SECONDS = 8 * 60;
const MIC_MIN_SECONDS = 30;

type Way = "file" | "microphone" | "marks";

/** Runs the on-device analysis of a whole recording and stores the pre-arrangement. */
function useGenerate(bandId: string, songId: string, onStage: (s: LocalWork | null) => void) {
  const submit = useSubmitPrearrangement(bandId, songId);
  return async (
    source: "audio_file" | "microphone",
    load: () => Promise<Pcm>,
    assetId: string | null,
  ) => {
    try {
      onStage("analysing_recording");
      const pcm = await load();
      onStage("detecting_structure");
      const pre = await prearrangeOnDevice(pcm);
      onStage("preparing_prearrangement");
      await submit.mutateAsync(toSubmission(pre, source, assetId));
    } finally {
      onStage(null);
    }
  };
}

function failureText(t: (k: string) => string, err: unknown) {
  return err instanceof ListenError ? t(`autoarrange:listen.error.${err.code}`) : errorText(err);
}

/**
 * The three ways to give BandSync a recording it may analyse. A YouTube or Spotify link is never
 * one of them: the official player plays it, and nothing is downloaded or captured from it.
 */
export function GeneratePanel({
  bandId,
  songId,
  overview,
  player,
  onStage,
  busy,
  hasReference,
}: {
  bandId: string;
  songId: string;
  overview: SongAnalysisOverview;
  player: PlayerControls | null;
  onStage: (s: LocalWork | null) => void;
  busy: boolean;
  /** Without a reference recording only the band's own authorised file can be mapped. */
  hasReference: boolean;
}) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const [way, setWay] = useState<Way>("file");
  if (!hasReference)
    return (
      <div className="flex flex-col gap-4" data-testid="generate-panel">
        <FileWay
          bandId={bandId}
          songId={songId}
          overview={overview}
          onStage={onStage}
          busy={busy}
        />
      </div>
    );
  return (
    <div className="flex flex-col gap-4" data-testid="generate-panel">
      <Segmented<Way>
        value={way}
        onChange={setWay}
        ariaLabel={t("autoarrange:pre.howLabel")}
        options={[
          { value: "file", label: t("autoarrange:pre.way.file") },
          { value: "microphone", label: t("autoarrange:pre.way.microphone") },
          { value: "marks", label: t("autoarrange:pre.way.marks") },
        ]}
      />
      {way === "file" ? (
        <FileWay
          bandId={bandId}
          songId={songId}
          overview={overview}
          onStage={onStage}
          busy={busy}
        />
      ) : way === "microphone" ? (
        <MicWay bandId={bandId} songId={songId} player={player} onStage={onStage} busy={busy} />
      ) : (
        <MarksWay bandId={bandId} songId={songId} overview={overview} player={player} />
      )}
    </div>
  );
}

function FileWay({
  bandId,
  songId,
  overview,
  onStage,
  busy,
}: {
  bandId: string;
  songId: string;
  overview: SongAnalysisOverview;
  onStage: (s: LocalWork | null) => void;
  busy: boolean;
}) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const { toast } = useToast();
  const upload = useUploadFile(bandId);
  const declare = useDeclareAudio(bandId, songId);
  const generate = useGenerate(bandId, songId, onStage);
  const [file, setFile] = useState<File | null>(null);
  const [declared, setDeclared] = useState(false);
  const ref = overview.recordings.find((r) => r.isReference);
  const assets = overview.audioAssets.filter(
    (a) => !ref || a.recordingId === null || a.recordingId === ref.id,
  );

  const fromAsset = async (a: AudioAssetDto) => {
    try {
      await generate(
        "audio_file",
        async () => {
          const r = await fetch(`/api/bands/${bandId}/files/${a.fileId}`, {
            credentials: "same-origin",
          });
          if (!r.ok) throw new ListenError("decode_failed");
          return decodeFile(await r.blob());
        },
        a.id,
      );
      toast(t("autoarrange:pre.generated"), "success");
    } catch (err) {
      toast(failureText(t, err), "error");
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file || !declared) return;
    const fd = new FormData(e.currentTarget);
    try {
      const uploaded = await upload.mutateAsync(file);
      const asset = await declare.mutateAsync({
        fileId: uploaded.id,
        rightsBasis: String(fd.get("rights")),
        rightsNote: String(fd.get("note") ?? "").trim() || null,
      });
      await generate("audio_file", () => decodeFile(file), asset.id);
      setFile(null);
      setDeclared(false);
      toast(t("autoarrange:pre.generated"), "success");
    } catch (err) {
      toast(failureText(t, err), "error");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("autoarrange:pre.fileExplain")}</p>
      {assets.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="declared-audio">
          {assets.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sunken px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate">
                {a.fileName}{" "}
                <span className="text-muted">
                  · {t(`autoarrange:audio.rights.${a.rightsBasis}`)}
                </span>
              </span>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => fromAsset(a)}>
                {t("autoarrange:pre.fromThisFile")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("autoarrange:audio.file")}
          <input
            type="file"
            accept="audio/*"
            data-testid="prearrange-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm font-normal file:mr-3 file:rounded-lg file:border-0 file:bg-elev file:px-3 file:py-2 file:text-fg"
          />
        </label>
        <Select
          name="rights"
          label={t("autoarrange:audio.rightsLabel")}
          defaultValue="own_recording"
        >
          {AUDIO_RIGHTS.map((r) => (
            <option key={r} value={r}>
              {t(`autoarrange:audio.rights.${r}`)}
            </option>
          ))}
        </Select>
        <Input name="note" label={t("autoarrange:audio.note")} maxLength={500} />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={declared}
            onChange={(e) => setDeclared(e.target.checked)}
            className="mt-0.5 size-5 accent-[var(--color-accent-500)]"
          />
          <span>{t("autoarrange:audio.declaration")}</span>
        </label>
        <div>
          <Button
            type="submit"
            icon={<Upload className="size-4" />}
            loading={busy || upload.isPending || declare.isPending}
            disabled={!file || !declared}
          >
            {t("autoarrange:pre.generateFromFile")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function MicWay({
  bandId,
  songId,
  player,
  onStage,
  busy,
}: {
  bandId: string;
  songId: string;
  player: PlayerControls | null;
  onStage: (s: LocalWork | null) => void;
  busy: boolean;
}) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const { toast } = useToast();
  const generate = useGenerate(bandId, songId, onStage);
  const capture = useRef<MicCapture | null>(null);
  const [listening, setListening] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);

  useEffect(() => () => capture.current?.cancel(), []);

  const finish = async () => {
    const cap = capture.current;
    capture.current = null;
    setListening(false);
    if (!cap) return;
    const heard = cap.seconds();
    if (heard < MIC_MIN_SECONDS) {
      cap.cancel();
      toast(t("autoarrange:pre.micTooShort", { seconds: MIC_MIN_SECONDS }), "error");
      return;
    }
    const pcm = cap.stop();
    try {
      await generate("microphone", async () => pcm, null);
      toast(t("autoarrange:pre.generated"), "success");
    } catch (err) {
      toast(failureText(t, err), "error");
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: finish only reads refs and setters
  useEffect(() => {
    if (!listening) return;
    const id = window.setInterval(() => {
      const cap = capture.current;
      if (!cap) return;
      setSeconds(cap.seconds());
      setLevel(cap.level());
      if (cap.seconds() >= MIC_MAX_SECONDS) void finish();
    }, 250);
    return () => window.clearInterval(id);
  }, [listening]);

  const start = async () => {
    try {
      capture.current = await startMicCapture(MIC_MAX_SECONDS);
      setSeconds(0);
      setListening(true);
      // Start the reference from the beginning, so the whole recording is heard.
      if (player?.ready) {
        player.seek(0);
        player.play();
      }
    } catch (err) {
      toast(failureText(t, err), "error");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("autoarrange:pre.micExplain")}</p>
      {listening ? (
        <div className="flex flex-col gap-3" data-testid="mic-listening">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg tabular-nums">
              {formatDuration(Math.round(seconds))}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
              <span
                className="block h-full bg-accent-500 transition-[width]"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Square className="size-4" />} onClick={() => void finish()}>
              {t("autoarrange:pre.micStop")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                capture.current?.cancel();
                capture.current = null;
                setListening(false);
              }}
            >
              {t("common:actions.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button icon={<Mic className="size-4" />} loading={busy} onClick={() => void start()}>
            {t("autoarrange:pre.micStart")}
          </Button>
        </div>
      )}
    </div>
  );
}

function MarksWay({
  bandId,
  songId,
  overview,
  player,
}: {
  bandId: string;
  songId: string;
  overview: SongAnalysisOverview;
  player: PlayerControls | null;
}) {
  const { t } = useTranslation(["autoarrange", "common"]);
  const { toast } = useToast();
  const submit = useSubmitPrearrangement(bandId, songId);
  const [marks, setMarks] = useState<number[]>([]);
  const known = tempoForMarks(overview);
  const [bpm, setBpm] = useState(known ? String(Math.round(known.bpm * 10) / 10) : "");
  const canMark = !!player?.ready;

  const create = async () => {
    const value = Number(bpm.replace(",", "."));
    const built = prearrangementFromMarks({
      marks,
      durationSec: player?.duration ?? 0,
      bpm: value,
      bpmOrigin: known && Math.abs(known.bpm - value) < 0.05 ? known.origin : "user",
      beatsPerBar: overview.song.version.beatsPerBar,
    });
    if (!built) {
      toast(t("autoarrange:pre.marksNeedTempo"), "error");
      return;
    }
    try {
      await submit.mutateAsync(built);
      setMarks([]);
      toast(t("autoarrange:pre.generated"), "success");
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  if (!canMark) return <p className="text-sm text-muted">{t("autoarrange:pre.marksNeedPlayer")}</p>;

  return (
    <div className="flex flex-col gap-3" data-testid="marks-way">
      <p className="text-sm text-muted">{t("autoarrange:pre.marksExplain")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          icon={<Play className="size-4" />}
          onClick={() => {
            setMarks([]);
            player.seek(0);
            player.play();
          }}
        >
          {t("autoarrange:pre.marksFromStart")}
        </Button>
        <Button
          icon={<Flag className="size-4" />}
          onClick={() => setMarks((m) => [...m, Math.round(player.now() * 10) / 10])}
        >
          {t("autoarrange:pre.markHere")}
        </Button>
      </div>
      {marks.length > 0 ? (
        <ol className="flex flex-wrap gap-1.5" data-testid="marks">
          {[...marks]
            .sort((a, b) => a - b)
            .map((m) => (
              <li
                key={m}
                className="inline-flex items-center gap-1 rounded-lg bg-sunken px-2 py-1 font-mono text-xs"
              >
                {formatDuration(Math.round(m))}
                <button
                  type="button"
                  aria-label={t("autoarrange:pre.removeMark")}
                  onClick={() => setMarks((all) => all.filter((x) => x !== m))}
                  className="text-muted hover:text-fg"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
        </ol>
      ) : null}
      <Input
        label={t("autoarrange:pre.marksTempo")}
        hint={
          known
            ? t(`autoarrange:pre.marksTempoFrom.${known.origin}`)
            : t("autoarrange:pre.marksTempoHint")
        }
        inputMode="decimal"
        value={bpm}
        onChange={(e) => setBpm(e.target.value)}
        className="max-w-48"
      />
      <div>
        <Button
          onClick={() => void create()}
          loading={submit.isPending}
          disabled={marks.length === 0 || !(Number(bpm.replace(",", ".")) > 0)}
        >
          {t("autoarrange:pre.marksCreate")}
        </Button>
      </div>
    </div>
  );
}

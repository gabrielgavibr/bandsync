import type { RecordingArrangementDto, SongSectionDto } from "@bandsync/shared";
import { describe, expect, it } from "vitest";
import {
  type EditableSection,
  fromPrearrangement,
  fromSaved,
  loopSummary,
  mergeWithNext,
  move,
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
} from "../src/features/arrangement/model";
import { prearrangementFromMarks } from "../src/features/arrangement/prep";

const pre: RecordingArrangementDto = {
  id: "pre1",
  songId: "song",
  recordingId: "rec",
  source: "audio_file",
  audioAssetId: "asset",
  engine: "bandsync-onset",
  version: "prearrange-v1",
  createdBy: "u",
  createdByName: "Ana",
  createdAt: "2026-11-10T00:00:00Z",
  data: {
    analysedSeconds: 60,
    bpm: { value: 120, ambiguous: false, alternatives: [], origin: "audio_analysis" },
    beatsPerBar: 4,
    key: { key: "Am", alternatives: [] },
    firstDownbeatSec: 0,
    barSeconds: 2,
    bars: 20,
    sections: [
      {
        label: "A",
        kind: "intro",
        kindConfidence: "low",
        startSec: 0,
        endSec: 8,
        startBar: 0,
        bars: 4,
        chords: ["Am", "Am", "F", "G"],
        loudnessDb: -20,
        cues: [],
      },
      {
        label: "B",
        kind: "chorus",
        kindConfidence: "medium",
        startSec: 8,
        endSec: 24,
        startBar: 4,
        bars: 8,
        chords: ["C", "C", "G", "G", "Am", "Am", "F", "F"],
        loudnessDb: -12,
        cues: [{ bar: 7, type: "stop" }],
      },
      {
        label: "B",
        kind: "chorus",
        kindConfidence: "medium",
        startSec: 24,
        endSec: 40,
        startBar: 12,
        bars: 8,
        chords: ["C", "C", "G", "G", "Am", "Am", "F", "F"],
        loudnessDb: -12,
        cues: [{ bar: 0, type: "texture" }],
      },
    ],
  },
};

const nameFor = (kind: string | null, label: string, nth: number) =>
  kind ? `${kind}${nth > 1 ? ` ${nth}` : ""}` : `Seção ${label}`;

const names = (l: EditableSection[]) => l.map((s) => s.name);

describe("band arrangement from the recording's pre-arrangement", () => {
  const start = fromPrearrangement(pre, nameFor, (t) => (t === "stop" ? "Parada" : "Entrada"));

  it("names a section only when the analysis had reasonable evidence", () => {
    // The intro guess had low confidence: it keeps its letter.
    expect(names(start)).toEqual(["Seção A", "chorus", "chorus 2"]);
    expect(start.map((s) => s.kind)).toEqual([null, "chorus", "chorus"]);
  });

  it("keeps bars, chords, letters and where each part is in the recording", () => {
    expect(start.map((s) => s.bars)).toEqual([4, 8, 8]);
    expect(start[1]!.chords).toEqual(pre.data.sections[1]!.chords);
    expect(start.map((s) => s.label)).toEqual(["A", "B", "B"]);
    expect(start.map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 8000],
      [8000, 24000],
      [24000, 40000],
    ]);
  });

  it("carries stops and entries over as cues (1-based bar), not texture changes", () => {
    expect(start[1]!.cues).toEqual([{ type: "stop", text: "Parada", bar: 8 }]);
    expect(start[2]!.cues).toEqual([]);
  });

  it("never changes the pre-arrangement it came from", () => {
    const snapshot = JSON.stringify(pre);
    let list = start;
    list = remove(list, 0);
    list = repeat(list, 1);
    list = setBars(list, 0, 4);
    list[0]!.chords.push("X");
    expect(JSON.stringify(pre)).toBe(snapshot);
  });

  it("removes the intro, repeats the chorus and shortens a part", () => {
    let list = remove(start, 0);
    list = repeat(list, 1);
    expect(names(list)).toEqual(["chorus", "chorus 2", "chorus 2"]);
    expect(list[1]!.key).not.toBe(list[2]!.key);
    list = setBars(list, 2, 4);
    expect(list[2]!.bars).toBe(4);
    expect(list[2]!.chords).toEqual(["C", "C", "G", "G"]);
    expect(totalBars(list)).toBe(20);
  });

  it("reorders, splits and joins", () => {
    const moved = move(start, 0, 1);
    expect(names(moved)).toEqual(["chorus", "Seção A", "chorus 2"]);
    expect(move(start, 0, -1)).toBe(start);
    const parts = split(start, 1, 4);
    expect(parts.map((s) => s.bars)).toEqual([4, 4, 4, 8]);
    expect(parts[1]!.cues).toEqual([]);
    expect(parts[2]!.cues).toEqual([{ type: "stop", text: "Parada", bar: 4 }]);
    expect([parts[1]!.endMs, parts[2]!.startMs]).toEqual([16000, 16000]);
    const joined = mergeWithNext(parts, 1);
    expect(joined[1]!.bars).toBe(8);
    expect(joined[1]!.chords).toEqual(pre.data.sections[1]!.chords);
    expect(joined[1]!.cues).toEqual([{ type: "stop", text: "Parada", bar: 8 }]);
  });

  it("round-trips through what is saved", () => {
    const saved = toSaved(start).map(
      (s, i): SongSectionDto => ({ ...s, id: `x${i}`, notes: s.notes ?? null }) as SongSectionDto,
    );
    const back = fromSaved(saved);
    expect(toSaved(back)).toEqual(toSaved(start));
  });
});

describe("chords", () => {
  it("reads one chord per bar, repeating the last one", () => {
    expect(parseChordLine("Am | F  C,G", 4)).toEqual(["Am", "F", "C", "G"]);
    expect(parseChordLine("Am F", 4)).toEqual(["Am", "F", "F", "F"]);
    expect(parseChordLine("  ", 4)).toEqual([]);
  });

  it("collapses repeats into a progression", () => {
    expect(progression(["Am", "Am", "N", "F", "F", "Am"])).toEqual(["Am", "F", "Am"]);
  });

  it("transposes the harmony", () => {
    expect(transposeChordLabel("Am", 2, false)).toBe("Bm");
    expect(transposeChordLabel("C7", -2, true)).toBe("Bb7");
    expect(transposeChordLabel("F#m", 1, false)).toBe("Gm");
    expect(transposeChordLabel("N", 3, false)).toBe("N");
  });
});

describe("pre-arrangement from a member's marks", () => {
  it("cuts the recording at the marks and counts bars from the tempo", () => {
    const out = prearrangementFromMarks({
      marks: [16.1, 48.2, 47.5, 80],
      durationSec: 96,
      bpm: 120,
      bpmOrigin: "user",
      beatsPerBar: 4,
    })!;
    expect(out.source).toBe("member_marks");
    expect(out.barSeconds).toBe(2);
    // 47.5 and 48.2 are less than two seconds apart: one boundary.
    expect(out.sections.map((s) => [s.startSec, s.endSec])).toEqual([
      [0, 16.1],
      [16.1, 47.5],
      [47.5, 80],
      [80, 96],
    ]);
    expect(out.sections.map((s) => s.bars)).toEqual([8, 16, 16, 8]);
    expect(out.sections.map((s) => s.startBar)).toEqual([0, 8, 24, 40]);
    expect(out.bars).toBe(48);
  });

  it("names nothing and invents no chords", () => {
    const out = prearrangementFromMarks({
      marks: [30],
      durationSec: 60,
      bpm: 90,
      bpmOrigin: "deezer",
      beatsPerBar: 4,
    })!;
    expect(out.sections.map((s) => [s.label, s.kind, s.kindConfidence])).toEqual([
      ["A", "unknown", "low"],
      ["B", "unknown", "low"],
    ]);
    expect(out.sections.every((s) => s.chords.length === 0)).toBe(true);
    expect(out.key).toBeNull();
    expect(out.bpm).toEqual({ value: 90, ambiguous: false, alternatives: [], origin: "deezer" });
  });

  it("needs a duration and a tempo", () => {
    const base = { marks: [10], bpmOrigin: "user" as const, beatsPerBar: 4 };
    expect(prearrangementFromMarks({ ...base, durationSec: 0, bpm: 100 })).toBeNull();
    expect(prearrangementFromMarks({ ...base, durationSec: 60, bpm: 0 })).toBeNull();
  });
});

describe("limits of a section in the recording, corrected while listening", () => {
  const start = fromPrearrangement(pre, nameFor);
  const times = (l: EditableSection[]) => l.map((s) => [s.startMs, s.endMs]);

  it("moving an end moves the next section's start with it, and bars follow", () => {
    const out = setTimes(start, 0, { endMs: 12_000 }, pre.data.barSeconds);
    expect(times(out)).toEqual([
      [0, 12_000],
      [12_000, 24_000],
      [24_000, 40_000],
    ]);
    // Two seconds a bar: six bars now, the harmony carried on in its own cycle; six left next door.
    expect(out.map((s) => s.bars)).toEqual([6, 6, 8]);
    expect(out[0]!.chords).toEqual(["Am", "Am", "F", "G", "Am", "Am"]);
    expect(out[1]!.chords).toEqual(["C", "C", "G", "G", "Am", "Am"]);
    expect(times(start)[0]).toEqual([0, 8000]); // the input list is untouched
  });

  it("moving a start moves the previous section's end", () => {
    const out = setTimes(start, 1, { startMs: 6500 }, pre.data.barSeconds);
    expect(times(out).slice(0, 2)).toEqual([
      [0, 6500],
      [6500, 24_000],
    ]);
  });

  it("limits never cross: every section keeps at least half a second", () => {
    expect(times(setTimes(start, 0, { endMs: 99_000 }, null))[0]).toEqual([0, 23_500]);
    expect(times(setTimes(start, 1, { startMs: -5 }, null))[1]).toEqual([500, 24_000]);
    expect(times(setTimes(start, 1, { endMs: 0 }, null))[1]).toEqual([8000, 8500]);
  });

  it("without a known bar length only the times change", () => {
    const out = setTimes(start, 0, { endMs: 12_000 }, null);
    expect(out.map((s) => s.bars)).toEqual([4, 8, 8]);
  });

  it("a section moved away from its neighbour no longer drags it", () => {
    const apart = start.map((s, i) => (i === 1 ? { ...s, startMs: 9000 } : s));
    const out = setTimes(apart, 0, { endMs: 7000 }, null);
    expect(times(out).slice(0, 2)).toEqual([
      [0, 7000],
      [9000, 24_000],
    ]);
  });

  it("splits at the moment playback is", () => {
    const out = splitAtTime(start, 1, 14_000, pre.data.barSeconds);
    expect(times(out)).toEqual([
      [0, 8000],
      [8000, 14_000],
      [14_000, 24_000],
      [24_000, 40_000],
    ]);
    expect(out.map((s) => s.bars)).toEqual([4, 3, 5, 8]);
    expect(out[1]!.chords).toEqual(["C", "C", "G"]);
    expect(out[2]!.chords).toEqual(["G", "Am", "Am", "F", "F"]);
    // Too close to an edge: nothing happens.
    expect(splitAtTime(start, 1, 8100, null)).toBe(start);
    // Joining puts it back.
    const joined = mergeWithNext(out, 1);
    expect(times(joined)).toEqual(times(start));
    expect(joined[1]!.chords).toEqual(start[1]!.chords);
  });
});

describe("a section that is one loop played several times", () => {
  const LOOP = ["Gm", "Gm", "Dm", "Dm", "Eb", "Eb", "Bb", "F"];
  it("is summarised as the loop and how many times it goes round", () => {
    expect(loopSummary([...LOOP, ...LOOP, ...LOOP, ...LOOP], 8)).toEqual({
      chords: ["Gm", "Dm", "Eb", "Bb", "F"],
      times: 4,
    });
  });
  it("tolerates unclear bars in some rounds", () => {
    const thin = ["Gm", "N", "Dm", "Dm", "Eb", "N", "Bb", "N"];
    expect(loopSummary([...LOOP, ...thin, ...LOOP], 8)).toEqual({
      chords: ["Gm", "Dm", "Eb", "Bb", "F"],
      times: 3,
    });
  });
  it("is not claimed for one round, a partial round or rounds that differ", () => {
    expect(loopSummary(LOOP, 8)).toBeNull();
    expect(loopSummary([...LOOP, ...LOOP.slice(0, 4)], 8)).toBeNull();
    expect(loopSummary([...LOOP, "C", "C", "F", "F", "G", "G", "C", "C"], 8)).toBeNull();
    expect(loopSummary([...LOOP, ...LOOP], null)).toBeNull();
  });
});

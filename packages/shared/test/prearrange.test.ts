import { describe, expect, it } from "vitest";
import { prearrange, progression } from "../src/analysis/prearrange";
import { CHORDS, synthSong } from "../src/analysis/synth";

const { C, F, G, Am, Dm, E, Em, D, Bm, A } = CHORDS;

/** Verse – chorus – verse – chorus – bridge – chorus – outro, with an intro: a typical pop/reggae form. */
function popSong(bpm = 96) {
  return synthSong({
    bpm,
    beatsPerBar: 4,
    parts: [
      { name: "intro", bars: 4, chords: [Am, F], energy: 0.25 },
      { name: "verse", bars: 8, chords: [Am, F, C, G], energy: 0.5 },
      { name: "chorus", bars: 8, chords: [F, G, C, C], energy: 1, lead: true },
      { name: "verse", bars: 8, chords: [Am, F, C, G], energy: 0.5 },
      { name: "chorus", bars: 8, chords: [F, G, C, C], energy: 1, lead: true },
      { name: "bridge", bars: 8, chords: [Dm, E, Dm, E], energy: 0.7 },
      { name: "chorus", bars: 8, chords: [F, G, C, C], energy: 1, lead: true },
      { name: "outro", bars: 4, chords: [Am], energy: 0.2 },
    ],
  });
}

describe("pre-arrangement of a whole song with a known form", () => {
  const song = popSong();
  const r = prearrange([song.samples], song.sampleRate);
  const truthStarts = song.truth.map((t) => t.startSec);

  it("finds every section boundary within one bar", () => {
    const bar = (60 / 96) * 4;
    const found = r.sections.map((s) => s.startSec).slice(1);
    for (const t of truthStarts.slice(1)) {
      const nearest = Math.min(...found.map((f) => Math.abs(f - t)));
      expect(
        nearest,
        `boundary at ${t.toFixed(1)} s; found ${found.map((f) => f.toFixed(1))}`,
      ).toBeLessThanOrEqual(bar);
    }
    expect(r.sections).toHaveLength(song.truth.length);
  });

  it("gives repeated sections the same letter and different sections different letters", () => {
    const letters = r.sections.map((s) => s.label);
    // intro, verse, chorus, verse, chorus, bridge, chorus, outro
    expect(letters[1]).toBe(letters[3]);
    expect(letters[2]).toBe(letters[4]);
    expect(letters[2]).toBe(letters[6]);
    expect(new Set([letters[0], letters[1], letters[2], letters[5], letters[7]]).size).toBe(5);
  });

  it("names the louder repeated part as the chorus and the other as the verse", () => {
    const kinds = r.sections.map((s) => s.kind);
    expect(kinds).toEqual([
      "intro",
      "verse",
      "chorus",
      "verse",
      "chorus",
      "bridge",
      "chorus",
      "outro",
    ]);
    // Nothing is presented as certain.
    expect(
      r.sections.every((s) => s.kindConfidence === "medium" || s.kindConfidence === "low"),
    ).toBe(true);
  });

  it("counts bars and reads the chords of each section", () => {
    expect(r.beatsPerBar).toBe(4);
    expect(r.sections.map((s) => s.bars)).toEqual([4, 8, 8, 8, 8, 8, 8, 4]);
    expect(progression(r.sections[1]!.chords).slice(0, 4)).toEqual(["Am", "F", "C", "G"]);
    expect(progression(r.sections[2]!.chords).slice(0, 3)).toEqual(["F", "G", "C"]);
    expect(progression(r.sections[5]!.chords).slice(0, 2)).toEqual(["Dm", "E"]);
    expect(Math.abs(r.report.bpm!.value - 96)).toBeLessThanOrEqual(0.5);
  });

  it("marks where the band comes in and drops out", () => {
    // Verse -> chorus is a jump in level; chorus -> verse a drop.
    expect(r.sections[2]!.cues.some((c) => c.type === "entry")).toBe(true);
    expect(r.sections[3]!.cues.some((c) => c.type === "drop")).toBe(true);
  });
});

describe("pre-arrangement in other shapes", () => {
  it("works in 3/4 and keeps letters when nothing can be named", () => {
    const song = synthSong({
      bpm: 120,
      beatsPerBar: 3,
      parts: [
        { name: "A", bars: 8, chords: [G, C, D, G], energy: 0.6 },
        { name: "B", bars: 8, chords: [Em, Bm, C, D], energy: 0.6, lead: true },
        { name: "A", bars: 8, chords: [G, C, D, G], energy: 0.6 },
        { name: "B", bars: 8, chords: [Em, Bm, C, D], energy: 0.6, lead: true },
      ],
    });
    const r = prearrange([song.samples], song.sampleRate);
    expect(r.beatsPerBar).toBe(3);
    expect(r.sections.map((s) => s.label)).toEqual(["A", "B", "A", "B"]);
    expect(r.sections.map((s) => s.bars)).toEqual([8, 8, 8, 8]);
  });

  it("a song that never repeats gets letters only", () => {
    const song = synthSong({
      bpm: 100,
      beatsPerBar: 4,
      parts: [
        { name: "1", bars: 8, chords: [D, A], energy: 0.4 },
        { name: "2", bars: 8, chords: [Bm, G], energy: 0.9, lead: true },
        { name: "3", bars: 8, chords: [Em, A], energy: 0.6 },
      ],
    });
    const r = prearrange([song.samples], song.sampleRate);
    expect(r.sections.map((s) => s.label)).toEqual(["A", "B", "C"]);
    expect(r.sections.every((s) => s.kind === "unknown" || s.kindConfidence === "low")).toBe(true);
  });
});

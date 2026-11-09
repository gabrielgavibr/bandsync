import { describe, expect, it } from "vitest";
import {
  formatChord,
  isChordLine,
  parseChord,
  respellChordSheet,
  transposeChord,
  transposeChordSheet,
} from "../src/music/chords";

describe("chords", () => {
  it("parses common chord symbols", () => {
    expect(parseChord("Am7")).toEqual({ root: 9, quality: "m7", bass: null });
    expect(parseChord("F#m7(b5)")).toEqual({ root: 6, quality: "m7(b5)", bass: null });
    expect(parseChord("C/E")).toEqual({ root: 0, quality: "", bass: 4 });
    expect(parseChord("Bbmaj7")).toEqual({ root: 10, quality: "maj7", bass: null });
    expect(parseChord("Dsus4")).toEqual({ root: 2, quality: "sus4", bass: null });
    expect(parseChord("G7/B")).toEqual({ root: 7, quality: "7", bass: 11 });
    expect(parseChord("Bridge")).toBeNull();
    expect(parseChord("Amor")).toBeNull();
    expect(parseChord("hello")).toBeNull();
  });

  it("transposes with correct spelling for the target key", () => {
    const c = parseChord("D")!;
    expect(formatChord(transposeChord(c, -2))).toBe("C");
    expect(formatChord(transposeChord(parseChord("F#m")!, 1), { flats: true })).toBe("Gm");
    expect(formatChord(transposeChord(parseChord("A")!, 1), { flats: true })).toBe("Bb");
    expect(formatChord(transposeChord(parseChord("A")!, 1), { flats: false })).toBe("A#");
  });

  it("detects chord lines but not lyric lines", () => {
    expect(isChordLine("D   A   Bm   G")).toBe(true);
    expect(isChordLine("| D | A | Bm | G |")).toBe(true);
    expect(isChordLine("A rua estava vazia")).toBe(false);
    expect(isChordLine("Bridge")).toBe(false);
  });

  it("transposes a chords-over-lyrics sheet preserving layout", () => {
    const sheet = ["D        A        Bm", "Some lyrics here go", "G   D/F#   Em7  A7"].join("\n");
    const out = transposeChordSheet(sheet, {
      semitones: -2,
      targetKey: { tonic: 0, mode: "major" },
    });
    expect(out.split("\n")[0]).toBe("C        G        Am");
    expect(out.split("\n")[1]).toBe("Some lyrics here go");
    expect(out.split("\n")[2]).toBe("F   C/E   Dm7  G7");
  });

  it("transposes inline bracket chords and leaves non-chord brackets", () => {
    const out = transposeChordSheet("[D]Hello [A]world [Chorus]", {
      semitones: 2,
      targetKey: { tonic: 4, mode: "major" },
    });
    expect(out).toBe("[E]Hello [B]world [Chorus]");
  });

  it("respells in latin notation", () => {
    expect(respellChordSheet("D   A7/C#   Bm", "latin")).toBe("Ré   Lá7/Dó#   Sim");
    expect(respellChordSheet("verse lyrics", "latin")).toBe("verse lyrics");
  });
});

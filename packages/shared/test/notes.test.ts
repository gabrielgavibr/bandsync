import { describe, expect, it } from "vitest";
import {
  formatKey,
  intervalBetween,
  parseKey,
  parseNote,
  spellPitchClass,
  toLatin,
  transposeKey,
} from "../src/music/notes";

describe("notes", () => {
  it("parses english and latin note names", () => {
    expect(parseNote("C")).toBe(0);
    expect(parseNote("F#")).toBe(6);
    expect(parseNote("Bb")).toBe(10);
    expect(parseNote("Cb")).toBe(11);
    expect(parseNote("Ré")).toBe(2);
    expect(parseNote("Sib")).toBe(10);
    expect(parseNote("Sol#")).toBe(8);
    expect(parseNote("H")).toBeNull();
    expect(parseNote("")).toBeNull();
  });

  it("spells pitch classes in both notations", () => {
    expect(spellPitchClass(1)).toBe("C#");
    expect(spellPitchClass(1, { flats: true })).toBe("Db");
    expect(spellPitchClass(2, { notation: "latin" })).toBe("Ré");
    expect(spellPitchClass(10, { flats: true, notation: "latin" })).toBe("Sib");
    expect(toLatin("F#")).toBe("Fá#");
  });

  it("parses and formats keys", () => {
    expect(parseKey("D")).toEqual({ tonic: 2, mode: "major" });
    expect(parseKey("Am")).toEqual({ tonic: 9, mode: "minor" });
    expect(parseKey("Ré menor")).toEqual({ tonic: 2, mode: "minor" });
    expect(formatKey({ tonic: 10, mode: "major" })).toBe("Bb");
    expect(formatKey({ tonic: 6, mode: "major" })).toBe("Gb");
    expect(formatKey({ tonic: 1, mode: "minor" })).toBe("C#m");
    expect(formatKey({ tonic: 2, mode: "minor" }, "latin")).toBe("Rém");
  });

  it("transposes keys and computes intervals", () => {
    expect(transposeKey({ tonic: 2, mode: "major" }, -2)).toEqual({ tonic: 0, mode: "major" });
    expect(intervalBetween({ tonic: 2, mode: "major" }, { tonic: 0, mode: "major" })).toBe(-2);
    expect(intervalBetween({ tonic: 0, mode: "major" }, { tonic: 7, mode: "major" })).toBe(-5);
  });
});

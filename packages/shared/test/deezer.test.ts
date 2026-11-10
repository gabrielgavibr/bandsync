import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  comparableTitle,
  normalizeDeezerSearch,
  normalizeDeezerTrack,
  pickDeezerMatch,
} from "../src/autoarrange/deezer";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "musicbrainz", name), "utf8"));

describe("Deezer (real answers)", () => {
  it("reads BPM and duration of Pérola Negra found by its ISRC", () => {
    expect(normalizeDeezerTrack(fixture("deezer-isrc-perola-negra.json"))).toMatchObject({
      title: "Pérola Negra (feat. Luiz Melodia)",
      artist: "Natiruts",
      album: "Natiruts Acústico no Rio de Janeiro (Ao Vivo)",
      durationSec: 212,
      bpm: 130,
      isrc: "BR4W41200009",
    });
  });

  it("reports no BPM when Deezer has none (it sends 0)", () => {
    expect(normalizeDeezerTrack(fixture("deezer-track-o-segundo-sol.json"))!.bpm).toBeNull();
    expect(normalizeDeezerTrack({ error: { code: 800, message: "no data" } })).toBeNull();
  });

  it("picks the exact recording among versions only when the duration agrees", () => {
    const tracks = normalizeDeezerSearch(fixture("deezer-search-esoterico.json"));
    expect(tracks.length).toBeGreaterThan(3); // studio, live, first version, re-recording…
    // Um Banda Um is 262.4 s in MusicBrainz.
    expect(pickDeezerMatch(tracks, { title: "Esotérico", durationSec: 262.4 })).toMatchObject({
      id: 876104442,
      album: "Um banda um",
    });
    // Without a duration, a title alone does not identify the recording.
    expect(pickDeezerMatch(tracks, { title: "Esotérico", durationSec: null })).toBeNull();
    // A duration nobody has: no match rather than a near guess.
    expect(pickDeezerMatch(tracks, { title: "Esotérico", durationSec: 200 })).toBeNull();
    const sol = normalizeDeezerSearch(fixture("deezer-search-o-segundo-sol.json"));
    expect(pickDeezerMatch(sol, { title: "O Segundo Sol", durationSec: 257.5 })).toMatchObject({
      album: "Cássia Reggae (Vol. 1)",
    });
  });

  it("compares titles without accents, parentheses or featured artists", () => {
    expect(comparableTitle("Pérola Negra (feat. Luiz Melodia)")).toBe("perola negra");
    expect(comparableTitle("Esotérico - Regravação Take 01")).toBe("esoterico");
    expect(comparableTitle("O Segundo Sol (Ao Vivo)")).toBe("o segundo sol");
  });
});

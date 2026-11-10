import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  comparableTitle,
  normalizeDeezerSearch,
  normalizeDeezerTrack,
  pickDeezerMatch,
  pickDeezerVersion,
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

describe("which version a link is, before any length is known (real answers)", () => {
  const perola = normalizeDeezerSearch(fixture("deezer-search-perola-negra.json"));
  const esoterico = normalizeDeezerSearch(fixture("deezer-search-esoterico.json"));
  const YT_PEROLA =
    "Natiruts - Pérola Negra (Natiruts Acústico Ao Vivo no Rio de Janeiro) ft. Luiz Melodia";

  it("takes Pérola Negra from the video's own title: live, acoustic, in Rio", () => {
    const m = pickDeezerVersion(perola, {
      title: "Pérola Negra",
      artist: "Natiruts feat. Luiz Melodia",
      linkTitle: YT_PEROLA,
      linkAuthor: "NatirutsVEVO",
    });
    expect(m).toMatchObject({
      track: { id: 429918992, durationSec: 212 },
      evidence: "only_version",
    });
    expect(m!.words).toEqual(expect.arrayContaining(["rio", "janeiro"]));
  });

  it("does not take a live recording for a link that does not say it is live", () => {
    expect(
      pickDeezerVersion(perola, {
        title: "Pérola Negra",
        artist: "Natiruts",
        linkTitle: "Natiruts - Pérola Negra",
      }),
    ).toBeNull();
  });

  it("does not guess among the versions of Esotérico from a bare title", () => {
    expect(
      pickDeezerVersion(esoterico, {
        title: "Esotérico",
        artist: "Gilberto Gil",
        linkTitle: "Gilberto Gil - Esotérico",
      }),
    ).toBeNull();
    // Live versions exist on three albums: "ao vivo" alone does not say which.
    expect(
      pickDeezerVersion(esoterico, {
        title: "Esotérico",
        artist: "Gilberto Gil",
        linkTitle: "Gilberto Gil - Esotérico (Ao Vivo)",
      }),
    ).toBeNull();
  });

  it("uses the album named in the link, and leaves out versions the link does not name", () => {
    // "Um banda um" also holds a first version and a re-recording: only the plain one fits.
    expect(
      pickDeezerVersion(esoterico, {
        title: "Esotérico",
        artist: "Gilberto Gil",
        linkTitle: "Gilberto Gil - Esotérico (Um Banda Um, 1982)",
      }),
    ).toMatchObject({ track: { id: 876104442 }, evidence: "version_words" });
    expect(
      pickDeezerVersion(esoterico, {
        title: "Esotérico",
        artist: "Gilberto Gil",
        linkTitle: "Gilberto Gil - Esotérico (Ao Vivo) - Trinca de Ases",
      }),
    ).toMatchObject({ track: { id: 4244900941 } });
  });

  it("needs the link to be about this song and this artist", () => {
    // A video of another song (the mistake of pointing a song at the wrong link).
    expect(
      pickDeezerVersion(esoterico, {
        title: "Esotérico",
        artist: "Gilberto Gil",
        linkTitle: YT_PEROLA,
      }),
    ).toBeNull();
    expect(
      pickDeezerVersion(perola, {
        title: "Pérola Negra",
        artist: "Outra Banda",
        linkTitle: "Outra Banda - Pérola Negra (Acústico Ao Vivo)",
      }),
    ).toBeNull();
    expect(
      pickDeezerVersion(perola, { title: "Pérola Negra", artist: null, linkTitle: null }),
    ).toBeNull();
  });
});

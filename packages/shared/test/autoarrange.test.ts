import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  jobDedupeKey,
  jobProgress,
  nextStep,
  retryDelayMs,
  statusForStep,
} from "../src/autoarrange/jobs";
import {
  buildRecordingQuery,
  isLiveRecording,
  normalizeRecordingLookup,
  normalizeSearchResponse,
  pickDefaultRelease,
  recordingLookupUrl,
  recordingSearchUrl,
  workAuthors,
} from "../src/autoarrange/musicbrainz";
import {
  initialReviewStatus,
  type JobStepRecord,
  prepareSongSchema,
  reviewSchema,
} from "../src/autoarrange/types";
import { parseYouTubeUrl, youtubeEmbedUrl, youtubeOEmbedUrl } from "../src/autoarrange/youtube";

// Real responses captured from musicbrainz.org (core data, CC0) on the day the connector was written.
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "musicbrainz", name), "utf8"));

describe("MusicBrainz queries", () => {
  it("quotes and escapes title and artist", () => {
    expect(buildRecordingQuery({ title: "Pérola Negra", artist: "Natiruts" })).toBe(
      'recording:"Pérola Negra" AND artist:"Natiruts"',
    );
    expect(buildRecordingQuery({ title: 'Say "Hi"', artist: " " })).toBe(
      'recording:"Say \\"Hi\\""',
    );
    const url = new URL(
      recordingSearchUrl(
        "https://musicbrainz.org",
        { title: "Esotérico", artist: "Gilberto Gil" },
        10,
      ),
    );
    expect(url.pathname).toBe("/ws/2/recording");
    expect(url.searchParams.get("fmt")).toBe("json");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(recordingLookupUrl("https://musicbrainz.org/", "abc")).toContain(
      "/ws/2/recording/abc?inc=artist-credits",
    );
  });
});

describe("MusicBrainz search normalisation (real responses)", () => {
  it("finds the Natiruts live recording of Pérola Negra with its ISRC and releases", () => {
    const list = normalizeSearchResponse(fixture("search-perola-negra.json"));
    expect(list).toHaveLength(2);
    const live = list.find((r) => r.mbid === "0dea3c9a-ef6b-4707-90d8-685b2f4a2cd8")!;
    expect(live.title).toBe("Pérola negra");
    expect(live.artistCredit).toBe("Natiruts Part. Especial Luiz Melodia");
    expect(live.artists.map((a) => a.name)).toEqual(["Natiruts", "Luiz Melodia"]);
    expect(live.durationMs).toBe(209626);
    expect(live.isrcs).toEqual(["BR4W41200009"]);
    expect(live.disambiguation).toContain("Mirante Dona Marta");
    expect(live.url).toBe("https://musicbrainz.org/recording/0dea3c9a-ef6b-4707-90d8-685b2f4a2cd8");
    expect(isLiveRecording(live)).toBe(true);
    // Releases come oldest first; the default one is the original live album, not the 2020 compilation.
    expect(live.releases[0]!.date).toBe("2012-09-17");
    expect(pickDefaultRelease(live.releases)!.title).toBe("Acústico no Rio de Janeiro");
  });

  it("returns the many versions of Esotérico as separate recordings", () => {
    const list = normalizeSearchResponse(fixture("search-esoterico.json"));
    expect(list.length).toBeGreaterThanOrEqual(20);
    const umBandaUm = list.find((r) => r.mbid.startsWith("8379142a"))!;
    expect(umBandaUm.releases[0]!.title).toBe("Um Banda Um");
    expect(umBandaUm.durationMs).toBe(262400);
    expect(isLiveRecording(umBandaUm)).toBe(false);
    const docesBarbaros = list.find((r) => r.mbid.startsWith("d72d41dd"))!;
    expect(docesBarbaros.artistCredit).toBe(
      "Caetano Veloso, Gal Costa, Gilberto Gil & Maria Bethânia",
    );
    expect(docesBarbaros.durationMs).toBe(250733);
    expect(docesBarbaros.releases.some((r) => r.title === "Doces Bárbaros")).toBe(true);
    // Different recordings must never be merged: every id is unique and durations differ.
    expect(new Set(list.map((r) => r.mbid)).size).toBe(list.length);
    expect(new Set([umBandaUm.durationMs, docesBarbaros.durationMs]).size).toBe(2);
  });

  it("identifies Gilberto Gil's Cássia Reggae recording of O Segundo Sol", () => {
    const list = normalizeSearchResponse(fixture("search-o-segundo-sol.json"));
    const gil = list[0]!;
    expect(gil.artistCredit).toBe("Gilberto Gil");
    expect(gil.firstReleaseDate).toBe("2022-07-01");
    expect(gil.durationMs).toBe(257546);
    expect(gil.releases[0]!.title).toBe("Cássia Reggae, Vol. 1");
  });

  it("drops malformed entries instead of guessing", () => {
    expect(normalizeSearchResponse(null)).toEqual([]);
    expect(normalizeSearchResponse({ recordings: [{ title: "no id" }, { id: "x" }, 42] })).toEqual(
      [],
    );
    const [only] = normalizeSearchResponse({
      recordings: [{ id: "a", title: "T", length: 0, score: "88" }],
    });
    expect(only).toMatchObject({
      durationMs: null,
      artistCredit: "",
      releases: [],
      isrcs: [],
      score: 88,
    });
  });
});

describe("MusicBrainz lookup normalisation (real response)", () => {
  it("reads the work, its authors and the links of the Pérola Negra recording", () => {
    const d = normalizeRecordingLookup(fixture("lookup-perola-negra.json"))!;
    expect(d.mbid).toBe("0dea3c9a-ef6b-4707-90d8-685b2f4a2cd8");
    expect(d.works).toHaveLength(1);
    expect(d.works[0]).toMatchObject({
      mbid: "39fe8e07-adc0-4d8d-8e46-7ec134ae6ec1",
      title: "Pérola negra",
      composers: ["Luiz Melodia"],
      lyricists: ["Luiz Melodia"],
    });
    expect(workAuthors(d.works)).toEqual(["Luiz Melodia"]);
    expect(d.isrcs).toEqual(["BR4W41200009"]);
    for (const l of d.links) expect(l.url).toMatch(/^https?:\/\//);
  });

  it("returns null for an unusable payload", () => {
    expect(normalizeRecordingLookup(null)).toBeNull();
    expect(normalizeRecordingLookup({ title: "x" })).toBeNull();
  });
});

describe("YouTube links", () => {
  it("extracts the video id from the common URL shapes", () => {
    const id = "JZqFoTIAJj8";
    for (const u of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=30s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://music.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}?si=abc`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
    ]) {
      expect(parseYouTubeUrl(u), u).toBe(id);
    }
  });

  it("rejects other sites, bad ids and non-http schemes", () => {
    for (const u of [
      "https://vimeo.com/123",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/playlist?list=PL123",
      "https://evil.example/watch?v=JZqFoTIAJj8",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(parseYouTubeUrl(u), u).toBeNull();
    }
  });

  it("builds the official embed and oEmbed URLs", () => {
    expect(youtubeEmbedUrl("JZqFoTIAJj8")).toBe(
      "https://www.youtube-nocookie.com/embed/JZqFoTIAJj8",
    );
    const o = new URL(youtubeOEmbedUrl("https://www.youtube.com", "JZqFoTIAJj8"));
    expect(o.searchParams.get("url")).toBe("https://www.youtube.com/watch?v=JZqFoTIAJj8");
  });
});

describe("preparation jobs", () => {
  const rec = (step: JobStepRecord["step"], outcome: JobStepRecord["outcome"]): JobStepRecord => ({
    step,
    outcome,
    reason: null,
    detail: {},
    startedAt: "",
    finishedAt: "",
  });

  it("walks the steps in order and retries a failed step", () => {
    expect(nextStep([])).toBe("searching_references");
    expect(nextStep([rec("searching_references", "done")])).toBe("analyzing_audio");
    expect(nextStep([rec("searching_references", "done"), rec("analyzing_audio", "failed")])).toBe(
      "analyzing_audio",
    );
    const all = [
      rec("searching_references", "done"),
      rec("analyzing_audio", "skipped"),
      rec("detecting_structure", "skipped"),
      rec("preparing_materials", "done"),
    ];
    expect(nextStep(all)).toBeNull();
    expect(statusForStep(nextStep(all))).toBe("awaiting_review");
    expect(jobProgress("analyzing_audio", all.slice(0, 1))).toBe(25);
    expect(jobProgress("awaiting_review", all)).toBe(100);
  });

  it("derives one dedupe key per song, recording, audio file and pipeline version", () => {
    const a = jobDedupeKey({
      songId: "s",
      recordingId: "r",
      audioAssetId: null,
      pipelineVersion: "v1",
    });
    expect(a).toBe(
      jobDedupeKey({ songId: "s", recordingId: "r", audioAssetId: null, pipelineVersion: "v1" }),
    );
    expect(a).not.toBe(
      jobDedupeKey({ songId: "s", recordingId: "r2", audioAssetId: null, pipelineVersion: "v1" }),
    );
    expect(a).not.toBe(
      jobDedupeKey({ songId: "s", recordingId: "r", audioAssetId: "x", pipelineVersion: "v1" }),
    );
  });

  it("backs off between retries with a ceiling", () => {
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(2)).toBe(4000);
    expect(retryDelayMs(20)).toBe(60000);
  });
});

describe("review rules", () => {
  it("never treats an algorithmic estimate as reviewed unless confidence is calibrated and high", () => {
    expect(initialReviewStatus("audio_analysis", 0.99, false)).toBe("needs_review");
    expect(initialReviewStatus("audio_analysis", null, true)).toBe("needs_review");
    expect(initialReviewStatus("audio_analysis", 0.5, true)).toBe("needs_review");
    expect(initialReviewStatus("audio_analysis", 0.9, true)).toBe("unreviewed");
    expect(initialReviewStatus("musicbrainz", null, false)).toBe("unreviewed");
    expect(initialReviewStatus("user", null, false)).toBe("confirmed");
  });

  it("validates prepare and review requests", () => {
    const mb = { source: "musicbrainz", mbid: "0dea3c9a-ef6b-4707-90d8-685b2f4a2cd8" };
    expect(prepareSongSchema.safeParse({ newSong: { title: "X" }, recording: mb }).success).toBe(
      true,
    );
    expect(prepareSongSchema.safeParse({ songId: "12345678", recording: mb }).success).toBe(true);
    // Either an existing song or a new one, never both or neither.
    expect(prepareSongSchema.safeParse({ recording: mb }).success).toBe(false);
    expect(
      prepareSongSchema.safeParse({ songId: "12345678", newSong: { title: "X" }, recording: mb })
        .success,
    ).toBe(false);
    expect(
      prepareSongSchema.safeParse({
        newSong: { title: "X" },
        recording: { source: "musicbrainz", mbid: "nope" },
      }).success,
    ).toBe(false);
    expect(reviewSchema.safeParse({ target: "band_bpm", bpm: 72 }).success).toBe(true);
    expect(reviewSchema.safeParse({ target: "band_bpm", bpm: 5 }).success).toBe(false);
    expect(
      reviewSchema.safeParse({ target: "band_meter", beatsPerBar: 4, beatUnit: 3 }).success,
    ).toBe(false);
  });
});

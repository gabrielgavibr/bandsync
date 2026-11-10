import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { AnalysisJobDto } from "@bandsync/shared";
import { describe, expect, it } from "vitest";
import { prearrange } from "../../../packages/shared/src/analysis/prearrange";
import { CHORDS, synthSong } from "../../../packages/shared/src/analysis/synth";
import { api, joinByCode, json, register, type Session } from "./helpers";
import { SPOTIFY_TRACK_ID } from "./outbound";

const YT = "https://www.youtube.com/watch?v=JZqFoTIAJj8";
const PEROLA = "0dea3c9a-ef6b-4707-90d8-685b2f4a2cd8";
const UM_BANDA_UM = "8379142a-fe4e-4da2-8edf-fb493665a54f";
const SEGUNDO_SOL_GIL = "790c0007-1df2-4d2e-bd34-8a772894e800";
const aa = (bandId: string) => `/api/bands/${bandId}/autoarrange`;

async function setup() {
  const ana = await register({ displayName: "Ana", primaryInstrument: "drums", locale: "pt-BR" });
  const bandId = (await json(await api("POST", "/api/bands", { name: "Pre" }, ana.cookie))).band
    .id as string;
  return { ana, bandId };
}

async function waitForJob(s: Session, bandId: string, jobId: string) {
  const stub = env.PREPARE_JOB.get(env.PREPARE_JOB.idFromName(jobId));
  for (let i = 0; i < 60; i += 1) {
    const job = (await json(await api("GET", `${aa(bandId)}/jobs/${jobId}`, undefined, s.cookie)))
      .job as AnalysisJobDto;
    if (job.status === "awaiting_review" || job.status === "failed") return job;
    await runDurableObjectAlarm(stub);
  }
  throw new Error("job stuck");
}

const prepare = async (s: Session, bandId: string, body: Record<string, unknown>) =>
  json(await api("POST", `${aa(bandId)}/prepare`, body, s.cookie));
const overview = async (s: Session, bandId: string, songId: string) =>
  json(await api("GET", `${aa(bandId)}/songs/${songId}`, undefined, s.cookie));

/** A pre-arrangement as the browser sends it, computed by the real engine on a known form. */
function devicePrearrangement() {
  const song = synthSong({
    bpm: 96,
    beatsPerBar: 4,
    parts: [
      { name: "intro", bars: 4, chords: [CHORDS.Am, CHORDS.F], energy: 0.25 },
      { name: "verse", bars: 8, chords: [CHORDS.Am, CHORDS.F, CHORDS.C, CHORDS.G], energy: 0.5 },
      {
        name: "chorus",
        bars: 8,
        chords: [CHORDS.F, CHORDS.G, CHORDS.C, CHORDS.C],
        energy: 1,
        lead: true,
      },
      { name: "verse", bars: 8, chords: [CHORDS.Am, CHORDS.F, CHORDS.C, CHORDS.G], energy: 0.5 },
      {
        name: "chorus",
        bars: 8,
        chords: [CHORDS.F, CHORDS.G, CHORDS.C, CHORDS.C],
        energy: 1,
        lead: true,
      },
      { name: "outro", bars: 4, chords: [CHORDS.Am], energy: 0.2 },
    ],
  });
  const r = prearrange([song.samples], song.sampleRate);
  return {
    engine: r.engine,
    version: r.version,
    analysedSeconds: r.analysedSeconds,
    bpm: {
      value: r.report.bpm!.value,
      ambiguous: r.report.bpm!.ambiguous,
      alternatives: r.report
        .bpm!.candidates.filter((c) => c.score >= 0.7 && c.bpm !== r.report.bpm!.value)
        .map((c) => c.bpm),
      origin: "audio_analysis" as const,
    },
    beatsPerBar: r.beatsPerBar,
    key: r.report.key
      ? {
          key: r.report.key.key,
          alternatives: r.report.key.candidates.slice(1, 3).map((k) => k.key),
        }
      : null,
    firstDownbeatSec: r.firstDownbeatSec,
    barSeconds: r.barSeconds,
    bars: r.bars,
    sections: r.sections,
  };
}

describe("published analyses of the exact recording (Deezer)", () => {
  it("finds Pérola Negra by its ISRC and keeps Deezer's BPM as an estimate to review", async () => {
    const { ana, bandId } = await setup();
    const body = await prepare(ana, bandId, {
      newSong: { title: "Pérola Negra" },
      recording: { source: "musicbrainz", mbid: PEROLA },
      referenceUrl: YT,
    });
    const job = await waitForJob(ana, bandId, body.job.id);
    expect(job.steps[0]).toMatchObject({ step: "searching_references", outcome: "done" });
    expect(job.steps[0]!.detail.deezer).toBe(true);
    const o = await overview(ana, bandId, body.song.id);
    const bpm = o.results.find(
      (r: { kind: string; origin: string }) => r.kind === "bpm" && r.origin === "deezer",
    );
    expect(bpm).toMatchObject({
      method: "deezer.track.bpm",
      reviewStatus: "needs_review",
      sourceUrl: "https://www.deezer.com/track/429918992",
    });
    expect(bpm.value).toMatchObject({ bpm: 130, match: "isrc" });
    // Nothing reaches the band's own values by itself.
    expect(o.song.version.bpm).toBeNull();
  });

  it("finds Esotérico (Um Banda Um) among six versions by title and length", async () => {
    const { ana, bandId } = await setup();
    const body = await prepare(ana, bandId, {
      newSong: { title: "Esotérico" },
      recording: { source: "musicbrainz", mbid: UM_BANDA_UM },
    });
    await waitForJob(ana, bandId, body.job.id);
    const o = await overview(ana, bandId, body.song.id);
    const bpm = o.results.find((r: { origin: string }) => r.origin === "deezer");
    expect(bpm.value).toMatchObject({
      bpm: 110.5,
      deezerTrackId: 876104442,
      match: "title_duration",
    });
  });

  it("stores nothing when Deezer has no tempo, and still prepares when Deezer is down", async () => {
    const { ana, bandId } = await setup();
    const sol = await prepare(ana, bandId, {
      newSong: { title: "O Segundo Sol" },
      recording: { source: "musicbrainz", mbid: SEGUNDO_SOL_GIL },
    });
    await waitForJob(ana, bandId, sol.job.id);
    expect(
      (await overview(ana, bandId, sol.song.id)).results.filter(
        (r: { origin: string }) => r.origin === "deezer",
      ),
    ).toEqual([]);

    await fetch("https://api.deezer.com/__test/down?on=1");
    try {
      const p = await prepare(ana, bandId, {
        newSong: { title: "Pérola Negra" },
        recording: { source: "musicbrainz", mbid: PEROLA },
      });
      const job = await waitForJob(ana, bandId, p.job.id);
      expect(job.status).toBe("awaiting_review");
      expect(job.steps[0]!.detail.deezer).toBe(false);
    } finally {
      await fetch("https://api.deezer.com/__test/down?on=0");
    }
  });

  it("does not guess the recording from a link alone", async () => {
    const { ana, bandId } = await setup();
    const body = await prepare(ana, bandId, {
      newSong: { title: "Esotérico" },
      recording: { source: "link", artistCredit: "Gilberto Gil" },
      referenceUrl: YT,
    });
    await waitForJob(ana, bandId, body.job.id);
    // Six versions of Esotérico on Deezer and no length known: nothing is taken.
    const o = await overview(ana, bandId, body.song.id);
    expect(o.results.filter((r: { origin: string }) => r.origin === "deezer")).toEqual([]);
  });
});

describe("duration from the official player", () => {
  it("records the YouTube player's duration for the reference, and refuses other platforms", async () => {
    const { ana, bandId } = await setup();
    const yt = await prepare(ana, bandId, {
      newSong: { title: "Pérola Negra" },
      recording: { source: "link", title: "Pérola Negra" },
      referenceUrl: YT,
    });
    const res = await api(
      "POST",
      `${aa(bandId)}/songs/${yt.song.id}/reference/duration`,
      { seconds: 211.6 },
      ana.cookie,
    );
    expect(res.status).toBe(200);
    const d = (await json(res)).results.find((r: { kind: string }) => r.kind === "duration");
    expect(d).toMatchObject({
      origin: "youtube",
      method: "youtube.iframe_player.getDuration",
      value: { seconds: 211.6 },
    });
    const sp = await prepare(ana, bandId, {
      newSong: { title: "Outra" },
      recording: { source: "link" },
      referenceUrl: `https://open.spotify.com/track/${SPOTIFY_TRACK_ID}`,
    });
    expect(
      (
        await api(
          "POST",
          `${aa(bandId)}/songs/${sp.song.id}/reference/duration`,
          { seconds: 200 },
          ana.cookie,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await api(
          "POST",
          `${aa(bandId)}/songs/${yt.song.id}/reference/duration`,
          { seconds: 0 },
          ana.cookie,
        )
      ).status,
    ).toBe(400);
  });
});

describe("pre-arrangement of the recording and the band's arrangement", () => {
  it("stores the device's pre-arrangement, then the band edits its own without touching it", async () => {
    const { ana, bandId } = await setup();
    const song = await prepare(ana, bandId, {
      newSong: { title: "Pérola Negra" },
      recording: { source: "link", title: "Pérola Negra" },
      referenceUrl: YT,
    });
    const songId = song.song.id as string;
    const pre = devicePrearrangement();
    const res = await api(
      "POST",
      `${aa(bandId)}/songs/${songId}/prearrangement`,
      { source: "microphone", ...pre },
      ana.cookie,
    );
    expect(res.status).toBe(201);
    let o = await json(res);
    expect(o.prearrangement).toMatchObject({
      source: "microphone",
      recordingId: song.recording.id,
      createdByName: "Ana",
    });
    expect(o.prearrangement.data.sections.map((s: { kind: string }) => s.kind)).toEqual([
      "intro",
      "verse",
      "chorus",
      "verse",
      "chorus",
      "outro",
    ]);
    const kinds = o.results.map((r: { kind: string }) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["bpm", "key", "time_signature", "sections"]));
    expect(
      o.results.every(
        (r: { origin: string; reviewStatus: string }) =>
          r.origin !== "audio_analysis" || r.reviewStatus === "needs_review",
      ),
    ).toBe(true);
    expect(o.preparation).toMatchObject({ analysis: "done", analysisFrom: "microphone" });
    const original = JSON.stringify(o.prearrangement);

    // The band: no intro, chorus played one more time, a stop, transposed down a tone.
    const secs = o.prearrangement.data.sections as {
      label: string;
      kind: string;
      bars: number;
      chords: string[];
      startSec: number;
      endSec: number;
    }[];
    const toBand = (s: (typeof secs)[number], name: string) => ({
      name,
      kind: s.kind === "unknown" ? null : s.kind,
      label: s.label,
      bars: s.bars,
      chords: s.chords,
      startMs: Math.round(s.startSec * 1000),
      endMs: Math.round(s.endSec * 1000),
      cues: [] as unknown[],
    });
    const band = [
      toBand(secs[1]!, "Verso 1"),
      toBand(secs[2]!, "Refrão"),
      toBand(secs[3]!, "Verso 2"),
      { ...toBand(secs[4]!, "Refrão"), cues: [{ type: "stop", text: "Parada geral", bar: 8 }] },
      toBand(secs[4]!, "Refrão final"),
      toBand(secs[5]!, "Final"),
    ];
    const saved = await api(
      "PUT",
      `${aa(bandId)}/songs/${songId}/arrangement`,
      {
        baseId: o.prearrangement.id,
        transpose: -2,
        sections: band,
      },
      ana.cookie,
    );
    expect(saved.status).toBe(200);
    o = await json(saved);
    expect(o.song.sections.map((s: { name: string }) => s.name)).toEqual([
      "Verso 1",
      "Refrão",
      "Verso 2",
      "Refrão",
      "Refrão final",
      "Final",
    ]);
    expect(o.song.sections[1]).toMatchObject({
      label: secs[2]!.label,
      kind: "chorus",
      chords: secs[2]!.chords,
    });
    expect(o.song.sections[3].cues).toEqual([{ type: "stop", text: "Parada geral", bar: 8 }]);
    expect(o.song.version).toMatchObject({
      arrangementTranspose: -2,
      arrangementBaseId: o.prearrangement.id,
    });
    expect(o.song.version.arrangementUpdatedAt).toBeTruthy();
    // The recording's pre-arrangement is exactly as it was.
    expect(JSON.stringify(o.prearrangement)).toBe(original);
    const history = o.reviews.find((r: { target: string }) => r.target === "band_arrangement");
    expect(history).toMatchObject({ action: "edit", userId: ana.userId });
    expect(history.after.sections).toContain("Refrão final");

    // Everyone in the band reads the same arrangement from the song.
    const read = await json(
      await api("GET", `/api/bands/${bandId}/songs/${songId}`, undefined, ana.cookie),
    );
    expect(read.song.sections).toHaveLength(6);
  });

  it("member marks are a person's work: stored as the recording's structure, no analysis results", async () => {
    const { ana, bandId } = await setup();
    const song = await prepare(ana, bandId, {
      newSong: { title: "Esotérico" },
      recording: { source: "link", title: "Esotérico" },
      referenceUrl: YT,
    });
    const marks = {
      source: "member_marks",
      engine: "bandsync-marks",
      version: "marks-v1",
      analysedSeconds: 0,
      bpm: { value: 110.5, ambiguous: false, alternatives: [], origin: "deezer" },
      beatsPerBar: 4,
      key: null,
      firstDownbeatSec: 0,
      barSeconds: 2.17,
      bars: 20,
      sections: [
        {
          label: "A",
          kind: "unknown",
          kindConfidence: "low",
          startSec: 0,
          endSec: 17.4,
          startBar: 0,
          bars: 8,
          chords: [],
          loudnessDb: 0,
          cues: [],
        },
        {
          label: "B",
          kind: "unknown",
          kindConfidence: "low",
          startSec: 17.4,
          endSec: 43.4,
          startBar: 8,
          bars: 12,
          chords: [],
          loudnessDb: 0,
          cues: [],
        },
      ],
    };
    const res = await api(
      "POST",
      `${aa(bandId)}/songs/${song.song.id}/prearrangement`,
      marks,
      ana.cookie,
    );
    expect(res.status).toBe(201);
    const o = await json(res);
    expect(o.prearrangement.source).toBe("member_marks");
    expect(o.results.filter((r: { origin: string }) => r.origin === "audio_analysis")).toEqual([]);
    expect(o.preparation.analysis).toBe("not_possible");
  });

  it("validates, needs the file for a file analysis, and needs permission", async () => {
    const { ana, bandId } = await setup();
    const song = await prepare(ana, bandId, {
      newSong: { title: "X" },
      recording: { source: "link", title: "X" },
      referenceUrl: YT,
    });
    const path = `${aa(bandId)}/songs/${song.song.id}/prearrangement`;
    const pre = devicePrearrangement();
    expect((await api("POST", path, { source: "audio_file", ...pre }, ana.cookie)).status).toBe(
      400,
    );
    expect((await api("POST", path, { source: "youtube", ...pre }, ana.cookie)).status).toBe(400);
    const backwards = { ...pre, sections: [{ ...pre.sections[0]!, endSec: 0, startSec: 5 }] };
    expect(
      (await api("POST", path, { source: "microphone", ...backwards }, ana.cookie)).status,
    ).toBe(400);
    expect(
      (
        await api(
          "PUT",
          `${aa(bandId)}/songs/${song.song.id}/arrangement`,
          { baseId: "00000000-0000-4000-8000-000000000000", transpose: 0, sections: [] },
          ana.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await api(
          "PUT",
          `${aa(bandId)}/songs/${song.song.id}/arrangement`,
          { transpose: 0, sections: [{ name: "A", bars: 4, chords: ["<b>"] }] },
          ana.cookie,
        )
      ).status,
    ).toBe(400);
    const member = await register();
    await joinByCode(ana, bandId, member);
    await api(
      "PATCH",
      `/api/bands/${bandId}/members/${member.userId}`,
      { permissions: { canEditRepertoire: false } },
      ana.cookie,
    );
    expect((await api("POST", path, { source: "microphone", ...pre }, member.cookie)).status).toBe(
      403,
    );
    expect(
      (
        await api(
          "PUT",
          `${aa(bandId)}/songs/${song.song.id}/arrangement`,
          { transpose: 0, sections: [] },
          member.cookie,
        )
      ).status,
    ).toBe(403);
  });
});

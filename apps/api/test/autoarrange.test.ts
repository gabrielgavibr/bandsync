import { runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  type AnalysisJobDto,
  REFERENCE_PLATFORMS,
  type ServerMessage,
  type SessionState,
} from "@bandsync/shared";
import { describe, expect, it } from "vitest";
import {
  api,
  BASE,
  createBand,
  createSong,
  joinByCode,
  json,
  register,
  type Session,
} from "./helpers";

const PEROLA = "0dea3c9a-ef6b-4707-90d8-685b2f4a2cd8";
const UM_BANDA_UM = "8379142a-fe4e-4da2-8edf-fb493665a54f";
const DOCES_BARBAROS = "d72d41dd-fb12-4775-8188-d95c1fdabfe3";
const SEGUNDO_SOL_GIL = "790c0007-1df2-4d2e-bd34-8a772894e800";
const YT = "https://www.youtube.com/watch?v=JZqFoTIAJj8";

const aa = (bandId: string) => `/api/bands/${bandId}/autoarrange`;
const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

/** Lets due alarms run and polls the job until it reaches one of the given statuses. */
async function waitForJob(
  s: Session,
  bandId: string,
  jobId: string,
  statuses: string[],
  pushAlarms = true,
): Promise<AnalysisJobDto> {
  const stub = env.PREPARE_JOB.get(env.PREPARE_JOB.idFromName(jobId));
  let job: AnalysisJobDto | null = null;
  for (let i = 0; i < 60; i += 1) {
    job = (await json(await api("GET", `${aa(bandId)}/jobs/${jobId}`, undefined, s.cookie)))
      .job as AnalysisJobDto;
    if (statuses.includes(job.status)) return job;
    // Retry alarms are scheduled seconds ahead; run them now instead of waiting.
    if (pushAlarms) await runDurableObjectAlarm(stub);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`job stuck in ${job?.status}: ${JSON.stringify(job?.steps)}`);
}

async function prepare(s: Session, bandId: string, body: Record<string, unknown>) {
  return api("POST", `${aa(bandId)}/prepare`, body, s.cookie);
}

async function mbControl(path: string) {
  // Reaches the fake MusicBrainz in test/outbound.ts through the Worker's outbound route.
  return (await fetch(`https://musicbrainz.org/__test/${path}`)).json() as Promise<{
    calls?: number;
  }>;
}

async function clearGatewayCache() {
  const stub = env.MB_GATEWAY.get(env.MB_GATEWAY.idFromName("global"));
  await runInDurableObject(stub, async (_instance, state) => {
    await state.storage.deleteAll();
  });
}

async function setup() {
  const ana = await register({ displayName: "Ana", primaryInstrument: "drums", locale: "pt-BR" });
  const bandId = await createBand(ana, "AutoArrange Band");
  return { ana, bandId };
}

describe("identifying the recording", () => {
  it("searches MusicBrainz and returns each version as its own candidate", async () => {
    const { ana, bandId } = await setup();
    const res = await api(
      "GET",
      `${aa(bandId)}/search?${q({ title: "Esotérico", artist: "Gilberto Gil" })}`,
      undefined,
      ana.cookie,
    );
    expect(res.status).toBe(200);
    const { recordings, source } = await json(res);
    expect(source).toBe("musicbrainz");
    expect(recordings.length).toBeGreaterThanOrEqual(20);
    const ubu = recordings.find((r: { mbid: string }) => r.mbid === UM_BANDA_UM);
    const db = recordings.find((r: { mbid: string }) => r.mbid === DOCES_BARBAROS);
    expect(ubu.releases[0].title).toBe("Um Banda Um");
    expect(db.artistCredit).toContain("Maria Bethânia");
    expect(ubu.durationMs).not.toBe(db.durationMs);
  });

  it("validates input, requires repertoire permission and hides other bands", async () => {
    const { ana, bandId } = await setup();
    const member = await register();
    const outsider = await register();
    await joinByCode(ana, bandId, member);
    await api(
      "PATCH",
      `/api/bands/${bandId}/members/${member.userId}`,
      { permissions: { canEditRepertoire: false } },
      ana.cookie,
    );
    const path = `${aa(bandId)}/search?${q({ title: "Pérola Negra" })}`;
    expect((await api("GET", `${aa(bandId)}/search?title=`, undefined, ana.cookie)).status).toBe(
      400,
    );
    expect((await api("GET", path, undefined, member.cookie)).status).toBe(403);
    expect((await api("GET", path, undefined, outsider.cookie)).status).toBe(404);
    expect((await api("GET", path)).status).toBe(401);
  });

  it("returns the work and its authors for a recording, and 404 for an unknown one", async () => {
    const { ana, bandId } = await setup();
    const ok = await json(
      await api("GET", `${aa(bandId)}/recordings/${PEROLA}`, undefined, ana.cookie),
    );
    expect(ok.authors).toEqual(["Luiz Melodia"]);
    expect(ok.recording.isrcs).toEqual(["BR4W41200009"]);
    expect(ok.defaultRelease.title).toBe("Acústico no Rio de Janeiro");
    // MusicBrainz has no work linked to this recording: no author is reported, none is invented.
    const gil = await json(
      await api("GET", `${aa(bandId)}/recordings/${SEGUNDO_SOL_GIL}`, undefined, ana.cookie),
    );
    expect(gil.authors).toEqual([]);
    expect(gil.defaultRelease.title).toBe("Cássia Reggae, Vol. 1");
    const missing = await api(
      "GET",
      `${aa(bandId)}/recordings/00000000-0000-4000-8000-000000000000`,
      undefined,
      ana.cookie,
    );
    expect(missing.status).toBe(404);
  });

  it("caches answers and survives MusicBrainz throttling", async () => {
    const { ana, bandId } = await setup();
    await clearGatewayCache();
    const path = `${aa(bandId)}/search?${q({ title: "O Segundo Sol", artist: "Gilberto Gil" })}`;
    const before = (await mbControl("calls")).calls!;
    expect((await api("GET", path, undefined, ana.cookie)).status).toBe(200);
    expect((await api("GET", path, undefined, ana.cookie)).status).toBe(200);
    expect((await mbControl("calls")).calls! - before).toBe(1); // second answer came from the cache

    // Two 503s in a row are absorbed by the gateway's retries…
    await clearGatewayCache();
    await mbControl("fail?n=2");
    expect((await api("GET", path, undefined, ana.cookie)).status).toBe(200);
    // …a longer outage surfaces as a stable, translatable error code.
    await clearGatewayCache();
    await mbControl("fail?n=10");
    const down = await api("GET", path, undefined, ana.cookie);
    expect(down.status).toBe(503);
    expect((await json(down)).error.code).toBe("upstream_unavailable");
    await mbControl("fail?n=0");
  });

  it("accepts a YouTube link only as a reference to an existing, embeddable video", async () => {
    const { ana, bandId } = await setup();
    const ok = await api("POST", `${aa(bandId)}/youtube`, { url: YT }, ana.cookie);
    expect(ok.status).toBe(200);
    const { video } = await json(ok);
    expect(video).toMatchObject({ videoId: "JZqFoTIAJj8", channelName: "NatirutsVEVO", url: YT });
    expect(
      (await api("POST", `${aa(bandId)}/youtube`, { url: "https://vimeo.com/1" }, ana.cookie))
        .status,
    ).toBe(400);
    expect(
      (
        await api(
          "POST",
          `${aa(bandId)}/youtube`,
          { url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" },
          ana.cookie,
        )
      ).status,
    ).toBe(400);
  });
});

describe("preparing a song", () => {
  it("creates the song from the chosen recording and runs the job to review", async () => {
    const { ana, bandId } = await setup();
    const res = await prepare(ana, bandId, {
      newSong: { title: "Pérola Negra" },
      recording: { source: "musicbrainz", mbid: PEROLA },
      youtubeUrl: YT,
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.songCreated).toBe(true);
    expect(body.song).toMatchObject({
      title: "Pérola Negra",
      artist: "Natiruts Part. Especial Luiz Melodia",
      composer: "Luiz Melodia",
      referenceRecording: "Acústico no Rio de Janeiro",
      referenceYear: 2012,
      durationSeconds: 210,
      originalBpm: null,
      originalKey: null,
    });
    // Tempo, key and meter are not known from metadata and are not made up.
    expect(body.song.version).toMatchObject({
      bpm: null,
      key: null,
      meterConfirmed: false,
      referenceUrl: YT,
    });
    expect(
      body.song.metadataSources.every(
        (m: { url: string }) => m.url.startsWith("https://musicbrainz.org/") || m.url === YT,
      ),
    ).toBe(true);
    expect(body.recording).toMatchObject({
      mbid: PEROLA,
      isReference: true,
      isrcs: ["BR4W41200009"],
    });
    expect(body.recording.identifiedBy).toBe("musicbrainz");
    expect(body.recording.link).toMatchObject({
      platform: "youtube",
      externalId: "JZqFoTIAJj8",
      url: YT,
      author: "NatirutsVEVO",
      embeddable: true,
    });
    // Every member finds the same reference on the song itself.
    expect(body.song.reference).toMatchObject({
      recordingId: body.recording.id,
      title: "Pérola negra",
      artist: "Natiruts Part. Especial Luiz Melodia",
      releaseTitle: "Acústico no Rio de Janeiro",
      year: "2012",
      platform: "youtube",
      url: YT,
    });
    expect(["pending", "searching_references"]).toContain(body.job.status);

    const job = await waitForJob(ana, bandId, body.job.id, ["awaiting_review"]);
    expect(job.progress).toBe(100);
    expect(job.steps.map((s) => [s.step, s.outcome, s.reason])).toEqual([
      ["searching_references", "done", null],
      ["analyzing_audio", "skipped", "no_authorized_audio"],
      ["detecting_structure", "skipped", "no_authorized_audio"],
      ["preparing_materials", "done", null],
    ]);
    expect(job.steps[3]!.detail.slotsCreated).toBe(5);
    // One MusicBrainz lookup and one Deezer lookup by ISRC.
    expect(job.costUnits).toBe(2);

    const o = await json(
      await api("GET", `${aa(bandId)}/songs/${body.song.id}`, undefined, ana.cookie),
    );
    expect(o.engines.audioAnalysis).toBe("not_configured");
    // Deezer's published tempo is kept apart, as an estimate to review.
    const deezer = o.results.filter((r: { origin: string }) => r.origin === "deezer");
    expect(deezer.map((r: { kind: string }) => r.kind)).toEqual(["bpm"]);
    expect(deezer[0].reviewStatus).toBe("needs_review");
    const fromCatalogue = o.results.filter((r: { origin: string }) => r.origin !== "deezer");
    const kinds = fromCatalogue.map((r: { kind: string }) => r.kind).sort();
    expect(kinds).toEqual(["composer", "duration"]); // no key, chords or sections: nothing analysed them
    for (const r of fromCatalogue) {
      expect(r.origin).toBe("musicbrainz");
      expect(r.reviewStatus).toBe("unreviewed");
      expect(r.confidence).toBeNull();
      expect(r.sourceUrl).toMatch(/^https:\/\/musicbrainz\.org\//);
      expect(r.method).toMatch(/^musicbrainz\./);
    }
    expect(o.results.find((r: { kind: string }) => r.kind === "duration").value).toEqual({
      ms: 209626,
      seconds: 209.6,
    });
    expect(o.song.workMbid).toBe("39fe8e07-adc0-4d8d-8e46-7ec134ae6ec1");

    // No list of source links is attached to the song: provenance stays on the recording.
    expect(o.song.references).toEqual([]);
    expect(o.recordings[0].sourceUrl).toBe(`https://musicbrainz.org/recording/${PEROLA}`);
    expect(o.preparation).toEqual({
      reference: "identified",
      player: "available",
      audio: "none",
      analysis: "not_possible",
      analysisFrom: null,
      arrangement: "ready_for_review",
    });

    const { materials } = await json(
      await api("GET", `/api/bands/${bandId}/songs/${body.song.id}`, undefined, ana.cookie),
    );
    expect(materials).toHaveLength(5);
    expect(materials.every((m: { status: string }) => m.status === "pending")).toBe(true);
    expect(materials.map((m: { instrument: string }) => m.instrument).sort()).toEqual([
      "bass",
      "drums",
      "guitar",
      "keys",
      "vocals",
    ]);
  });

  it("does not run the same work twice and never duplicates what it already produced", async () => {
    const { ana, bandId } = await setup();
    const first = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Pérola Negra" },
        recording: { source: "musicbrainz", mbid: PEROLA },
      }),
    );
    // Asking again while the job is active returns the same job.
    const again = await prepare(ana, bandId, {
      songId: first.song.id,
      recording: { source: "musicbrainz", mbid: PEROLA },
    });
    if (again.status === 200) {
      const b = await json(again);
      expect(b.reused).toBe(true);
      expect(b.job.id).toBe(first.job.id);
    }
    await waitForJob(ana, bandId, first.job.id, ["awaiting_review", "completed"]);

    // A later run is a new job, but results, links and slots are not repeated.
    const rerun = await prepare(ana, bandId, {
      songId: first.song.id,
      recording: { source: "musicbrainz", mbid: PEROLA },
    });
    expect(rerun.status).toBe(201);
    const second = await json(rerun);
    expect(second.job.id).not.toBe(first.job.id);
    const job2 = await waitForJob(ana, bandId, second.job.id, ["awaiting_review"]);
    expect(job2.steps[0]!.detail).toMatchObject({ resultsAdded: 0 });
    expect(job2.steps[3]!.detail).toMatchObject({ slotsCreated: 0, fieldsFilled: 0 });
    const o = await json(
      await api("GET", `${aa(bandId)}/songs/${first.song.id}`, undefined, ana.cookie),
    );
    // Composer and duration from MusicBrainz, BPM from Deezer: each stored once.
    expect(o.results).toHaveLength(3);
    expect(o.recordings).toHaveLength(1);
    expect(o.jobs).toHaveLength(2);
    expect(o.jobs.find((j: { id: string }) => j.id === first.job.id).status).toBe("completed");
  });

  it("keeps what the band already wrote and never invents a composer", async () => {
    const { ana, bandId } = await setup();
    const songId = await createSong(ana, bandId, {
      title: "Esotérico",
      artist: "Gilberto Gil",
      composer: "Gilberto Gil",
      version: { bpm: 98, key: "G", beatsPerBar: 4, beatUnit: 4 },
    });
    const res = await prepare(ana, bandId, {
      songId,
      recording: { source: "musicbrainz", mbid: UM_BANDA_UM },
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.songCreated).toBe(false);
    const job = await waitForJob(ana, bandId, body.job.id, ["awaiting_review"]);
    const { song } = await json(
      await api("GET", `/api/bands/${bandId}/songs/${songId}`, undefined, ana.cookie),
    );
    expect(song.artist).toBe("Gilberto Gil");
    expect(song.composer).toBe("Gilberto Gil"); // untouched band data
    expect(song.version).toMatchObject({ bpm: 98, key: "G" });
    // Only the empty fields were filled, from the selected recording.
    expect(song.referenceRecording).toBe("Um Banda Um");
    expect(song.referenceYear).toBe(1982);
    expect(song.durationSeconds).toBe(262);
    expect(job.steps[3]!.detail.fieldsFilled).toBe(3);
    const o = await json(await api("GET", `${aa(bandId)}/songs/${songId}`, undefined, ana.cookie));
    // MusicBrainz links no work to this recording, so there is no composer result.
    expect(
      o.results
        .filter((r: { origin: string }) => r.origin === "musicbrainz")
        .map((r: { kind: string }) => r.kind),
    ).toEqual(["duration"]);
    expect(song.workMbid).toBeNull();

    // New song from the same recording: composer stays empty rather than guessed.
    const fresh = await json(
      await prepare(ana, bandId, {
        newSong: { title: "O Segundo Sol" },
        recording: { source: "musicbrainz", mbid: SEGUNDO_SOL_GIL },
      }),
    );
    expect(fresh.song.composer).toBeNull();
    expect(fresh.song.artist).toBe("Gilberto Gil");
    expect(fresh.song.referenceRecording).toBe("Cássia Reggae, Vol. 1");
    expect(fresh.song.durationSeconds).toBe(258);
  });

  it("switches the reference between versions of the same composition", async () => {
    const { ana, bandId } = await setup();
    const a = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Esotérico" },
        recording: { source: "musicbrainz", mbid: DOCES_BARBAROS },
      }),
    );
    await waitForJob(ana, bandId, a.job.id, ["awaiting_review"]);
    const choice = { songId: a.song.id, recording: { source: "musicbrainz", mbid: UM_BANDA_UM } };
    // Another version of the same composition is another recording: the member confirms.
    const asked = await prepare(ana, bandId, choice);
    expect(asked.status).toBe(409);
    expect((await json(asked)).error.code).toBe("confirmation_required");
    const b = await json(await prepare(ana, bandId, { ...choice, confirmReplace: true }));
    await waitForJob(ana, bandId, b.job.id, ["awaiting_review"]);
    const o = await json(
      await api("GET", `${aa(bandId)}/songs/${a.song.id}`, undefined, ana.cookie),
    );
    expect(o.recordings).toHaveLength(2);
    const refs = o.recordings.filter((r: { isReference: boolean }) => r.isReference);
    expect(refs).toHaveLength(1);
    expect(refs[0].mbid).toBe(UM_BANDA_UM);
    // Results stay attached to the recording they describe.
    const durations = o.results.filter((r: { kind: string }) => r.kind === "duration");
    expect(new Set(durations.map((r: { recordingId: string }) => r.recordingId)).size).toBe(2);
    expect(durations.map((r: { value: { ms: number } }) => r.value.ms).sort()).toEqual([
      250733, 262400,
    ]);
  });

  it("accepts a manual recording when the source has no entry", async () => {
    const { ana, bandId } = await setup();
    const res = await prepare(ana, bandId, {
      newSong: { title: "Música Própria" },
      recording: {
        source: "manual",
        title: "Música Própria",
        artistCredit: "A Banda",
        releaseTitle: "Demo",
        releaseDate: "2026",
      },
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.song).toMatchObject({
      artist: "A Banda",
      referenceRecording: "Demo",
      referenceYear: 2026,
      composer: null,
    });
    const job = await waitForJob(ana, bandId, body.job.id, ["awaiting_review"]);
    expect(job.steps[0]).toMatchObject({ outcome: "done", reason: "no_recording_identifier" });
    expect(job.costUnits).toBe(0);
  });

  it("rejects unknown recordings, unavailable videos and bad requests", async () => {
    const { ana, bandId } = await setup();
    expect(
      (
        await prepare(ana, bandId, {
          newSong: { title: "X" },
          recording: { source: "musicbrainz", mbid: "00000000-0000-4000-8000-000000000000" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await prepare(ana, bandId, {
          newSong: { title: "X" },
          recording: { source: "musicbrainz", mbid: PEROLA },
          youtubeUrl: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await prepare(ana, bandId, {
          newSong: { title: "X" },
          recording: { source: "link", title: "X" },
          referenceUrl: "https://vimeo.com/1",
        })
      ).status,
    ).toBe(422);
    // Identified "by link" without a link is not a request the API accepts.
    expect(
      (await prepare(ana, bandId, { newSong: { title: "X" }, recording: { source: "link" } }))
        .status,
    ).toBe(400);
    expect(
      (await prepare(ana, bandId, { recording: { source: "musicbrainz", mbid: PEROLA } })).status,
    ).toBe(400);
    expect(
      (
        await prepare(ana, bandId, {
          songId: "00000000-0000-4000-8000-000000000000",
          recording: { source: "musicbrainz", mbid: PEROLA },
        })
      ).status,
    ).toBe(404);
    // Nothing was created by the failed attempts.
    expect(
      (await json(await api("GET", `/api/bands/${bandId}/songs`, undefined, ana.cookie))).songs,
    ).toEqual([]);
  });
});

describe("job control", () => {
  /**
   * Inserts a job that nothing has started yet, so the test decides exactly when each alarm runs.
   * (A job created through the API starts its alarm immediately, which would race the staged outage.)
   */
  async function stagedJob(ana: Session, bandId: string, mbid: string) {
    const first = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Staged" },
        recording: { source: "musicbrainz", mbid },
      }),
    );
    await waitForJob(ana, bandId, first.job.id, ["awaiting_review"]);
    await api("POST", `${aa(bandId)}/jobs/${first.job.id}/complete`, undefined, ana.cookie);
    const jobId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO analysis_jobs (id, band_id, song_id, recording_id, pipeline_version, status, dedupe_key, max_attempts, locale, requested_by, created_at)
       VALUES (?, ?, ?, ?, 'prepare-v1', 'pending', ?, 3, 'en', ?, ?)`,
    )
      .bind(
        jobId,
        bandId,
        first.song.id,
        first.recording.id,
        `staged|${jobId}`,
        ana.userId,
        new Date().toISOString(),
      )
      .run();
    const stub = env.PREPARE_JOB.get(env.PREPARE_JOB.idFromName(jobId));
    await runInDurableObject(stub, async (_i, state) => {
      await state.storage.put("jobId", jobId);
    });
    const tick = () =>
      runInDurableObject(stub, (instance: { alarm(): Promise<void> }) => instance.alarm());
    const read = async () =>
      (await json(await api("GET", `${aa(bandId)}/jobs/${jobId}`, undefined, ana.cookie)))
        .job as AnalysisJobDto;
    return { jobId, tick, read };
  }

  it("retries a step after a temporary outage and reports the attempt", async () => {
    const { ana, bandId } = await setup();
    const { tick, read } = await stagedJob(ana, bandId, PEROLA);
    await clearGatewayCache();
    await mbControl("fail?n=3"); // one step attempt: the gateway itself tries three times
    await tick();
    const mid = await read();
    expect(mid.status).toBe("searching_references");
    expect(mid.attempts).toBe(1);
    expect(mid.errorCode).toBe("upstream_unavailable");
    expect(mid.steps).toHaveLength(1);
    expect(mid.steps[0]).toMatchObject({
      step: "searching_references",
      outcome: "failed",
      reason: "upstream_unavailable",
    });
    expect(mid.progress).toBe(0);

    // The service is back: the same step runs again and the job carries on to review.
    for (let i = 0; i < 4; i += 1) await tick();
    const done = await read();
    expect(done.status).toBe("awaiting_review");
    expect(done.steps.map((s) => s.outcome)).toEqual(["done", "skipped", "skipped", "done"]);
    expect(done.errorCode).toBeNull();
    expect(done.attempts).toBe(0);
  });

  it("fails after the attempt limit, then can be retried by a member", async () => {
    const { ana, bandId } = await setup();
    const { jobId, tick, read } = await stagedJob(ana, bandId, DOCES_BARBAROS);
    await clearGatewayCache();
    await mbControl("fail?n=1000");
    await tick();
    await tick();
    expect((await read()).status).toBe("searching_references"); // two attempts used, still trying
    await tick();
    const failed = await read();
    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(3);
    expect(failed.errorCode).toBe("upstream_unavailable");
    expect(failed.finishedAt).not.toBeNull();
    await tick(); // a failed job does nothing more on its own
    expect((await read()).attempts).toBe(3);

    await mbControl("fail?n=0");
    const retry = await api("POST", `${aa(bandId)}/jobs/${jobId}/retry`, undefined, ana.cookie);
    expect(retry.status).toBe(200);
    expect((await json(retry)).job).toMatchObject({
      status: "pending",
      attempts: 0,
      errorCode: null,
    });
    const ok = await waitForJob(ana, bandId, jobId, ["awaiting_review"]);
    expect(ok.steps.map((s) => s.outcome)).toEqual(["done", "skipped", "skipped", "done"]);
  });

  it("stops at the external-call budget", async () => {
    const { ana, bandId } = await setup();
    const { jobId, tick, read } = await stagedJob(ana, bandId, PEROLA);
    await env.DB.prepare("UPDATE analysis_jobs SET cost_units = 12 WHERE id = ?").bind(jobId).run();
    await tick();
    const job = await read();
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("budget_exceeded");
    expect(job.attempts).toBe(1); // a spent budget is not retried
  });

  it("stops permanently when the song disappears", async () => {
    const { ana, bandId } = await setup();
    const body = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Pérola Negra" },
        recording: { source: "musicbrainz", mbid: PEROLA },
      }),
    );
    await api("DELETE", `/api/bands/${bandId}/songs/${body.song.id}`, undefined, ana.cookie);
    const job = await waitForJob(ana, bandId, body.job.id, ["failed", "awaiting_review"]);
    if (job.status === "failed") expect(job.errorCode).toBe("song_not_found");
  });

  it("cancels an active job and completes a reviewed one", async () => {
    const { ana, bandId } = await setup();
    const one = await json(
      await prepare(ana, bandId, {
        newSong: { title: "A" },
        recording: { source: "manual", title: "A" },
      }),
    );
    const cancel = await api(
      "POST",
      `${aa(bandId)}/jobs/${one.job.id}/cancel`,
      undefined,
      ana.cookie,
    );
    expect(cancel.status).toBe(200);
    expect((await json(cancel)).job.status).toBe("cancelled");
    // A cancelled job does not resume on its own…
    await runDurableObjectAlarm(env.PREPARE_JOB.get(env.PREPARE_JOB.idFromName(one.job.id)));
    expect(
      (await json(await api("GET", `${aa(bandId)}/jobs/${one.job.id}`, undefined, ana.cookie))).job
        .status,
    ).toBe("cancelled");
    expect(
      (await api("POST", `${aa(bandId)}/jobs/${one.job.id}/cancel`, undefined, ana.cookie)).status,
    ).toBe(409);
    // …but can be retried and then reviewed.
    expect(
      (await api("POST", `${aa(bandId)}/jobs/${one.job.id}/retry`, undefined, ana.cookie)).status,
    ).toBe(200);
    await waitForJob(ana, bandId, one.job.id, ["awaiting_review"]);
    const complete = await api(
      "POST",
      `${aa(bandId)}/jobs/${one.job.id}/complete`,
      undefined,
      ana.cookie,
    );
    expect((await json(complete)).job.status).toBe("completed");
    expect(
      (await api("POST", `${aa(bandId)}/jobs/${one.job.id}/complete`, undefined, ana.cookie))
        .status,
    ).toBe(409);
  });

  it("isolates jobs between bands and requires permission to control them", async () => {
    const { ana, bandId } = await setup();
    const other = await setup();
    const member = await register();
    await joinByCode(ana, bandId, member);
    await api(
      "PATCH",
      `/api/bands/${bandId}/members/${member.userId}`,
      { permissions: { canEditRepertoire: false } },
      ana.cookie,
    );
    const body = await json(
      await prepare(ana, bandId, {
        newSong: { title: "A" },
        recording: { source: "manual", title: "A" },
      }),
    );
    expect(
      (await api("GET", `${aa(other.bandId)}/jobs/${body.job.id}`, undefined, other.ana.cookie))
        .status,
    ).toBe(404);
    expect(
      (await api("GET", `${aa(bandId)}/jobs/${body.job.id}`, undefined, member.cookie)).status,
    ).toBe(200);
    expect(
      (await api("POST", `${aa(bandId)}/jobs/${body.job.id}/cancel`, undefined, member.cookie))
        .status,
    ).toBe(403);
    expect(
      (
        await prepare(member, bandId, {
          newSong: { title: "B" },
          recording: { source: "manual", title: "B" },
        })
      ).status,
    ).toBe(403);
  });
});

describe("human review", () => {
  it("records who confirmed the band's tempo and meter, and the live rehearsal uses them", async () => {
    const { ana, bandId } = await setup();
    const body = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Pérola Negra" },
        recording: { source: "musicbrainz", mbid: PEROLA },
      }),
    );
    await waitForJob(ana, bandId, body.job.id, ["awaiting_review"]);
    const songId = body.song.id as string;
    const review = `${aa(bandId)}/songs/${songId}/review`;

    expect((await api("POST", review, { target: "band_bpm", bpm: 1000 }, ana.cookie)).status).toBe(
      400,
    );
    const bpm = await api("POST", review, { target: "band_bpm", bpm: 72 }, ana.cookie);
    expect(bpm.status).toBe(200);
    let o = await json(bpm);
    expect(o.song.version.bpm).toBe(72);
    expect(o.confirmations.band_bpm).toMatchObject({
      value: { bpm: 72 },
      userName: "Ana",
      action: "confirm",
    });
    expect(typeof o.confirmations.band_bpm.at).toBe("string");
    expect(o.confirmations.band_meter).toBeNull();

    o = await json(
      await api("POST", review, { target: "band_meter", beatsPerBar: 4, beatUnit: 4 }, ana.cookie),
    );
    expect(o.song.version).toMatchObject({
      beatsPerBar: 4,
      beatUnit: 4,
      meterConfirmed: true,
      bpm: 72,
    });
    o = await json(await api("POST", review, { target: "band_key", key: "Fm" }, ana.cookie));
    expect(o.song.version).toMatchObject({ key: "Fm", bpm: 72, meterConfirmed: true });
    // A later correction is kept as history: both events exist, the latest wins.
    o = await json(await api("POST", review, { target: "band_bpm", bpm: 74 }, ana.cookie));
    const bpmEvents = o.reviews.filter((r: { target: string }) => r.target === "band_bpm");
    expect(bpmEvents).toHaveLength(2);
    expect(bpmEvents[0]).toMatchObject({ before: { bpm: 72 }, after: { bpm: 74 } });
    // The reference recording's own values are untouched by band confirmations.
    expect(o.song.originalBpm).toBeNull();

    // Live rehearsal: the confirmed tempo and meter feed the metronome as the band's values.
    const session = (
      await json(await api("POST", `/api/bands/${bandId}/rehearsals`, {}, ana.cookie))
    ).session.id as string;
    const ws = (
      await SELF.fetch(`${BASE}/api/bands/${bandId}/rehearsals/${session}/ws`, {
        headers: { upgrade: "websocket", cookie: ana.cookie },
      })
    ).webSocket!;
    ws.accept();
    const state = await new Promise<SessionState>((resolve) => {
      ws.addEventListener("message", (ev) => {
        const m = JSON.parse(ev.data as string) as ServerMessage;
        if (m.type === "snapshot") ws.send(JSON.stringify({ type: "set_song", songId }));
        if (m.type === "state" && m.state.currentSong?.songId === songId) resolve(m.state);
      });
    });
    expect(state.metronome.bpm).toBe(74);
    expect(state.currentSong).toMatchObject({ bpmSource: "band", meterConfirmed: true });
    ws.close();
  });

  it("requires repertoire permission to review", async () => {
    const { ana, bandId } = await setup();
    const member = await register();
    await joinByCode(ana, bandId, member);
    await api(
      "PATCH",
      `/api/bands/${bandId}/members/${member.userId}`,
      { permissions: { canEditRepertoire: false } },
      ana.cookie,
    );
    const songId = await createSong(ana, bandId, {
      title: "S",
      version: { beatsPerBar: 4, beatUnit: 4 },
    });
    expect(
      (
        await api(
          "POST",
          `${aa(bandId)}/songs/${songId}/review`,
          { target: "band_bpm", bpm: 90 },
          member.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (await api("GET", `${aa(bandId)}/songs/${songId}`, undefined, member.cookie)).status,
    ).toBe(200);
  });
});

describe("authorised audio", () => {
  it("registers audio only with a rights declaration, and reports that no engine is configured", async () => {
    const { ana, bandId } = await setup();
    const songId = await createSong(ana, bandId, {
      title: "Own Song",
      version: { beatsPerBar: 4, beatUnit: 4 },
    });
    const upload = async (name: string, type: string) => {
      const form = new FormData();
      form.set("file", new File([new Uint8Array([1, 2, 3, 4])], name, { type }));
      const res = await SELF.fetch(`${BASE}/api/bands/${bandId}/files`, {
        method: "POST",
        body: form,
        headers: { cookie: ana.cookie },
      });
      return (await json(res)).file.id as string;
    };
    const audioId = await upload("take1.mp3", "audio/mpeg");
    const pdfId = await upload("sheet.pdf", "application/pdf");
    const base = `${aa(bandId)}/songs/${songId}/audio-assets`;
    expect(
      (await api("POST", base, { fileId: audioId, rightsBasis: "own_recording" }, ana.cookie))
        .status,
    ).toBe(400);
    expect(
      (
        await api(
          "POST",
          base,
          { fileId: audioId, rightsBasis: "own_recording", declaration: false },
          ana.cookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await api(
          "POST",
          base,
          { fileId: pdfId, rightsBasis: "own_recording", declaration: true },
          ana.cookie,
        )
      ).status,
    ).toBe(415);
    const ok = await api(
      "POST",
      base,
      {
        fileId: audioId,
        rightsBasis: "own_recording",
        rightsNote: "our rehearsal take",
        declaration: true,
      },
      ana.cookie,
    );
    expect(ok.status).toBe(201);
    const { audioAsset } = await json(ok);
    expect(audioAsset).toMatchObject({
      rightsBasis: "own_recording",
      fileName: "take1.mp3",
      declaredBy: ana.userId,
    });

    const body = await json(
      await prepare(ana, bandId, {
        songId,
        recording: { source: "manual", title: "Own Song" },
        audioAssetId: audioAsset.id,
      }),
    );
    const job = await waitForJob(ana, bandId, body.job.id, ["awaiting_review"]);
    expect(job.steps[1]).toMatchObject({
      step: "analyzing_audio",
      outcome: "skipped",
      reason: "engine_not_configured",
    });
    expect(job.steps[2]).toMatchObject({
      step: "detecting_structure",
      outcome: "skipped",
      reason: "engine_not_configured",
    });
    const o = await json(await api("GET", `${aa(bandId)}/songs/${songId}`, undefined, ana.cookie));
    expect(o.audioAssets).toHaveLength(1);
    expect(o.results).toEqual([]); // nothing was analysed, so nothing is reported
    // Audio the band may process exists, but that is not an analysis.
    expect(o.preparation).toMatchObject({ audio: "available", analysis: "pending" });

    // A file declared after the reference exists is tied to that recording.
    const laterId = await upload("take2.mp3", "audio/mpeg");
    const later = await json(
      await api(
        "POST",
        base,
        { fileId: laterId, rightsBasis: "own_recording", declaration: true },
        ana.cookie,
      ),
    );
    expect(later.audioAsset.recordingId).toBe(body.recording.id);
    expect(
      (
        await api(
          "POST",
          base,
          {
            fileId: laterId,
            recordingId: "00000000-0000-4000-8000-000000000000",
            rightsBasis: "own_recording",
            declaration: true,
          },
          ana.cookie,
        )
      ).status,
    ).toBe(404);
  });
});

describe("arrangement map storage", () => {
  it("stores timed sections with kind and cues for the band version", async () => {
    const { ana, bandId } = await setup();
    const songId = await createSong(ana, bandId, {
      title: "Mapped",
      version: { beatsPerBar: 4, beatUnit: 4 },
      sections: [
        { name: "Intro", bars: 4, kind: "intro", startMs: 0, endMs: 9000 },
        {
          name: "Verso 1",
          bars: 8,
          kind: "verse",
          startMs: 9000,
          endMs: 27000,
          cues: [
            { type: "entry", text: "Entra o baixo", instrument: "bass", bar: 1 },
            { type: "stop", text: "Parada no último tempo" },
          ],
        },
      ],
    });
    const { song } = await json(
      await api("GET", `/api/bands/${bandId}/songs/${songId}`, undefined, ana.cookie),
    );
    expect(song.sections[0]).toMatchObject({
      name: "Intro",
      kind: "intro",
      startMs: 0,
      endMs: 9000,
      cues: [],
      origin: "band",
    });
    expect(song.sections[1].cues).toHaveLength(2);
    expect(song.sections[1].cues[0]).toMatchObject({ type: "entry", instrument: "bass", bar: 1 });
    // Sections without the new fields keep working.
    const plain = await createSong(ana, bandId, {
      title: "Plain",
      version: { beatsPerBar: 4, beatUnit: 4 },
      sections: [{ name: "A", bars: 8 }],
    });
    const p = (
      await json(await api("GET", `/api/bands/${bandId}/songs/${plain}`, undefined, ana.cookie))
    ).song;
    expect(p.sections[0]).toMatchObject({ kind: null, startMs: null, endMs: null, cues: [] });
  });
});

describe("source registry", () => {
  it("states how each source may be used", async () => {
    const { ana, bandId } = await setup();
    const { connectors, engines } = await json(
      await api("GET", `${aa(bandId)}/connectors`, undefined, ana.cookie),
    );
    const by = Object.fromEntries(connectors.map((c: { id: string }) => [c.id, c]));
    expect(by.musicbrainz).toMatchObject({ access: "api", mayStoreContent: true });
    expect(by.youtube).toMatchObject({ access: "official_embed", mayStoreContent: false });
    for (const id of ["cifraclub", "cifras", "songsterr"])
      expect(by[id]).toMatchObject({ access: "link_only", mayStoreContent: false });
    expect(engines.audioAnalysis).toBe("not_configured");
    // Reference links come only from platforms with a connector, all through official players.
    const linkable = connectors.filter((c: { referenceLinks: boolean }) => c.referenceLinks);
    expect(linkable.map((c: { id: string }) => c.id).sort()).toEqual(
      [...REFERENCE_PLATFORMS].sort(),
    );
    for (const c of linkable)
      expect(c).toMatchObject({ access: "official_embed", mayStoreContent: false });
  });
});

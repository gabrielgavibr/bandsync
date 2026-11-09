import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { AnalysisJobDto } from "@bandsync/shared";
import { describe, expect, it } from "vitest";
import { api, createBand, createSong, joinByCode, json, register, type Session } from "./helpers";
import { RESTRICTED_VIDEO_ID, SPOTIFY_TRACK_ID } from "./outbound";

/**
 * The band's main reference recording, chosen by pasting a link.
 * External answers are the real captures replayed by test/outbound.ts.
 */
const YT = "https://www.youtube.com/watch?v=JZqFoTIAJj8";
const SPOTIFY = `https://open.spotify.com/track/${SPOTIFY_TRACK_ID}`;
const SEGUNDO_SOL_GIL = "790c0007-1df2-4d2e-bd34-8a772894e800";

const aa = (bandId: string) => `/api/bands/${bandId}/autoarrange`;

async function setup() {
  const ana = await register({ displayName: "Ana", primaryInstrument: "drums", locale: "pt-BR" });
  const bandId = await createBand(ana, "Reference Band");
  return { ana, bandId };
}

const identify = (s: Session | null, bandId: string, url: unknown) =>
  api("POST", `${aa(bandId)}/reference/identify`, { url }, s?.cookie);

const prepare = (s: Session, bandId: string, body: Record<string, unknown>) =>
  api("POST", `${aa(bandId)}/prepare`, body, s.cookie);

const overview = async (s: Session, bandId: string, songId: string) =>
  json(await api("GET", `${aa(bandId)}/songs/${songId}`, undefined, s.cookie));

async function waitForJob(s: Session, bandId: string, jobId: string): Promise<AnalysisJobDto> {
  const stub = env.PREPARE_JOB.get(env.PREPARE_JOB.idFromName(jobId));
  let job: AnalysisJobDto | null = null;
  for (let i = 0; i < 60; i += 1) {
    job = (await json(await api("GET", `${aa(bandId)}/jobs/${jobId}`, undefined, s.cookie)))
      .job as AnalysisJobDto;
    if (job.status === "awaiting_review") return job;
    await runDurableObjectAlarm(stub);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`job stuck in ${job?.status}`);
}

describe("identifying a pasted link", () => {
  it("recognises YouTube, YouTube Music and Spotify through their official endpoints", async () => {
    const { ana, bandId } = await setup();

    const yt = await identify(ana, bandId, "https://youtu.be/JZqFoTIAJj8?si=tracking&t=12");
    expect(yt.status).toBe(200);
    expect((await json(yt)).reference).toEqual({
      platform: "youtube",
      externalId: "JZqFoTIAJj8",
      url: YT, // rebuilt from the id: tracking parameters are gone
      title:
        "Natiruts - Pérola Negra (Natiruts Acústico Ao Vivo no Rio de Janeiro) ft. Luiz Melodia",
      author: "NatirutsVEVO",
      artistGuess: null, // a channel name is not presented as the artist
      thumbnailUrl: "https://i.ytimg.com/vi/JZqFoTIAJj8/hqdefault.jpg",
      embeddable: true,
      metadata: "complete",
    });

    const music = await json(
      await identify(ana, bandId, "https://music.youtube.com/watch?v=JZqFoTIAJj8&feature=share"),
    );
    expect(music.reference).toMatchObject({
      platform: "youtube_music",
      url: "https://music.youtube.com/watch?v=JZqFoTIAJj8",
      author: "NatirutsVEVO",
    });

    // Spotify's public endpoint names the track but not the artist: reported as partial.
    for (const link of [
      SPOTIFY,
      `https://open.spotify.com/intl-pt/track/${SPOTIFY_TRACK_ID}?si=abc123`,
      `spotify:track:${SPOTIFY_TRACK_ID}`,
    ]) {
      const sp = await json(await identify(ana, bandId, link));
      expect(sp.reference).toMatchObject({
        platform: "spotify",
        externalId: SPOTIFY_TRACK_ID,
        url: SPOTIFY,
        title: "Never Gonna Give You Up",
        author: null,
        artistGuess: null,
        embeddable: true,
        metadata: "partial",
      });
      expect(sp.reference.thumbnailUrl).toMatch(/^https:\/\/image-cdn-[a-z]+\.spotifycdn\.com\//);
    }
  });

  it("keeps a link whose platform shares nothing, and says the player is unavailable", async () => {
    const { ana, bandId } = await setup();
    const res = await identify(
      ana,
      bandId,
      `https://www.youtube.com/watch?v=${RESTRICTED_VIDEO_ID}`,
    );
    expect(res.status).toBe(200);
    expect((await json(res)).reference).toMatchObject({
      platform: "youtube",
      externalId: RESTRICTED_VIDEO_ID,
      title: null,
      author: null,
      thumbnailUrl: null,
      embeddable: false,
      metadata: "missing",
    });
  });

  it("refuses dangerous, malformed, unsupported and unknown links with distinct reasons", async () => {
    const { ana, bandId } = await setup();
    const reason = async (url: unknown) => {
      const res = await identify(ana, bandId, url);
      const body = await json(res);
      return [res.status, body.error.code, body.error.details?.reason ?? null];
    };
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://www.youtube.com/watch?v=JZqFoTIAJj8",
      "not a link",
      "https://user:pass@www.youtube.com/watch?v=JZqFoTIAJj8",
      "https://www.youtube.com:8443/watch?v=JZqFoTIAJj8",
      "https://www.youtube.com/watch?v=JZqFoTIAJj8\nhttps://evil.example",
    ]) {
      expect(await reason(bad), bad).toEqual([400, "validation_error", "invalid_url"]);
    }
    for (const other of [
      "https://vimeo.com/123456",
      "https://soundcloud.com/artist/track",
      "https://www.deezer.com/track/3135556",
      "https://youtube.com.evil.example/watch?v=JZqFoTIAJj8",
      "https://evil.example/?next=https://www.youtube.com/watch?v=JZqFoTIAJj8",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:8787/api/health",
    ]) {
      const [status, code] = await reason(other);
      // A port makes the link invalid before the host is even considered.
      expect([status, code], other).toEqual(
        other.includes("localhost:") ? [400, "validation_error"] : [422, "unsupported_platform"],
      );
    }
    for (const notOne of [
      "https://www.youtube.com/playlist?list=PL1234567890",
      "https://www.youtube.com/@NatirutsVEVO",
      "https://www.youtube.com/watch?v=short",
      "https://open.spotify.com/album/6N9PS4QXF1D0OWPk0Sxtb4",
      "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
      "spotify:album:6N9PS4QXF1D0OWPk0Sxtb4",
      "https://spotify.link/abcDEF123",
    ]) {
      expect(await reason(notOne), notOne).toEqual([400, "validation_error", "unsupported_link"]);
    }
    expect(await reason("https://www.youtube.com/watch?v=AAAAAAAAAAA")).toEqual([
      404,
      "not_found",
      "reference_not_found",
    ]);
    expect(await reason("https://open.spotify.com/track/0000000000000000000000")).toEqual([
      404,
      "not_found",
      "reference_not_found",
    ]);
    expect((await identify(ana, bandId, "")).status).toBe(400);
    expect((await identify(ana, bandId, 42)).status).toBe(400);
  });

  it("requires permission to edit the repertoire and hides other bands", async () => {
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
    expect((await identify(member, bandId, YT)).status).toBe(403);
    expect((await identify(outsider, bandId, YT)).status).toBe(404);
    expect((await identify(null, bandId, YT)).status).toBe(401);
  });
});

describe("adding a song from a link", () => {
  it("creates the song with the reference the member confirmed, and analyses nothing", async () => {
    const { ana, bandId } = await setup();
    const res = await prepare(ana, bandId, {
      newSong: { title: "Pérola Negra" },
      // The video title is long and is not the song title: the member typed both fields.
      recording: {
        source: "link",
        title: "Pérola Negra",
        artistCredit: "Natiruts feat. Luiz Melodia",
      },
      referenceUrl: "https://youtu.be/JZqFoTIAJj8",
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.songCreated).toBe(true);
    expect(body.song).toMatchObject({
      title: "Pérola Negra",
      artist: "Natiruts feat. Luiz Melodia",
      composer: null, // a link says nothing about who wrote the song
      durationSeconds: null,
      originalBpm: null,
      originalKey: null,
    });
    expect(body.song.version).toMatchObject({ bpm: null, key: null, referenceUrl: YT });
    expect(body.recording).toMatchObject({
      identifiedBy: "link",
      mbid: null,
      title: "Pérola Negra",
      artistCredit: "Natiruts feat. Luiz Melodia",
      isReference: true,
      metadataEditedBy: ana.userId,
    });
    // What the platform said is kept next to what the member typed.
    expect(body.recording.link).toMatchObject({
      platform: "youtube",
      url: YT,
      title:
        "Natiruts - Pérola Negra (Natiruts Acústico Ao Vivo no Rio de Janeiro) ft. Luiz Melodia",
      author: "NatirutsVEVO",
    });

    const job = await waitForJob(ana, bandId, body.job.id);
    expect(job.steps.map((s) => [s.step, s.outcome, s.reason])).toEqual([
      ["searching_references", "done", "no_recording_identifier"],
      ["analyzing_audio", "skipped", "no_authorized_audio"],
      ["detecting_structure", "skipped", "no_authorized_audio"],
      ["preparing_materials", "done", null],
    ]);
    expect(job.costUnits).toBe(0); // no catalogue was consulted

    const o = await overview(ana, bandId, body.song.id);
    // A known link is neither audio to process nor an analysis.
    expect(o.preparation).toEqual({
      reference: "identified",
      player: "available",
      audio: "none",
      analysis: "not_possible",
      arrangement: "ready_for_review",
    });
    expect(o.results).toEqual([]);
    expect(o.song.references).toEqual([]);
    expect(o.reviews[0]).toMatchObject({
      target: "reference",
      action: "confirm",
      userId: ana.userId,
    });
  });

  it("accepts a Spotify link and leaves the artist empty when nobody stated it", async () => {
    const { ana, bandId } = await setup();
    const body = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Never Gonna Give You Up" },
        recording: { source: "link" },
        referenceUrl: `https://open.spotify.com/intl-pt/track/${SPOTIFY_TRACK_ID}?si=x`,
      }),
    );
    expect(body.song.artist).toBeNull();
    expect(body.recording).toMatchObject({
      identifiedBy: "link",
      title: "Never Gonna Give You Up",
      artistCredit: null,
      metadataEditedBy: null,
    });
    expect(body.song.reference).toMatchObject({
      platform: "spotify",
      externalId: SPOTIFY_TRACK_ID,
      url: SPOTIFY,
      durationMs: null, // the public endpoint does not give a duration
    });
  });

  it("shows the same reference to every member: song, list, repertoire", async () => {
    const { ana, bandId } = await setup();
    const bruno = await register({ displayName: "Bruno", primaryInstrument: "bass" });
    await joinByCode(ana, bandId, bruno, "bass");
    await api(
      "PATCH",
      `/api/bands/${bandId}/members/${bruno.userId}`,
      { permissions: { canEditRepertoire: false } },
      ana.cookie,
    );
    const { song } = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Pérola Negra" },
        recording: { source: "link", title: "Pérola Negra", artistCredit: "Natiruts" },
        referenceUrl: YT,
      }),
    );
    const rep = await json(
      await api(
        "POST",
        `/api/bands/${bandId}/repertoires`,
        { name: "Quinta", kind: "rehearsal" },
        ana.cookie,
      ),
    );
    await api(
      "POST",
      `/api/bands/${bandId}/repertoires/${rep.repertoire.id}/items`,
      { songId: song.id },
      ana.cookie,
    );

    const expected = { title: "Pérola Negra", artist: "Natiruts", platform: "youtube", url: YT };
    const one = await json(
      await api("GET", `/api/bands/${bandId}/songs/${song.id}`, undefined, bruno.cookie),
    );
    expect(one.song.reference).toMatchObject(expected);
    const list = await json(
      await api("GET", `/api/bands/${bandId}/songs`, undefined, bruno.cookie),
    );
    expect(list.songs[0].reference).toMatchObject(expected);
    const full = await json(
      await api(
        "GET",
        `/api/bands/${bandId}/repertoires/${rep.repertoire.id}`,
        undefined,
        bruno.cookie,
      ),
    );
    expect(full.repertoire.items[0].song.reference).toMatchObject(expected);
    expect((await overview(bruno, bandId, song.id)).preparation.reference).toBe("identified");

    // A member without permission can see it but not change it.
    expect(
      (
        await api(
          "PUT",
          `${aa(bandId)}/songs/${song.id}/reference/link`,
          { url: SPOTIFY },
          bruno.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          "PATCH",
          `${aa(bandId)}/songs/${song.id}/reference`,
          { title: "Other" },
          bruno.cookie,
        )
      ).status,
    ).toBe(403);
  });

  it("a song without a reference says so", async () => {
    const { ana, bandId } = await setup();
    const songId = await createSong(ana, bandId, {
      title: "Sem referência",
      version: { beatsPerBar: 4, beatUnit: 4 },
    });
    const o = await overview(ana, bandId, songId);
    expect(o.song.reference).toBeNull();
    expect(o.preparation).toEqual({
      reference: "none",
      player: "none",
      audio: "none",
      analysis: "not_possible",
      arrangement: "not_started",
    });
    expect(
      (await api("PUT", `${aa(bandId)}/songs/${songId}/reference/link`, { url: YT }, ana.cookie))
        .status,
    ).toBe(404);
  });
});

describe("changing the reference", () => {
  async function songWithConfirmedTempo() {
    const { ana, bandId } = await setup();
    const first = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Pérola Negra" },
        recording: { source: "link", title: "Pérola Negra", artistCredit: "Natiruts" },
        referenceUrl: YT,
      }),
    );
    await waitForJob(ana, bandId, first.job.id);
    const reviewed = await api(
      "POST",
      `${aa(bandId)}/songs/${first.song.id}/review`,
      { target: "band_bpm", bpm: 72 },
      ana.cookie,
    );
    expect(reviewed.status).toBe(200);
    return { ana, bandId, songId: first.song.id as string, firstRecordingId: first.recording.id };
  }

  it("asks for confirmation when confirmed values depend on the current recording", async () => {
    const { ana, bandId, songId, firstRecordingId } = await songWithConfirmedTempo();
    const other = {
      songId,
      recording: { source: "link", title: "Outra gravação", artistCredit: "Outro artista" },
      referenceUrl: SPOTIFY,
    };
    const refused = await prepare(ana, bandId, other);
    expect(refused.status).toBe(409);
    const err = (await json(refused)).error;
    expect(err.code).toBe("confirmation_required");
    expect(err.details.dependents).toMatchObject({ confirmedValues: ["band_bpm"], analyses: 0 });
    expect(err.details.current).toMatchObject({ recordingId: firstRecordingId, url: YT });

    // Nothing changed: same reference, same confirmed tempo.
    let o = await overview(ana, bandId, songId);
    expect(o.song.reference).toMatchObject({ recordingId: firstRecordingId, url: YT });
    expect(o.song.version.bpm).toBe(72);
    expect(o.recordings).toHaveLength(1);

    const done = await prepare(ana, bandId, { ...other, confirmReplace: true });
    expect(done.status).toBe(201);
    const body = await json(done);
    expect(body.replaced).toBe(true);
    expect(body.recording.id).not.toBe(firstRecordingId);

    o = await overview(ana, bandId, songId);
    expect(o.song.reference).toMatchObject({ platform: "spotify", url: SPOTIFY });
    expect(o.song.version.referenceUrl).toBe(SPOTIFY);
    // The band's confirmed tempo is not touched, only flagged as older than the reference.
    expect(o.song.version.bpm).toBe(72);
    expect(o.confirmations.band_bpm).toMatchObject({
      value: { bpm: 72 },
      beforeReferenceChange: true,
    });
    // The previous recording is kept, retired, with its history.
    expect(o.recordings).toHaveLength(2);
    const old = o.recordings.find((r: { id: string }) => r.id === firstRecordingId);
    expect(old).toMatchObject({ isReference: false });
    expect(old.retiredAt).toBeTruthy();
    expect(old.link.url).toBe(YT);
    const change = o.reviews.find(
      (r: { target: string; action: string }) => r.target === "reference" && r.action === "edit",
    );
    expect(change).toMatchObject({ userId: ana.userId });
    expect(change.before).toMatchObject({
      change: "replaced",
      recordingId: firstRecordingId,
      url: YT,
    });
    expect(change.after).toMatchObject({ url: SPOTIFY });

    // Confirming again after the change clears the flag.
    await api(
      "POST",
      `${aa(bandId)}/songs/${songId}/review`,
      { target: "band_bpm", bpm: 72 },
      ana.cookie,
    );
    o = await overview(ana, bandId, songId);
    expect(o.confirmations.band_bpm.beforeReferenceChange).toBe(false);

    // Going back to the first link reuses its row instead of creating a third.
    const back = await prepare(ana, bandId, {
      songId,
      recording: { source: "link", title: "Pérola Negra", artistCredit: "Natiruts" },
      referenceUrl: YT,
      confirmReplace: true,
    });
    expect((await json(back)).recording.id).toBe(firstRecordingId);
    expect((await overview(ana, bandId, songId)).recordings).toHaveLength(2);
  });

  it("asks before replacing even when nothing depends on it yet, never for the same recording", async () => {
    const { ana, bandId } = await setup();
    const first = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Rascunho" },
        recording: { source: "link", title: "Rascunho" },
        referenceUrl: YT,
      }),
    );
    await waitForJob(ana, bandId, first.job.id);
    // Same link again, in another shape: same recording, no question, no replacement.
    const again = await prepare(ana, bandId, {
      songId: first.song.id,
      recording: { source: "link", title: "Rascunho" },
      referenceUrl: "https://youtu.be/JZqFoTIAJj8?si=share",
    });
    expect(again.status).toBe(201);
    const same = await json(again);
    expect(same.replaced).toBe(false);
    expect(same.recording.id).toBe(first.recording.id);
    // The same video on YouTube Music is the same recording too.
    const music = await prepare(ana, bandId, {
      songId: first.song.id,
      recording: { source: "link", title: "Rascunho" },
      referenceUrl: "https://music.youtube.com/watch?v=JZqFoTIAJj8",
    });
    // 200 when it joins the preparation started just above (same work, not run twice).
    expect([200, 201]).toContain(music.status);
    const musicBody = await json(music);
    expect(musicBody.replaced).toBe(false);
    expect(musicBody.recording.id).toBe(first.recording.id);

    // Another recording: the member decides, even with no work done on the current one.
    const other = {
      songId: first.song.id,
      recording: { source: "link", title: "Rascunho" },
      referenceUrl: SPOTIFY,
    };
    const asked = await prepare(ana, bandId, other);
    expect(asked.status).toBe(409);
    const err = (await json(asked)).error;
    expect(err.code).toBe("confirmation_required");
    expect(err.details.hasDependents).toBe(false);
    expect(err.details.dependents).toEqual({
      analyses: 0,
      audioAssets: 0,
      confirmedValues: [],
      sections: 0,
      readyMaterials: 0,
    });
    // The last link given for the same recording is the one kept (YouTube Music here).
    expect(err.details.current).toMatchObject({
      recordingId: first.recording.id,
      url: "https://music.youtube.com/watch?v=JZqFoTIAJj8",
    });
    const done = await prepare(ana, bandId, { ...other, confirmReplace: true });
    expect(done.status).toBe(201);
    expect((await json(done)).replaced).toBe(true);
    const o = await overview(ana, bandId, first.song.id);
    // Set, link changed to YouTube Music (same recording), replaced.
    const changes = o.reviews
      .filter((r: { target: string }) => r.target === "reference")
      .map((r: { before: { change?: string } | null }) => r.before?.change ?? "set")
      .reverse();
    expect(changes).toEqual(["set", "link", "replaced"]);
  });

  it("a song without a reference gets the recording with no question", async () => {
    const { ana, bandId } = await setup();
    const songId = await createSong(ana, bandId, {
      title: "Sem referência",
      version: { bpm: 90, key: "A", beatsPerBar: 4, beatUnit: 4 },
    });
    const res = await prepare(ana, bandId, {
      songId,
      recording: { source: "link", artistCredit: "Natiruts" },
      referenceUrl: YT,
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.replaced).toBe(false);
    expect(body.song.reference).toMatchObject({ url: YT, artist: "Natiruts" });
    expect(body.song.version).toMatchObject({ bpm: 90, key: "A" });
  });

  it("cancel changes nothing; keeping the current reference prepares with it; confirming replaces and keeps the data", async () => {
    const { ana, bandId, songId, firstRecordingId } = await songWithConfirmedTempo();
    // Work done on the current recording: a section and a ready material.
    await api(
      "PATCH",
      `/api/bands/${bandId}/songs/${songId}`,
      {
        version: { beatsPerBar: 4, beatUnit: 4 },
        sections: [{ name: "Intro", bars: 8 }],
      },
      ana.cookie,
    );
    const material = await api(
      "POST",
      `/api/bands/${bandId}/songs/${songId}/materials`,
      {
        type: "chords",
        instrument: "guitar",
        title: "Nossa cifra",
        body: "A  D  E",
        status: "ready",
      },
      ana.cookie,
    );
    expect(material.status).toBe(201);
    const snapshot = async () => {
      const d = await json(
        await api("GET", `/api/bands/${bandId}/songs/${songId}`, undefined, ana.cookie),
      );
      return {
        bpm: d.song.version.bpm,
        sections: d.song.sections.map((x: { name: string }) => x.name),
        materials: d.materials
          .map((m: { title: string; status: string }) => `${m.title}:${m.status}`)
          .sort(),
      };
    };
    const before = await snapshot();
    expect(before.bpm).toBe(72);
    expect(before.sections).toEqual(["Intro"]);
    expect(before.materials).toContain("Nossa cifra:ready");

    const other = {
      songId,
      recording: { source: "link", title: "Outra" },
      referenceUrl: SPOTIFY,
    };
    // 1. Asked; the member cancels (no further request): nothing changed.
    const asked = await prepare(ana, bandId, other);
    expect(asked.status).toBe(409);
    expect((await json(asked)).error.details).toMatchObject({
      hasDependents: true,
      dependents: { confirmedValues: ["band_bpm"], sections: 1, readyMaterials: 1 },
    });
    let o = await overview(ana, bandId, songId);
    expect(o.song.reference).toMatchObject({ recordingId: firstRecordingId, url: YT });
    expect(o.recordings).toHaveLength(1);
    expect(await snapshot()).toEqual(before);

    // 2. "Keep the current reference": preparation goes on with it; the new link is not used.
    const kept = await prepare(ana, bandId, {
      songId,
      recording: { source: "current" },
      referenceUrl: SPOTIFY,
    });
    expect(kept.status).toBe(201);
    const keptBody = await json(kept);
    expect(keptBody.replaced).toBe(false);
    expect(keptBody.recording.id).toBe(firstRecordingId);
    expect(keptBody.job.recordingId).toBe(firstRecordingId);
    await waitForJob(ana, bandId, keptBody.job.id);
    o = await overview(ana, bandId, songId);
    expect(o.song.reference).toMatchObject({ recordingId: firstRecordingId, url: YT });
    expect(o.recordings).toHaveLength(1);
    expect(await snapshot()).toEqual(before);

    // 3. Confirmed: replaced, preparation runs, and every piece of the band's data is still there.
    const confirmed = await prepare(ana, bandId, { ...other, confirmReplace: true });
    expect(confirmed.status).toBe(201);
    const body = await json(confirmed);
    expect(body.replaced).toBe(true);
    const job = await waitForJob(ana, bandId, body.job.id);
    expect(job.recordingId).toBe(body.recording.id);
    o = await overview(ana, bandId, songId);
    expect(o.song.reference).toMatchObject({ platform: "spotify", url: SPOTIFY });
    expect(await snapshot()).toEqual(before);
    const old = o.recordings.find((r: { id: string }) => r.id === firstRecordingId);
    expect(old).toMatchObject({ isReference: false });
    expect(old.link.url).toBe(YT); // retired, not deleted
    expect(o.confirmations.band_bpm.beforeReferenceChange).toBe(true);
  });

  it("refuses to keep a reference that does not exist", async () => {
    const { ana, bandId } = await setup();
    const songId = await createSong(ana, bandId, {
      title: "Nada",
      version: { beatsPerBar: 4, beatUnit: 4 },
    });
    const res = await prepare(ana, bandId, { songId, recording: { source: "current" } });
    expect(res.status).toBe(404);
    expect((await json(res)).error.details.reason).toBe("no_reference");
    // Only meaningful for an existing song.
    expect(
      (await prepare(ana, bandId, { newSong: { title: "X" }, recording: { source: "current" } }))
        .status,
    ).toBe(400);
  });

  it("adds a link to a recording identified in the catalogue without replacing it", async () => {
    const { ana, bandId } = await setup();
    const first = await json(
      await prepare(ana, bandId, {
        newSong: { title: "O Segundo Sol" },
        recording: { source: "musicbrainz", mbid: SEGUNDO_SOL_GIL },
      }),
    );
    await waitForJob(ana, bandId, first.job.id);
    let o = await overview(ana, bandId, first.song.id);
    // The band knows which recording it means but has not given a link yet.
    expect(o.preparation).toMatchObject({ reference: "link_pending", player: "none" });
    expect(o.song.reference).toMatchObject({ title: "O segundo sol", url: null, platform: null });
    expect(o.results.map((r: { kind: string }) => r.kind)).toEqual(["duration"]);

    const path = `${aa(bandId)}/songs/${first.song.id}/reference/link`;
    expect((await api("PUT", path, { url: "https://vimeo.com/1" }, ana.cookie)).status).toBe(422);
    expect((await api("PUT", path, { url: "javascript:alert(1)" }, ana.cookie)).status).toBe(400);
    expect(
      (await api("PUT", path, { url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" }, ana.cookie))
        .status,
    ).toBe(404);

    const res = await api("PUT", path, { url: SPOTIFY }, ana.cookie);
    expect(res.status).toBe(200);
    o = await json(res);
    expect(o.recordings).toHaveLength(1);
    expect(o.recordings[0]).toMatchObject({
      id: first.recording.id,
      identifiedBy: "musicbrainz",
      mbid: SEGUNDO_SOL_GIL,
      title: "O segundo sol", // the catalogue's title, not the platform's
    });
    expect(o.recordings[0].link).toMatchObject({ platform: "spotify", url: SPOTIFY });
    expect(o.preparation).toMatchObject({ reference: "identified", player: "available" });
    expect(o.song.version.referenceUrl).toBe(SPOTIFY);
    // What was obtained for this recording is still attached to it.
    expect(o.results.map((r: { kind: string }) => r.kind)).toEqual(["duration"]);
    expect(o.reviews[0]).toMatchObject({ target: "reference", action: "edit" });
    expect(o.reviews[0].before).toMatchObject({ change: "link", url: null });

    // The link persists on a fresh read.
    const fresh = await json(
      await api("GET", `/api/bands/${bandId}/songs/${first.song.id}`, undefined, ana.cookie),
    );
    expect(fresh.song.reference).toMatchObject({ platform: "spotify", url: SPOTIFY });
  });

  it("lets a member correct the title and artist, keeping what the platform said", async () => {
    const { ana, bandId } = await setup();
    const first = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Never Gonna Give You Up" },
        recording: { source: "link" },
        referenceUrl: SPOTIFY,
      }),
    );
    const path = `${aa(bandId)}/songs/${first.song.id}/reference`;
    expect((await api("PATCH", path, {}, ana.cookie)).status).toBe(400);
    expect((await api("PATCH", path, { title: "" }, ana.cookie)).status).toBe(400);
    const res = await api("PATCH", path, { artistCredit: "Rick Astley" }, ana.cookie);
    expect(res.status).toBe(200);
    const o = await json(res);
    expect(o.song.reference).toMatchObject({
      title: "Never Gonna Give You Up",
      artist: "Rick Astley",
    });
    expect(o.recordings[0]).toMatchObject({ metadataEditedBy: ana.userId });
    expect(o.recordings[0].link.title).toBe("Never Gonna Give You Up");
    expect(o.reviews[0]).toMatchObject({ target: "reference", action: "edit", userId: ana.userId });
    expect(o.reviews[0].before).toMatchObject({ change: "metadata", artist: null });
    expect(o.reviews[0].after).toMatchObject({ artist: "Rick Astley" });
  });

  it("upgrades a link-only reference when the band later finds it in the catalogue", async () => {
    const { ana, bandId } = await setup();
    const first = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Pérola Negra" },
        recording: { source: "link", title: "Pérola Negra" },
        referenceUrl: YT,
      }),
    );
    await waitForJob(ana, bandId, first.job.id);
    await api(
      "POST",
      `${aa(bandId)}/songs/${first.song.id}/review`,
      { target: "band_bpm", bpm: 72 },
      ana.cookie,
    );
    // Same video, now with its catalogue entry: the same recording, so no confirmation is needed.
    const res = await prepare(ana, bandId, {
      songId: first.song.id,
      recording: { source: "musicbrainz", mbid: "0dea3c9a-ef6b-4707-90d8-685b2f4a2cd8" },
      referenceUrl: YT,
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.replaced).toBe(false);
    expect(body.recording).toMatchObject({
      id: first.recording.id,
      identifiedBy: "musicbrainz",
      title: "Pérola negra",
    });
    expect(body.recording.link.url).toBe(YT);
  });
});

describe("a link that belongs to another song", () => {
  it("warns that the link is already another song's reference, and a restore brings everything back", async () => {
    const { ana, bandId } = await setup();
    // Pérola Negra has its video; Esotérico has its catalogue recording, link pending.
    const perola = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Pérola Negra" },
        recording: { source: "link", title: "Pérola Negra" },
        referenceUrl: YT,
      }),
    );
    const esoterico = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Esotérico" },
        recording: { source: "musicbrainz", mbid: "8379142a-fe4e-4da2-8edf-fb493665a54f" },
      }),
    );
    await waitForJob(ana, bandId, esoterico.job.id);

    // Pasting Pérola Negra's video while working on Esotérico: identified, with a warning.
    const forEsoterico = await json(
      await api(
        "POST",
        `${aa(bandId)}/reference/identify`,
        { url: "https://youtu.be/JZqFoTIAJj8", songId: esoterico.song.id },
        ana.cookie,
      ),
    );
    expect(forEsoterico.usedBy).toEqual([{ songId: perola.song.id, title: "Pérola Negra" }]);
    // Not reported for the song that owns it, and the YouTube Music page counts as the same.
    const forPerola = await json(
      await api(
        "POST",
        `${aa(bandId)}/reference/identify`,
        { url: "https://music.youtube.com/watch?v=JZqFoTIAJj8", songId: perola.song.id },
        ana.cookie,
      ),
    );
    expect(forPerola.usedBy).toEqual([]);

    // The member confirmed anyway (the mistake that happened on staging)…
    const wrong = await prepare(ana, bandId, {
      songId: esoterico.song.id,
      recording: { source: "link", artistCredit: "Gilberto Gil" },
      referenceUrl: YT,
      confirmReplace: true,
    });
    expect(wrong.status).toBe(201);
    let o = await overview(ana, bandId, esoterico.song.id);
    expect(o.song.reference.url).toBe(YT);
    expect(o.song.version.referenceUrl).toBe(YT);

    // …and the restore: back to the catalogue recording, which was only retired.
    const restored = await prepare(ana, bandId, {
      songId: esoterico.song.id,
      recording: { source: "musicbrainz", mbid: "8379142a-fe4e-4da2-8edf-fb493665a54f" },
      confirmReplace: true,
    });
    expect(restored.status).toBe(201);
    const body = await json(restored);
    expect(body.recording.id).toBe(esoterico.recording.id); // the same row, not a new one
    o = await overview(ana, bandId, esoterico.song.id);
    expect(o.song.reference).toMatchObject({
      recordingId: esoterico.recording.id,
      releaseTitle: "Um Banda Um",
      url: null,
    });
    // The wrong link does not linger on the band version.
    expect(o.song.version.referenceUrl).toBeNull();
    expect(o.recordings).toHaveLength(2);
    // Pérola Negra was never touched.
    const p = await overview(ana, bandId, perola.song.id);
    expect(p.song.reference.url).toBe(YT);
    expect(p.recordings).toHaveLength(1);
  });
});

describe("live rehearsal", () => {
  it("finds the reference on the song the room loads, next to the band's own values", async () => {
    const { ana, bandId } = await setup();
    const { song, job } = await json(
      await prepare(ana, bandId, {
        newSong: { title: "Pérola Negra" },
        recording: { source: "link", title: "Pérola Negra" },
        referenceUrl: YT,
      }),
    );
    await waitForJob(ana, bandId, job.id);
    await api(
      "POST",
      `${aa(bandId)}/songs/${song.id}/review`,
      { target: "band_bpm", bpm: 72 },
      ana.cookie,
    );
    // The room reads the song over the same route as every other screen; the realtime session
    // itself carries tempo and meter only (see rehearsal.test.ts), never third-party audio.
    const read = await json(
      await api("GET", `/api/bands/${bandId}/songs/${song.id}`, undefined, ana.cookie),
    );
    expect(read.song.version.bpm).toBe(72);
    expect(read.song.reference).toMatchObject({ platform: "youtube", externalId: "JZqFoTIAJj8" });
  });
});

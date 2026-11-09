import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { analyzeAudio } from "../../../packages/shared/src/analysis/analyze";
import { CHORDS, synthTrack } from "../../../packages/shared/src/analysis/synth";
import { api, BASE, createSong, joinByCode, json, register } from "./helpers";

/** Analyses submitted from a member's device (microphone or authorised file). */
const YT = "https://www.youtube.com/watch?v=JZqFoTIAJj8";
const aa = (bandId: string) => `/api/bands/${bandId}/autoarrange`;

function report(bpm = 72) {
  const { samples, sampleRate } = synthTrack({
    bpm,
    beatsPerBar: 4,
    bars: 12,
    chords: [CHORDS.Am, CHORDS.Dm, CHORDS.E, CHORDS.Am],
    hats: true,
  });
  return analyzeAudio([samples], sampleRate);
}

async function songWithReference() {
  const ana = await register({ displayName: "Ana", primaryInstrument: "drums", locale: "pt-BR" });
  const res = await api("POST", "/api/bands", { name: "Analysis Band" }, ana.cookie);
  const bandId = (await json(res)).band.id as string;
  const prepared = await json(
    await api(
      "POST",
      `${aa(bandId)}/prepare`,
      {
        newSong: { title: "Pérola Negra" },
        recording: { source: "link", title: "Pérola Negra" },
        referenceUrl: YT,
      },
      ana.cookie,
    ),
  );
  return { ana, bandId, songId: prepared.song.id as string, recordingId: prepared.recording.id };
}

describe("analysis from a member's device", () => {
  it("stores what the microphone heard as estimates to review, tied to the reference", async () => {
    const { ana, bandId, songId, recordingId } = await songWithReference();
    const r = report();
    const res = await api(
      "POST",
      `${aa(bandId)}/songs/${songId}/analysis`,
      { input: "microphone", ...r },
      ana.cookie,
    );
    expect(res.status).toBe(201);
    const o = await json(res);
    const byKind = Object.fromEntries(
      o.results.map((x: { kind: string }) => [x.kind, x]),
    ) as Record<string, Record<string, unknown> & { value: Record<string, unknown> }>;
    expect(Object.keys(byKind).sort()).toEqual(
      ["beats", "bpm", "key", "tempo_ambiguity", "tempo_stability", "time_signature"].sort(),
    );
    for (const x of Object.values(byKind)) {
      expect(x).toMatchObject({
        origin: "audio_analysis",
        method: "bandsync-browser.microphone",
        methodVersion: "listen-v1",
        confidence: null,
        confidenceCalibrated: false,
        reviewStatus: "needs_review",
        input: "microphone",
        recordingId,
        createdBy: ana.userId,
        createdByName: "Ana",
      });
      expect(x.analysedSeconds).toBeGreaterThan(30);
    }
    expect(byKind.key!.value.key).toBe("Am");
    // The reading at 72 and its double are both kept: the band decides.
    const alts = byKind.tempo_ambiguity!.value.alternatives as number[];
    expect(alts.some((b) => Math.abs(b - 72) < 1)).toBe(true);
    expect(alts.some((b) => Math.abs(b - 144) < 2)).toBe(true);
    expect(o.preparation).toMatchObject({
      reference: "identified",
      audio: "none", // listening is not a file the band handed over
      analysis: "done",
      analysisFrom: "microphone",
    });
    // Nothing of the band's own version was filled in.
    expect(o.song.version).toMatchObject({ bpm: null, key: null, meterConfirmed: false });
  });

  it("an estimate becomes the band's value only when a member confirms it", async () => {
    const { ana, bandId, songId } = await songWithReference();
    const o = await json(
      await api(
        "POST",
        `${aa(bandId)}/songs/${songId}/analysis`,
        { input: "microphone", ...report(96) },
        ana.cookie,
      ),
    );
    const bpm = o.results.find((x: { kind: string }) => x.kind === "bpm");
    const key = o.results.find((x: { kind: string }) => x.kind === "key");
    // Confirm the estimated key as is, correct the tempo.
    await api(
      "POST",
      `${aa(bandId)}/songs/${songId}/review`,
      { target: "band_key", key: key.value.key, resultId: key.id },
      ana.cookie,
    );
    const after = await json(
      await api(
        "POST",
        `${aa(bandId)}/songs/${songId}/review`,
        { target: "band_bpm", bpm: 95, resultId: bpm.id },
        ana.cookie,
      ),
    );
    expect(after.song.version).toMatchObject({ bpm: 95, key: "Am" });
    const status = Object.fromEntries(
      after.results.map((x: { kind: string; reviewStatus: string }) => [x.kind, x.reviewStatus]),
    );
    expect(status).toMatchObject({ key: "confirmed", bpm: "edited" });
    // The original estimate is kept as it was.
    expect(after.results.find((x: { id: string }) => x.id === bpm.id).value.bpm).toBeCloseTo(
      bpm.value.bpm,
    );
  });

  it("analyses an authorised file for the recording it belongs to", async () => {
    const { ana, bandId, songId, recordingId } = await songWithReference();
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3, 4])], "take.mp3", { type: "audio/mpeg" }));
    const fileId = (
      await json(
        await SELF.fetch(`${BASE}/api/bands/${bandId}/files`, {
          method: "POST",
          body: form,
          headers: { cookie: ana.cookie },
        }),
      )
    ).file.id;
    const asset = (
      await json(
        await api(
          "POST",
          `${aa(bandId)}/songs/${songId}/audio-assets`,
          { fileId, rightsBasis: "own_recording", declaration: true },
          ana.cookie,
        ),
      )
    ).audioAsset;
    const before = await json(
      await api("GET", `${aa(bandId)}/songs/${songId}`, undefined, ana.cookie),
    );
    expect(before.preparation).toMatchObject({ audio: "available", analysis: "pending" });
    const path = `${aa(bandId)}/songs/${songId}/analysis`;
    // The file must be named, and must be one of this song's authorised files.
    expect((await api("POST", path, { input: "audio_file", ...report() }, ana.cookie)).status).toBe(
      400,
    );
    expect(
      (
        await api(
          "POST",
          path,
          {
            input: "audio_file",
            audioAssetId: "00000000-0000-4000-8000-000000000000",
            ...report(),
          },
          ana.cookie,
        )
      ).status,
    ).toBe(404);
    const res = await api(
      "POST",
      path,
      { input: "audio_file", audioAssetId: asset.id, ...report() },
      ana.cookie,
    );
    expect(res.status).toBe(201);
    const o = await json(res);
    const bpm = o.results.find((x: { kind: string }) => x.kind === "bpm");
    expect(bpm).toMatchObject({
      method: "bandsync-browser.audio_file",
      input: "audio_file",
      audioAssetId: asset.id,
      recordingId,
    });
    expect(o.preparation).toMatchObject({ analysis: "done", analysisFrom: "audio_file" });
  });

  it("refuses bad reports, songs without a reference and members without permission", async () => {
    const { ana, bandId, songId } = await songWithReference();
    const path = `${aa(bandId)}/songs/${songId}/analysis`;
    const good = { input: "microphone", ...report() };
    for (const bad of [
      { ...good, engine: "something-else" },
      { ...good, analysedSeconds: 2 },
      { ...good, bpm: { ...good.bpm, value: 1000 } },
      { ...good, key: { ...good.key, key: "H#" } },
      { ...good, key: { ...good.key, key: "<script>" } },
      { ...good, input: "youtube" },
      { ...good, beats: new Array(6000).fill(1) },
    ]) {
      expect(
        (await api("POST", path, bad, ana.cookie)).status,
        JSON.stringify(bad).slice(0, 80),
      ).toBe(400);
    }
    const bare = await createSong(ana, bandId, {
      title: "Sem referência",
      version: { beatsPerBar: 4, beatUnit: 4 },
    });
    const none = await api("POST", `${aa(bandId)}/songs/${bare}/analysis`, good, ana.cookie);
    expect(none.status).toBe(404);
    expect((await json(none)).error.details.reason).toBe("no_reference");

    const member = await register();
    await joinByCode(ana, bandId, member);
    await api(
      "PATCH",
      `/api/bands/${bandId}/members/${member.userId}`,
      { permissions: { canEditRepertoire: false } },
      ana.cookie,
    );
    expect((await api("POST", path, good, member.cookie)).status).toBe(403);
    const outsider = await register();
    expect((await api("POST", path, good, outsider.cookie)).status).toBe(404);
  });
});

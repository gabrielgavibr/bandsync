import { describe, expect, it } from "vitest";
import { api, createBand, createSong, json, register } from "./helpers";

const REAL = {
  title: "Song With Reference",
  artist: "Reference Artist",
  composer: "Composer Name",
  referenceRecording: "Live Album",
  referenceYear: 2012,
  originalBpm: 76,
  originalBpmStatus: "estimated",
  originalKey: "D",
  originalKeyStatus: "estimated",
  metadataSources: [
    { field: "bpm", value: "76", url: "https://example.org/bpm", note: "algorithmic estimate" },
    { field: "composer", value: "Composer Name", url: "https://musicbrainz.org/work/x" },
  ],
  version: { bpm: null, key: null, beatsPerBar: 4, beatUnit: 4, meterConfirmed: false },
};

describe("real-song metadata", () => {
  it("keeps reference recording facts apart from the band version, with sources", async () => {
    const s = await register();
    const bandId = await createBand(s);
    const id = await createSong(s, bandId, REAL);
    const { song } = await json(
      await api("GET", `/api/bands/${bandId}/songs/${id}`, undefined, s.cookie),
    );
    expect(song.composer).toBe("Composer Name");
    expect(song.referenceRecording).toBe("Live Album");
    expect(song.referenceYear).toBe(2012);
    expect(song.originalBpm).toBe(76);
    expect(song.originalBpmStatus).toBe("estimated");
    expect(song.version.bpm).toBeNull();
    expect(song.version.key).toBeNull();
    expect(song.version.meterConfirmed).toBe(false);
    expect(song.metadataSources).toHaveLength(2);
    expect(song.references).toEqual([]);

    // Band confirms its own tempo later; the reference value is untouched.
    const upd = await api(
      "PATCH",
      `/api/bands/${bandId}/songs/${id}`,
      { version: { bpm: 72, meterConfirmed: true } },
      s.cookie,
    );
    const after = (await json(upd)).song;
    expect(after.version.bpm).toBe(72);
    expect(after.version.meterConfirmed).toBe(true);
    expect(after.originalBpm).toBe(76);
  });

  it("existing songs default to unknown status and an empty source list", async () => {
    const s = await register();
    const bandId = await createBand(s);
    const id = await createSong(s, bandId, {
      title: "Plain",
      version: { beatsPerBar: 4, beatUnit: 4 },
    });
    const { song } = await json(
      await api("GET", `/api/bands/${bandId}/songs/${id}`, undefined, s.cookie),
    );
    expect(song.originalBpmStatus).toBe("unknown");
    expect(song.metadataSources).toEqual([]);
    expect(song.version.meterConfirmed).toBe(true);
  });

  it("rejects links that are not http(s)", async () => {
    const s = await register();
    const bandId = await createBand(s);
    const bad = await api(
      "POST",
      `/api/bands/${bandId}/songs`,
      { title: "X", version: { beatsPerBar: 4, beatUnit: 4, referenceUrl: "javascript:alert(1)" } },
      s.cookie,
    );
    expect(bad.status).toBe(400);
    const id = await createSong(s, bandId, {
      title: "Y",
      version: { beatsPerBar: 4, beatUnit: 4 },
    });
    const ref = await api(
      "POST",
      `/api/bands/${bandId}/songs/${id}/references`,
      { kind: "other", title: "x", url: "javascript:alert(1)" },
      s.cookie,
    );
    expect(ref.status).toBe(400);
  });
});

describe("pending materials", () => {
  it("allows a placeholder without content but still requires content for ready material", async () => {
    const s = await register();
    const bandId = await createBand(s);
    const id = await createSong(s, bandId, REAL);
    const base = `/api/bands/${bandId}/songs/${id}/materials`;
    const pending = await api(
      "POST",
      base,
      {
        type: "bass_tab",
        title: "Bass tab",
        instrument: "bass",
        status: "pending",
        body: "No licensed transcription yet.",
      },
      s.cookie,
    );
    expect(pending.status).toBe(201);
    expect((await json(pending)).material.status).toBe("pending");
    const empty = await api(
      "POST",
      base,
      { type: "chords", title: "Chords", instrument: "keys", status: "pending" },
      s.cookie,
    );
    expect(empty.status).toBe(201);
    const readyEmpty = await api(
      "POST",
      base,
      { type: "chords", title: "Chords", status: "ready" },
      s.cookie,
    );
    expect(readyEmpty.status).toBe(400);
    const example = await api(
      "POST",
      base,
      { type: "notes", title: "Example", body: "Original demo text", isExample: true },
      s.cookie,
    );
    expect((await json(example)).material.isExample).toBe(true);

    const { song } = await json(
      await api("GET", `/api/bands/${bandId}/songs/${id}`, undefined, s.cookie),
    );
    const statuses = song.materialSummary.map((m: { status: string }) => m.status).sort();
    expect(statuses).toEqual(["pending", "pending", "ready"]);
  });
});

describe("external references", () => {
  it("adds links once per URL, lists them in order and deletes them", async () => {
    const s = await register();
    const bandId = await createBand(s);
    const id = await createSong(s, bandId, REAL);
    const base = `/api/bands/${bandId}/songs/${id}/references`;
    const first = await api(
      "POST",
      base,
      {
        kind: "official_video",
        title: "Official video",
        url: "https://www.youtube.com/watch?v=abc",
      },
      s.cookie,
    );
    expect(first.status).toBe(201);
    const again = await api(
      "POST",
      base,
      { kind: "official_video", title: "Dup", url: "https://www.youtube.com/watch?v=abc" },
      s.cookie,
    );
    expect(again.status).toBe(200);
    expect((await json(again)).created).toBe(false);
    await api(
      "POST",
      base,
      { kind: "chords", title: "Chord chart", url: "https://www.cifraclub.com.br/x/y/" },
      s.cookie,
    );
    const { references } = await json(await api("GET", base, undefined, s.cookie));
    expect(references.map((r: { kind: string }) => r.kind)).toEqual(["official_video", "chords"]);
    const { song } = await json(
      await api("GET", `/api/bands/${bandId}/songs/${id}`, undefined, s.cookie),
    );
    expect(song.references).toHaveLength(2);
    expect((await api("DELETE", `${base}/${references[0].id}`, undefined, s.cookie)).status).toBe(
      200,
    );
    expect((await json(await api("GET", base, undefined, s.cookie))).references).toHaveLength(1);
  });

  it("requires repertoire permission to add links and hides them from other bands", async () => {
    const admin = await register();
    const member = await register();
    const outsider = await register();
    const bandId = await createBand(admin);
    const { invite } = await json(
      await api("POST", `/api/bands/${bandId}/invites`, { kind: "code" }, admin.cookie),
    );
    await api("POST", "/api/invites/accept", { code: invite.code }, member.cookie);
    await api(
      "PATCH",
      `/api/bands/${bandId}/members/${member.userId}`,
      { permissions: { canEditRepertoire: false } },
      admin.cookie,
    );
    const id = await createSong(admin, bandId, REAL);
    const base = `/api/bands/${bandId}/songs/${id}/references`;
    expect(
      (
        await api(
          "POST",
          base,
          { kind: "other", title: "t", url: "https://example.org" },
          member.cookie,
        )
      ).status,
    ).toBe(403);
    expect((await api("GET", base, undefined, member.cookie)).status).toBe(200);
    expect((await api("GET", base, undefined, outsider.cookie)).status).toBe(404);
  });
});

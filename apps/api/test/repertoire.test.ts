import { describe, expect, it } from "vitest";
import { api, createBand, createSong, json, register } from "./helpers";

const SONG = {
  title: "Noite de Ensaio",
  artist: "Banda Demo",
  originalKey: "D",
  originalBpm: 128,
  version: { bpm: 120, key: "C", beatsPerBar: 4, beatUnit: 4 },
  sections: [
    { name: "Intro", bars: 4 },
    { name: "Verse", bars: 8 },
    { name: "Chorus", bars: 8, notes: "stop on the last beat" },
  ],
};

describe("songs, materials and repertoires", () => {
  it("creates a song whose band version is independent of the original", async () => {
    const s = await register();
    const bandId = await createBand(s);
    const id = await createSong(s, bandId, SONG);
    const { song, materials } = await json(
      await api("GET", `/api/bands/${bandId}/songs/${id}`, undefined, s.cookie),
    );
    expect(song.originalKey).toBe("D");
    expect(song.version.key).toBe("C");
    expect(song.version.bpm).toBe(120);
    expect(song.sections.map((x: any) => x.name)).toEqual(["Intro", "Verse", "Chorus"]);
    expect(materials).toEqual([]);

    const upd = await api(
      "PATCH",
      `/api/bands/${bandId}/songs/${id}`,
      { version: { bpm: 116 }, sections: [{ name: "Intro", bars: 2 }] },
      s.cookie,
    );
    expect(upd.status).toBe(200);
    const after = (await json(upd)).song;
    expect(after.version.bpm).toBe(116);
    expect(after.originalBpm).toBe(128);
    expect(after.sections).toHaveLength(1);
  });

  it("stores per-instrument materials and summarises them", async () => {
    const s = await register();
    const bandId = await createBand(s);
    const id = await createSong(s, bandId, SONG);
    const base = `/api/bands/${bandId}/songs/${id}/materials`;
    const chords = await api(
      "POST",
      base,
      { type: "chords", title: "Cifra", instrument: "guitar", body: "C  G  Am  F" },
      s.cookie,
    );
    expect(chords.status).toBe(201);
    await api(
      "POST",
      base,
      { type: "bass_tab", title: "Baixo", instrument: "bass", body: "G|---3---|" },
      s.cookie,
    );
    await api("POST", base, { type: "lyrics", title: "Letra", body: "la la la" }, s.cookie);
    const empty = await api("POST", base, { type: "notes", title: "Vazio" }, s.cookie);
    expect(empty.status).toBe(400);

    const { materials } = await json(await api("GET", base, undefined, s.cookie));
    expect(materials).toHaveLength(3);
    const { song } = await json(
      await api("GET", `/api/bands/${bandId}/songs/${id}`, undefined, s.cookie),
    );
    expect(song.materialSummary).toHaveLength(3);

    const matId = (await json(chords)).material.id;
    const upd = await api("PATCH", `${base}/${matId}`, { body: "D  A  Bm  G", key: "D" }, s.cookie);
    expect((await json(upd)).material.version).toBe(2);
    expect((await api("DELETE", `${base}/${matId}`, undefined, s.cookie)).status).toBe(200);
    expect((await json(await api("GET", base, undefined, s.cookie))).materials).toHaveLength(2);
  });

  it("builds ordered repertoires without duplicating songs", async () => {
    const s = await register();
    const bandId = await createBand(s);
    const a = await createSong(s, bandId, { ...SONG, title: "A" });
    const b = await createSong(s, bandId, { ...SONG, title: "B" });
    const c = await createSong(s, bandId, { ...SONG, title: "C" });
    const rep = await api(
      "POST",
      `/api/bands/${bandId}/repertoires`,
      { name: "Show de sábado", kind: "setlist" },
      s.cookie,
    );
    expect(rep.status).toBe(201);
    const repId = (await json(rep)).repertoire.id;
    for (const songId of [a, b, c]) {
      await api("POST", `/api/bands/${bandId}/repertoires/${repId}/items`, { songId }, s.cookie);
    }
    // Adding the same song again does not duplicate it.
    await api(
      "POST",
      `/api/bands/${bandId}/repertoires/${repId}/items`,
      { songId: a, notes: "opener" },
      s.cookie,
    );
    let r = (
      await json(await api("GET", `/api/bands/${bandId}/repertoires/${repId}`, undefined, s.cookie))
    ).repertoire;
    expect(r.items.map((i: any) => i.song.title)).toEqual(["A", "B", "C"]);
    expect(r.items[0].notes).toBe("opener");

    const order = await api(
      "PUT",
      `/api/bands/${bandId}/repertoires/${repId}/order`,
      { songIds: [c, a, b] },
      s.cookie,
    );
    expect(order.status).toBe(200);
    r = (await json(order)).repertoire;
    expect(r.items.map((i: any) => i.song.title)).toEqual(["C", "A", "B"]);

    await api(
      "DELETE",
      `/api/bands/${bandId}/repertoires/${repId}/items/${a}`,
      undefined,
      s.cookie,
    );
    r = (
      await json(await api("GET", `/api/bands/${bandId}/repertoires/${repId}`, undefined, s.cookie))
    ).repertoire;
    expect(r.items.map((i: any) => i.song.title)).toEqual(["C", "B"]);
    // The song itself still exists.
    expect((await api("GET", `/api/bands/${bandId}/songs/${a}`, undefined, s.cookie)).status).toBe(
      200,
    );
  });

  it("requires repertoire permission to edit", async () => {
    const admin = await register();
    const member = await register();
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
    expect((await api("POST", `/api/bands/${bandId}/songs`, SONG, member.cookie)).status).toBe(403);
    expect((await api("GET", `/api/bands/${bandId}/songs`, undefined, member.cookie)).status).toBe(
      200,
    );
  });
});

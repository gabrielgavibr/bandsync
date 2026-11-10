import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../src/env";
import { stagingGate } from "../src/middleware/stagingGate";
import { api, cookieOf, createBand, createSong, joinByCode, json, register } from "./helpers";

const tokenOf = (url: string) => url.split("/convite/")[1]!;

async function personalInvite(
  admin: { cookie: string },
  bandId: string,
  body: Record<string, unknown>,
) {
  const res = await api("POST", `/api/bands/${bandId}/personal-invites`, body, admin.cookie);
  expect(res.status).toBe(201);
  return json(res);
}

describe("personal invitations", () => {
  it("one private link per musician: preview, sign-up with it, joins with the planned instrument, used once", async () => {
    const admin = await register({ displayName: "Admin" });
    const bandId = await createBand(admin, "BANDA SEM NOME");
    const { invite, url } = await personalInvite(admin, bandId, {
      inviteeName: "Leonardo Morango",
      instrument: "percussion",
      secondaryInstruments: ["vocals"],
    });
    expect(url).toMatch(/\/convite\/[A-Za-z0-9_-]{43}$/);
    expect(invite.status).toBe("active");
    // Only a hash of the token is stored.
    const stored = await env.DB.prepare("SELECT code FROM band_invitations WHERE id = ?")
      .bind(invite.id)
      .first<{ code: string }>();
    expect(stored!.code).not.toContain(tokenOf(url));

    const preview = await json(await api("GET", `/api/personal-invites/${tokenOf(url)}`));
    expect(preview.invite).toMatchObject({
      status: "active",
      inviteeName: "Leonardo Morango",
      instrument: "percussion",
      secondaryInstruments: ["vocals"],
      role: "member",
      band: { id: bandId, name: "BANDA SEM NOME" },
    });
    expect(JSON.stringify(preview)).not.toContain("Admin"); // nothing about other people

    const reg = await api("POST", `/api/personal-invites/${tokenOf(url)}/register`, {
      email: "leo@example.com",
      password: "a-private-password",
    });
    expect(reg.status).toBe(201);
    const body = await json(reg);
    expect(body.user.displayName).toBe("Leonardo Morango");
    expect(body.user.primaryInstrument).toBe("percussion");
    expect(body.user.secondaryInstruments).toEqual(["vocals"]);
    expect(body.band.id).toBe(bandId);
    const leo = cookieOf(reg);
    const members = await json(await api("GET", `/api/bands/${bandId}/members`, undefined, leo));
    const me = members.members.find(
      (m: { displayName: string }) => m.displayName === "Leonardo Morango",
    );
    expect(me).toMatchObject({ role: "member", instrument: "percussion" });

    // Used once: nobody else can take it, with a new account or an existing one.
    const again = await api("POST", `/api/personal-invites/${tokenOf(url)}/register`, {
      email: "someone-else@example.com",
      password: "another-password",
    });
    expect(again.status).toBe(410);
    expect((await json(again)).error.code).toBe("invite_used");
    const other = await register();
    const steal = await api(
      "POST",
      `/api/personal-invites/${tokenOf(url)}/accept`,
      {},
      other.cookie,
    );
    expect(steal.status).toBe(410);
    const list = await json(
      await api("GET", `/api/bands/${bandId}/personal-invites`, undefined, admin.cookie),
    );
    expect(list.invites[0]).toMatchObject({ status: "used", acceptedByName: "Leonardo Morango" });
  });

  it("an existing account takes its invitation without creating another one", async () => {
    const admin = await register();
    const bandId = await createBand(admin);
    const { url } = await personalInvite(admin, bandId, {
      inviteeName: "Jeffs",
      instrument: "keys",
    });
    const jeffs = await register({ displayName: "Jeff S", primaryInstrument: "guitar" });
    const res = await api("POST", `/api/personal-invites/${tokenOf(url)}/accept`, {}, jeffs.cookie);
    expect(res.status).toBe(200);
    const members = await json(
      await api("GET", `/api/bands/${bandId}/members`, undefined, jeffs.cookie),
    );
    expect(
      members.members.find((m: { userId: string }) => m.userId === jeffs.userId).instrument,
    ).toBe("keys");
    // Signing up again with an e-mail already in use is refused (no duplicate accounts).
    const { url: url2 } = await personalInvite(admin, bandId, { inviteeName: "Outro" });
    const dup = await api("POST", `/api/personal-invites/${tokenOf(url2)}/register`, {
      email: jeffs.email,
      password: "whatever-password",
    });
    expect(dup.status).toBe(409);
    expect((await json(dup)).error.code).toBe("email_in_use");
    // ...and the invitation is still there for its person.
    expect(
      (await json(await api("GET", `/api/personal-invites/${tokenOf(url2)}`))).invite.status,
    ).toBe("active");
  });

  it("only admins create or revoke; revoked, expired and unknown links do nothing", async () => {
    const admin = await register();
    const bandId = await createBand(admin);
    const member = await register();
    await joinByCode(admin, bandId, member);
    const denied = await api(
      "POST",
      `/api/bands/${bandId}/personal-invites`,
      { inviteeName: "X" },
      member.cookie,
    );
    expect(denied.status).toBe(403);
    expect(
      (await api("GET", `/api/bands/${bandId}/personal-invites`, undefined, member.cookie)).status,
    ).toBe(403);

    const { invite, url } = await personalInvite(admin, bandId, {
      inviteeName: "Renan Rosa",
      instrument: "bass",
    });
    const del = await api(
      "DELETE",
      `/api/bands/${bandId}/personal-invites/${invite.id}`,
      undefined,
      admin.cookie,
    );
    expect(del.status).toBe(200);
    const revoked = await api("POST", `/api/personal-invites/${tokenOf(url)}/register`, {
      email: "renan@example.com",
      password: "a-private-password",
    });
    expect((await json(revoked)).error.code).toBe("invite_revoked");

    const { invite: inv2, url: url2 } = await personalInvite(admin, bandId, {
      inviteeName: "André Pézão",
    });
    await env.DB.prepare("UPDATE band_invitations SET expires_at = ? WHERE id = ?")
      .bind("2000-01-01T00:00:00.000Z", inv2.id)
      .run();
    const expired = await api("POST", `/api/personal-invites/${tokenOf(url2)}/register`, {
      email: "andre@example.com",
      password: "a-private-password",
    });
    expect((await json(expired)).error.code).toBe("invite_expired");

    const unknown = await api("GET", `/api/personal-invites/${"x".repeat(43)}`);
    expect(unknown.status).toBe(404);
    // A personal token is not a band code.
    const other = await register();
    const asCode = await api("POST", "/api/invites/accept", { code: tokenOf(url) }, other.cookie);
    expect(asCode.status).toBe(404);
  });

  it("a band set up for someone without an account becomes theirs when they accept", async () => {
    const setup = await register({ displayName: "Configuração" });
    const bandId = await createBand(setup, "BANDA SEM NOME");
    // The set-up account is not a member of the real band.
    await env.DB.prepare("DELETE FROM band_members WHERE band_id = ?").bind(bandId).run();
    await env.DB.prepare(
      `INSERT INTO band_invitations (id, band_id, kind, code, role, instrument, invitee_name, grants_ownership,
         max_uses, uses, expires_at, created_by, created_at)
       VALUES ('own-1', ?, 'link', ?, 'admin', 'drums', 'Gabriel Gavi', 1, 1, 0, ?, ?, ?)`,
    )
      .bind(
        bandId,
        `pi_${await sha256("owner-token-owner-token-owner-token-00")}`,
        "2100-01-01T00:00:00.000Z",
        setup.userId,
        new Date().toISOString(),
      )
      .run();
    const reg = await api(
      "POST",
      "/api/personal-invites/owner-token-owner-token-owner-token-00/register",
      {
        email: "gavi@example.com",
        password: "a-private-password",
      },
    );
    expect(reg.status).toBe(201);
    const gavi = cookieOf(reg);
    const band = (await json(await api("GET", `/api/bands/${bandId}`, undefined, gavi))).band;
    expect(band.myRole).toBe("admin");
    expect(band.myPermissions.canManageEvents).toBe(true);
    const row = await env.DB.prepare("SELECT created_by FROM bands WHERE id = ?")
      .bind(bandId)
      .first<{ created_by: string }>();
    expect(row!.created_by).toBe((await json(reg)).user.id);
  });
});

async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("staging gate and personal links", () => {
  it("a valid personal link opens the gate; a made-up or revoked one does not", async () => {
    const admin = await register();
    const bandId = await createBand(admin);
    const { invite, url } = await personalInvite(admin, bandId, { inviteeName: "Gabis" });
    const app = new Hono<AppEnv>();
    app.use("*", stagingGate);
    app.get("*", (c) => c.text("app shell"));
    const bindings = {
      ...env,
      STAGING_ACCESS_KEY: "KEY-KEY",
      RATE_LIMITS: "off",
    } as unknown as AppEnv["Bindings"];
    const req = (path: string, init?: RequestInit) =>
      app.request(`https://stg.example${path}`, init, bindings);

    const path = `/convite/${tokenOf(url)}`;
    const open = await req(path);
    expect(open.status).toBe(302);
    expect(open.headers.get("location")).toBe(path);
    const cookie = (open.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(cookie).toMatch(/^bs_access=/);
    expect(await (await req(path, { headers: { cookie } })).text()).toBe("app shell");

    const fake = await req(`/convite/${"A".repeat(43)}`);
    expect(fake.headers.get("location")).toMatch(/^\/__access/);
    await api(
      "DELETE",
      `/api/bands/${bandId}/personal-invites/${invite.id}`,
      undefined,
      admin.cookie,
    );
    expect((await req(path)).headers.get("location")).toMatch(/^\/__access/);
  });
});

describe("weekly rehearsal, attendance and board", () => {
  async function bandWithSchedule() {
    const admin = await register({ displayName: "Gavi" });
    const bandId = await createBand(admin, "BANDA SEM NOME");
    const member = await register({ displayName: "Gabis" });
    await joinByCode(admin, bandId, member);
    const res = await api(
      "POST",
      `/api/bands/${bandId}/agenda/schedules`,
      {
        title: "Ensaio semanal",
        weekday: 2,
        time: "19:00",
        timezone: "America/Sao_Paulo",
        startDate: "2030-01-01",
      },
      admin.cookie,
    );
    expect(res.status).toBe(201);
    const agenda = await json(
      await api("GET", `/api/bands/${bandId}/agenda`, undefined, member.cookie),
    );
    return { admin, member, bandId, agenda };
  }

  it("Tuesdays at 19:00 Brasília: a few dates ahead, stored in UTC, the rest is the rule", async () => {
    const { bandId, agenda, admin } = await bandWithSchedule();
    expect(agenda.schedules).toHaveLength(1);
    expect(agenda.upcoming).toHaveLength(4);
    expect(agenda.upcoming[0]).toMatchObject({
      localDate: "2030-01-01",
      localTime: "19:00",
      timezone: "America/Sao_Paulo",
      startsAt: "2030-01-01T22:00:00.000Z",
      endsAt: null,
      myAttendance: "pending",
      session: null,
    });
    expect(agenda.upcoming.map((o: { localDate: string }) => o.localDate)).toEqual([
      "2030-01-01",
      "2030-01-08",
      "2030-01-15",
      "2030-01-22",
    ]);
    // Reading again does not create more.
    await api("GET", `/api/bands/${bandId}/agenda`, undefined, admin.cookie);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE band_id = ?")
      .bind(bandId)
      .first<{ n: number }>();
    expect(n!.n).toBe(4);
  });

  it("one rehearsal changed on its own keeps its change when the series changes", async () => {
    const { bandId, agenda, admin, member } = await bandWithSchedule();
    const [first, second] = agenda.upcoming;
    const denied = await api(
      "PATCH",
      `/api/bands/${bandId}/agenda/occurrences/${first.id}`,
      { time: "20:00" },
      member.cookie,
    );
    expect(denied.status).toBe(403);
    const one = await json(
      await api(
        "PATCH",
        `/api/bands/${bandId}/agenda/occurrences/${first.id}`,
        { time: "20:00", location: "Estúdio B" },
        admin.cookie,
      ),
    );
    expect(one.occurrence).toMatchObject({
      localTime: "20:00",
      startsAt: "2030-01-01T23:00:00.000Z",
      detached: true,
      location: "Estúdio B",
    });
    await api(
      "PATCH",
      `/api/bands/${bandId}/agenda/schedules/${agenda.schedules[0].id}`,
      { time: "18:30", durationMinutes: 180 },
      admin.cookie,
    );
    const after = await json(
      await api("GET", `/api/bands/${bandId}/agenda`, undefined, admin.cookie),
    );
    const byId = (id: string) => after.upcoming.find((o: { id: string }) => o.id === id);
    expect(byId(first.id).localTime).toBe("20:00");
    expect(byId(second.id)).toMatchObject({
      localTime: "18:30",
      startsAt: "2030-01-08T21:30:00.000Z",
      endsAt: "2030-01-09T00:30:00.000Z",
    });
  });

  it("attendance: each one answers for themself and can change", async () => {
    const { bandId, agenda, member } = await bandWithSchedule();
    const id = agenda.upcoming[0].id;
    const r1 = await json(
      await api(
        "PUT",
        `/api/bands/${bandId}/agenda/occurrences/${id}/attendance`,
        { status: "confirmed" },
        member.cookie,
      ),
    );
    expect(r1.occurrence.myAttendance).toBe("confirmed");
    expect(r1.occurrence.attendance).toEqual({ confirmed: 1, declined: 0, pending: 1 });
    const r2 = await json(
      await api(
        "PUT",
        `/api/bands/${bandId}/agenda/occurrences/${id}/attendance`,
        { status: "declined" },
        member.cookie,
      ),
    );
    expect(
      r2.attendance.find((a: { displayName: string }) => a.displayName === "Gabis").status,
    ).toBe("declined");
    expect(
      r2.attendance.find((a: { displayName: string }) => a.displayName === "Gavi").status,
    ).toBe("pending");
  });

  it("board: post, edit own, admin hides, others cannot; before, during and after the live session", async () => {
    const { bandId, agenda, admin, member } = await bandWithSchedule();
    const id = agenda.upcoming[0].id;
    const base = `/api/bands/${bandId}/agenda/occurrences/${id}/comments`;
    const songId = await createSong(admin, bandId, { title: "Meu Velho" });

    const before = await json(
      await api("POST", base, { body: "Vamos passar Meu Velho primeiro", songId }, member.cookie),
    );
    expect(before.comment).toMatchObject({
      author: { displayName: "Gabis" },
      song: { id: songId, title: "Meu Velho" },
      canEdit: true,
      canDelete: true,
    });

    // During: the live session of this rehearsal.
    const s = await api(
      "POST",
      `/api/bands/${bandId}/agenda/occurrences/${id}/session`,
      {},
      member.cookie,
    );
    expect(s.status).toBe(201);
    const session = (await json(s)).session;
    expect(session.eventId).toBe(id);
    const live = await json(
      await api("GET", `/api/bands/${bandId}/rehearsals/${session.id}`, undefined, member.cookie),
    );
    expect(live.session.eventId).toBe(id);
    expect(live.live.state.status).not.toBe("playing");
    const again = await json(
      await api("POST", `/api/bands/${bandId}/agenda/occurrences/${id}/session`, {}, admin.cookie),
    );
    expect(again).toMatchObject({ reused: true, session: { id: session.id } });
    const during = await json(
      await api("POST", base, { body: "Baixo mais alto no refrão" }, admin.cookie),
    );

    const list = await json(await api("GET", base, undefined, member.cookie));
    expect(list.comments.map((c: { body: string }) => c.body)).toEqual([
      "Vamos passar Meu Velho primeiro",
      "Baixo mais alto no refrão",
    ]);
    const adminsComment = list.comments[1];
    expect(adminsComment).toMatchObject({ canEdit: false, canDelete: false });

    // Others cannot edit or remove someone else's comment; the API decides, not the screen.
    expect(
      (await api("PATCH", `${base}/${during.comment.id}`, { body: "hack" }, member.cookie)).status,
    ).toBe(403);
    expect(
      (await api("DELETE", `${base}/${during.comment.id}`, undefined, member.cookie)).status,
    ).toBe(403);
    const edited = await json(
      await api(
        "PATCH",
        `${base}/${before.comment.id}`,
        { body: "Meu Velho primeiro!" },
        member.cookie,
      ),
    );
    expect(edited.comment.editedAt).not.toBeNull();
    expect(
      (await api("PATCH", `${base}/${before.comment.id}`, { body: "x" }, admin.cookie)).status,
    ).toBe(403);
    expect(
      (await api("DELETE", `${base}/${before.comment.id}`, undefined, admin.cookie)).status,
    ).toBe(200);

    // After: a finished session leaves the board open.
    await env.DB.prepare("UPDATE rehearsal_sessions SET status = 'ended' WHERE id = ?")
      .bind(session.id)
      .run();
    const after = await api("POST", base, { body: "Bom ensaio, pessoal" }, member.cookie);
    expect(after.status).toBe(201);
    const final = await json(await api("GET", base, undefined, admin.cookie));
    expect(final.comments.map((c: { body: string }) => c.body)).toEqual([
      "Baixo mais alto no refrão",
      "Bom ensaio, pessoal",
    ]);
    const occ = await json(
      await api("GET", `/api/bands/${bandId}/agenda/occurrences/${id}`, undefined, admin.cookie),
    );
    expect(occ.occurrence).toMatchObject({
      commentCount: 2,
      session: { id: session.id, status: "ended" },
    });
  });

  it("a session opened from the lobby during today's rehearsal belongs to it", async () => {
    const admin = await register();
    const bandId = await createBand(admin);
    const now = new Date();
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    await api(
      "POST",
      `/api/bands/${bandId}/agenda/schedules`,
      { title: "Ensaio", weekday, time, timezone: "America/Sao_Paulo", startDate: date },
      admin.cookie,
    );
    const agenda = await json(await api("GET", `/api/bands/${bandId}/agenda`, undefined, admin.cookie));
    const res = await json(await api("POST", `/api/bands/${bandId}/rehearsals`, {}, admin.cookie));
    expect(res.session.eventId).toBe(agenda.upcoming[0].id);
  });

  it("outsiders see nothing: no agenda, no board, no song from another band", async () => {
    const { bandId, agenda, member } = await bandWithSchedule();
    const outsider = await register();
    const id = agenda.upcoming[0].id;
    expect(
      (await api("GET", `/api/bands/${bandId}/agenda`, undefined, outsider.cookie)).status,
    ).toBe(404);
    expect(
      (
        await api(
          "GET",
          `/api/bands/${bandId}/agenda/occurrences/${id}/comments`,
          undefined,
          outsider.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await api(
          "POST",
          `/api/bands/${bandId}/agenda/occurrences/${id}/comments`,
          { body: "oi" },
          outsider.cookie,
        )
      ).status,
    ).toBe(404);
    const otherBand = await createBand(outsider);
    const foreignSong = await createSong(outsider, otherBand, { title: "Alheia" });
    const res = await api(
      "POST",
      `/api/bands/${bandId}/agenda/occurrences/${id}/comments`,
      { body: "oi", songId: foreignSong },
      member.cookie,
    );
    expect(res.status).toBe(400);
    // An event id from another band is not found through this band.
    expect(
      (
        await api(
          "GET",
          `/api/bands/${otherBand}/agenda/occurrences/${id}`,
          undefined,
          outsider.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await api(
          "POST",
          `/api/bands/${bandId}/agenda/occurrences/${id}/comments`,
          { body: "" },
          member.cookie,
        )
      ).status,
    ).toBe(400);
  });
});

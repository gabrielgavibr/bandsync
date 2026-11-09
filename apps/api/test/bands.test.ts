import { describe, expect, it } from "vitest";
import { api, createBand, json, register } from "./helpers";

describe("bands, members and invitations", () => {
  it("creates a band with the creator as admin", async () => {
    const s = await register({ primaryInstrument: "drums" });
    const res = await api(
      "POST",
      "/api/bands",
      { name: "Os Sincronizados", genre: "rock" },
      s.cookie,
    );
    expect(res.status).toBe(201);
    const { band } = await json(res);
    expect(band.myRole).toBe("admin");
    expect(band.memberCount).toBe(1);
    expect(band.myPermissions.canControlRehearsal).toBe(true);
    const list = await json(await api("GET", "/api/bands", undefined, s.cookie));
    expect(list.bands).toHaveLength(1);
    const members = await json(
      await api("GET", `/api/bands/${band.id}/members`, undefined, s.cookie),
    );
    expect(members.members[0].instrument).toBe("drums");
  });

  it("isolates bands: non-members get 404, not 403", async () => {
    const a = await register();
    const b = await register();
    const bandId = await createBand(a);
    const res = await api("GET", `/api/bands/${bandId}`, undefined, b.cookie);
    expect(res.status).toBe(404);
    expect((await api("GET", `/api/bands/${bandId}/songs`, undefined, b.cookie)).status).toBe(404);
  });

  it("invites by code and the invitee joins with the suggested instrument", async () => {
    const admin = await register();
    const bassist = await register({ primaryInstrument: "guitar" });
    const bandId = await createBand(admin);
    const inv = await api(
      "POST",
      `/api/bands/${bandId}/invites`,
      { kind: "code", instrument: "bass" },
      admin.cookie,
    );
    expect(inv.status).toBe(201);
    const { invite, url } = await json(inv);
    expect(invite.code).toHaveLength(8);
    expect(invite.status).toBe("active");
    expect(url).toContain(`/join/${invite.code}`);

    const preview = await api("GET", `/api/invites/${invite.code}`, undefined, bassist.cookie);
    expect(preview.status).toBe(200);
    expect((await json(preview)).invite.band.id).toBe(bandId);

    const acc = await api("POST", "/api/invites/accept", { code: invite.code }, bassist.cookie);
    expect(acc.status).toBe(200);
    expect((await json(acc)).band.myRole).toBe("member");
    const members = (
      await json(await api("GET", `/api/bands/${bandId}/members`, undefined, admin.cookie))
    ).members;
    expect(members.find((m: any) => m.userId === bassist.userId).instrument).toBe("bass");

    // Single use: a second accept fails, and the admin sees it as used.
    const third = await register();
    const again = await api("POST", "/api/invites/accept", { code: invite.code }, third.cookie);
    expect(again.status).toBe(410);
    expect((await json(again)).error.code).toBe("invite_used");
    const list = (
      await json(await api("GET", `/api/bands/${bandId}/invites`, undefined, admin.cookie))
    ).invites;
    expect(list[0].status).toBe("used");
  });

  it("revokes invites and rejects already-members", async () => {
    const admin = await register();
    const other = await register();
    const bandId = await createBand(admin);
    const { invite } = await json(
      await api("POST", `/api/bands/${bandId}/invites`, { kind: "link", maxUses: 5 }, admin.cookie),
    );
    const rev = await api(
      "DELETE",
      `/api/bands/${bandId}/invites/${invite.id}`,
      undefined,
      admin.cookie,
    );
    expect(rev.status).toBe(200);
    const acc = await api("POST", "/api/invites/accept", { code: invite.code }, other.cookie);
    expect(acc.status).toBe(410);
    expect((await json(acc)).error.code).toBe("invite_revoked");

    const { invite: inv2 } = await json(
      await api("POST", `/api/bands/${bandId}/invites`, { kind: "code" }, admin.cookie),
    );
    const self = await api("POST", "/api/invites/accept", { code: inv2.code }, admin.cookie);
    expect(self.status).toBe(409);
    expect((await json(self)).error.code).toBe("already_member");
  });

  it("enforces admin-only actions on the backend and keeps at least one admin", async () => {
    const admin = await register();
    const member = await register();
    const bandId = await createBand(admin);
    const { invite } = await json(
      await api("POST", `/api/bands/${bandId}/invites`, { kind: "code" }, admin.cookie),
    );
    await api("POST", "/api/invites/accept", { code: invite.code }, member.cookie);

    expect(
      (await api("POST", `/api/bands/${bandId}/invites`, { kind: "code" }, member.cookie)).status,
    ).toBe(403);
    expect(
      (await api("PATCH", `/api/bands/${bandId}`, { name: "Hacked" }, member.cookie)).status,
    ).toBe(403);
    expect(
      (
        await api(
          "PATCH",
          `/api/bands/${bandId}/members/${member.userId}`,
          { permissions: { canControlRehearsal: false } },
          member.cookie,
        )
      ).status,
    ).toBe(403);

    // Admin revokes rehearsal control from the member.
    const upd = await api(
      "PATCH",
      `/api/bands/${bandId}/members/${member.userId}`,
      { permissions: { canControlRehearsal: false } },
      admin.cookie,
    );
    expect(upd.status).toBe(200);
    const asMember = (
      await json(await api("GET", `/api/bands/${bandId}`, undefined, member.cookie))
    ).band;
    expect(asMember.myPermissions.canControlRehearsal).toBe(false);
    // Member without control cannot create a rehearsal session.
    expect((await api("POST", `/api/bands/${bandId}/rehearsals`, {}, member.cookie)).status).toBe(
      403,
    );

    // The only admin cannot demote themself.
    const demote = await api(
      "PATCH",
      `/api/bands/${bandId}/members/${admin.userId}`,
      { role: "member" },
      admin.cookie,
    );
    expect(demote.status).toBe(409);
    // Member can leave on their own.
    expect(
      (
        await api(
          "DELETE",
          `/api/bands/${bandId}/members/${member.userId}`,
          undefined,
          member.cookie,
        )
      ).status,
    ).toBe(200);
  });
});

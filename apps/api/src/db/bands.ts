import type { BandDto, BandMemberDto, InviteDto, MemberPermissions } from "@bandsync/shared";
import { LIMITS } from "@bandsync/shared";
import type { Membership } from "../env";
import { newId, randomCode } from "../lib/ids";
import { addMs, HOUR_MS, nowIso } from "../lib/time";

interface MemberRow {
  band_id: string;
  user_id: string;
  role: "admin" | "member";
  instrument: string | null;
  can_edit_repertoire: number;
  can_manage_events: number;
  can_control_rehearsal: number;
  can_post_announcements: number;
  joined_at: string;
}

export function toMembership(row: MemberRow): Membership {
  return {
    bandId: row.band_id,
    userId: row.user_id,
    role: row.role,
    instrument: row.instrument,
    canEditRepertoire: row.role === "admin" || row.can_edit_repertoire === 1,
    canManageEvents: row.role === "admin" || row.can_manage_events === 1,
    canControlRehearsal: row.role === "admin" || row.can_control_rehearsal === 1,
    canPostAnnouncements: row.role === "admin" || row.can_post_announcements === 1,
    joinedAt: row.joined_at,
  };
}

export function permissionsOf(m: Membership): MemberPermissions {
  return {
    canEditRepertoire: m.canEditRepertoire,
    canManageEvents: m.canManageEvents,
    canControlRehearsal: m.canControlRehearsal,
    canPostAnnouncements: m.canPostAnnouncements,
  };
}

export async function getMembership(
  db: D1Database,
  bandId: string,
  userId: string,
): Promise<Membership | null> {
  const row = await db
    .prepare(
      `SELECT m.* FROM band_members m JOIN bands b ON b.id = m.band_id
       WHERE m.band_id = ? AND m.user_id = ? AND b.deleted_at IS NULL`,
    )
    .bind(bandId, userId)
    .first<MemberRow>();
  return row ? toMembership(row) : null;
}

interface BandRow {
  id: string;
  name: string;
  description: string | null;
  genre: string | null;
  image_url: string | null;
  created_at: string;
  member_count: number;
}

function toBandDto(row: BandRow, m: Membership): BandDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    genre: row.genre,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    myRole: m.role,
    myPermissions: permissionsOf(m),
    memberCount: row.member_count,
  };
}

export async function listBandsForUser(db: D1Database, userId: string): Promise<BandDto[]> {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.name, b.description, b.genre, b.image_url, b.created_at,
              (SELECT COUNT(*) FROM band_members c WHERE c.band_id = b.id) AS member_count,
              m.band_id, m.user_id, m.role, m.instrument, m.can_edit_repertoire, m.can_manage_events,
              m.can_control_rehearsal, m.can_post_announcements, m.joined_at
       FROM band_members m JOIN bands b ON b.id = m.band_id
       WHERE m.user_id = ? AND b.deleted_at IS NULL ORDER BY b.name COLLATE NOCASE`,
    )
    .bind(userId)
    .all<BandRow & MemberRow>();
  return results.map((r) => toBandDto(r, toMembership(r)));
}

export async function getBand(
  db: D1Database,
  bandId: string,
  m: Membership,
): Promise<BandDto | null> {
  const row = await db
    .prepare(
      `SELECT b.id, b.name, b.description, b.genre, b.image_url, b.created_at,
              (SELECT COUNT(*) FROM band_members c WHERE c.band_id = b.id) AS member_count
       FROM bands b WHERE b.id = ? AND b.deleted_at IS NULL`,
    )
    .bind(bandId)
    .first<BandRow>();
  return row ? toBandDto(row, m) : null;
}

export async function createBand(
  db: D1Database,
  userId: string,
  input: { name: string; description?: string; genre?: string },
  instrument: string | null,
): Promise<string> {
  const id = newId();
  const ts = nowIso();
  await db.batch([
    db
      .prepare(
        "INSERT INTO bands (id, name, description, genre, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(id, input.name, input.description ?? null, input.genre ?? null, userId, ts, ts),
    db
      .prepare(
        `INSERT INTO band_members (band_id, user_id, role, instrument, can_edit_repertoire, can_manage_events, can_control_rehearsal, can_post_announcements, joined_at)
         VALUES (?, ?, 'admin', ?, 1, 1, 1, 1, ?)`,
      )
      .bind(id, userId, instrument, ts),
  ]);
  return id;
}

export async function updateBand(
  db: D1Database,
  bandId: string,
  patch: { name?: string; description?: string; genre?: string; imageUrl?: string | null },
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    values.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    values.push(patch.description);
  }
  if (patch.genre !== undefined) {
    sets.push("genre = ?");
    values.push(patch.genre);
  }
  if (patch.imageUrl !== undefined) {
    sets.push("image_url = ?");
    values.push(patch.imageUrl);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  values.push(nowIso(), bandId);
  await db
    .prepare(`UPDATE bands SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function listMembers(db: D1Database, bandId: string): Promise<BandMemberDto[]> {
  const { results } = await db
    .prepare(
      `SELECT m.*, u.display_name, u.avatar_url FROM band_members m JOIN users u ON u.id = m.user_id
       WHERE m.band_id = ? ORDER BY m.role, u.display_name COLLATE NOCASE`,
    )
    .bind(bandId)
    .all<MemberRow & { display_name: string; avatar_url: string | null }>();
  return results.map((r) => {
    const m = toMembership(r);
    return {
      userId: r.user_id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      role: r.role,
      instrument: r.instrument,
      permissions: permissionsOf(m),
      joinedAt: r.joined_at,
    };
  });
}

export async function countAdmins(db: D1Database, bandId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM band_members WHERE band_id = ? AND role = 'admin'")
    .bind(bandId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function updateMember(
  db: D1Database,
  bandId: string,
  userId: string,
  patch: {
    role?: "admin" | "member";
    instrument?: string | null;
    permissions?: Partial<MemberPermissions>;
  },
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.role !== undefined) {
    sets.push("role = ?");
    values.push(patch.role);
  }
  if (patch.instrument !== undefined) {
    sets.push("instrument = ?");
    values.push(patch.instrument);
  }
  const p = patch.permissions ?? {};
  const map: [keyof MemberPermissions, string][] = [
    ["canEditRepertoire", "can_edit_repertoire"],
    ["canManageEvents", "can_manage_events"],
    ["canControlRehearsal", "can_control_rehearsal"],
    ["canPostAnnouncements", "can_post_announcements"],
  ];
  for (const [k, col] of map) {
    if (p[k] !== undefined) {
      sets.push(`${col} = ?`);
      values.push(p[k] ? 1 : 0);
    }
  }
  if (sets.length === 0) return;
  values.push(bandId, userId);
  await db
    .prepare(`UPDATE band_members SET ${sets.join(", ")} WHERE band_id = ? AND user_id = ?`)
    .bind(...values)
    .run();
}

export async function removeMember(db: D1Database, bandId: string, userId: string) {
  await db
    .prepare("DELETE FROM band_members WHERE band_id = ? AND user_id = ?")
    .bind(bandId, userId)
    .run();
}

export async function addMember(
  db: D1Database,
  bandId: string,
  userId: string,
  role: "admin" | "member",
  instrument: string | null,
) {
  await db
    .prepare(
      `INSERT INTO band_members (band_id, user_id, role, instrument, joined_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(band_id, user_id) DO NOTHING`,
    )
    .bind(bandId, userId, role, instrument, nowIso())
    .run();
}

/* ---------------- invitations ---------------- */

interface InviteRow {
  id: string;
  band_id: string;
  kind: string;
  code: string;
  email: string | null;
  role: "admin" | "member";
  instrument: string | null;
  locale: string | null;
  max_uses: number;
  uses: number;
  expires_at: string;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
}

export function inviteStatus(r: InviteRow): InviteDto["status"] {
  if (r.revoked_at) return "revoked";
  if (r.uses >= r.max_uses) return "used";
  if (new Date(r.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}

export function toInviteDto(r: InviteRow): InviteDto {
  return {
    id: r.id,
    kind: r.kind,
    code: r.code,
    email: r.email,
    role: r.role,
    instrument: r.instrument,
    status: inviteStatus(r),
    usesLeft: Math.max(0, r.max_uses - r.uses),
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

export async function createInvite(
  db: D1Database,
  bandId: string,
  createdBy: string,
  input: {
    kind: "code" | "link" | "email";
    email?: string;
    role: "admin" | "member";
    instrument?: string;
    expiresInHours: number;
    maxUses: number;
    locale?: string;
  },
): Promise<InviteRow> {
  const id = newId();
  const code = input.kind === "code" ? randomCode(LIMITS.inviteCodeLength) : randomCode(24);
  const row: InviteRow = {
    id,
    band_id: bandId,
    kind: input.kind,
    code,
    email: input.email ?? null,
    role: input.role,
    instrument: input.instrument ?? null,
    locale: input.locale ?? null,
    max_uses: input.maxUses,
    uses: 0,
    expires_at: addMs(input.expiresInHours * HOUR_MS),
    revoked_at: null,
    created_by: createdBy,
    created_at: nowIso(),
  };
  await db
    .prepare(
      `INSERT INTO band_invitations (id, band_id, kind, code, email, role, instrument, locale, max_uses, uses, expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.band_id,
      row.kind,
      row.code,
      row.email,
      row.role,
      row.instrument,
      row.locale,
      row.max_uses,
      row.expires_at,
      row.created_by,
      row.created_at,
    )
    .run();
  return row;
}

export async function listInvites(db: D1Database, bandId: string): Promise<InviteDto[]> {
  const { results } = await db
    .prepare("SELECT * FROM band_invitations WHERE band_id = ? ORDER BY created_at DESC LIMIT 100")
    .bind(bandId)
    .all<InviteRow>();
  return results.map(toInviteDto);
}

export async function findInviteByCode(db: D1Database, code: string) {
  return db
    .prepare(
      `SELECT i.*, b.name AS band_name, b.image_url AS band_image_url, u.display_name AS inviter_name
       FROM band_invitations i JOIN bands b ON b.id = i.band_id JOIN users u ON u.id = i.created_by
       WHERE i.code = ? AND b.deleted_at IS NULL`,
    )
    .bind(code.toUpperCase() === code ? code : code)
    .first<
      InviteRow & { band_name: string; band_image_url: string | null; inviter_name: string }
    >();
}

export async function revokeInvite(db: D1Database, bandId: string, inviteId: string) {
  const res = await db
    .prepare(
      "UPDATE band_invitations SET revoked_at = ? WHERE id = ? AND band_id = ? AND revoked_at IS NULL",
    )
    .bind(nowIso(), inviteId, bandId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function consumeInvite(db: D1Database, inviteId: string) {
  await db.prepare("UPDATE band_invitations SET uses = uses + 1 WHERE id = ?").bind(inviteId).run();
}

import type {
  CreatePersonalInviteInput,
  PersonalInviteDto,
  PersonalInvitePreviewDto,
  PersonalInviteStatus,
} from "@bandsync/shared";
import { newId, randomToken, sha256Hex } from "../lib/ids";
import { addMs, HOUR_MS, nowIso } from "../lib/time";

/**
 * Personal invitations: one private link per musician.
 *
 * The link carries a random 256-bit token. Only its SHA-256 is stored (in `code`, prefixed), so
 * reading the database does not give working links, and the token is shown once, on creation.
 * An invitation is used once, expires, can be revoked, and names the person it is for; nothing
 * about that person exists as an account until they accept and create (or use) their own.
 */
const PREFIX = "pi_";
export const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

export const hashToken = async (token: string) => `${PREFIX}${await sha256Hex(token)}`;

export interface PersonalInviteRow {
  id: string;
  band_id: string;
  code: string;
  role: "admin" | "member";
  instrument: string | null;
  secondary_instruments: string | null;
  invitee_name: string;
  grants_ownership: number;
  max_uses: number;
  uses: number;
  expires_at: string;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
}

function secondary(row: PersonalInviteRow): string[] {
  try {
    const v = JSON.parse(row.secondary_instruments ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function personalStatus(r: PersonalInviteRow): PersonalInviteStatus {
  if (r.revoked_at) return "revoked";
  if (r.uses >= r.max_uses) return "used";
  if (new Date(r.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}

export function toPersonalInviteDto(
  r: PersonalInviteRow & { accepted_by_name?: string | null },
): PersonalInviteDto {
  return {
    id: r.id,
    inviteeName: r.invitee_name,
    instrument: r.instrument,
    secondaryInstruments: secondary(r),
    role: r.role,
    status: personalStatus(r),
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    acceptedAt: r.accepted_at,
    acceptedByName: r.accepted_by_name ?? null,
  };
}

export function toPreview(
  r: PersonalInviteRow & { band_name: string; band_image_url: string | null },
): PersonalInvitePreviewDto {
  return {
    status: personalStatus(r),
    inviteeName: r.invitee_name,
    instrument: r.instrument,
    secondaryInstruments: secondary(r),
    role: r.role,
    band: { id: r.band_id, name: r.band_name, imageUrl: r.band_image_url },
    expiresAt: r.expires_at,
  };
}

export async function createPersonalInvite(
  db: D1Database,
  bandId: string,
  createdBy: string,
  input: CreatePersonalInviteInput,
): Promise<{ row: PersonalInviteRow; token: string }> {
  const token = randomToken(32);
  const row: PersonalInviteRow = {
    id: newId(),
    band_id: bandId,
    code: await hashToken(token),
    role: input.role,
    instrument: input.instrument ?? null,
    secondary_instruments: JSON.stringify(input.secondaryInstruments ?? []),
    invitee_name: input.inviteeName,
    grants_ownership: 0,
    max_uses: 1,
    uses: 0,
    expires_at: addMs(input.expiresInHours * HOUR_MS),
    revoked_at: null,
    created_by: createdBy,
    created_at: nowIso(),
    accepted_by: null,
    accepted_at: null,
  };
  await db
    .prepare(
      `INSERT INTO band_invitations (id, band_id, kind, code, role, instrument, secondary_instruments, invitee_name,
         max_uses, uses, expires_at, created_by, created_at)
       VALUES (?, ?, 'link', ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.band_id,
      row.code,
      row.role,
      row.instrument,
      row.secondary_instruments,
      row.invitee_name,
      row.expires_at,
      row.created_by,
      row.created_at,
    )
    .run();
  return { row, token };
}

export async function listPersonalInvites(
  db: D1Database,
  bandId: string,
): Promise<PersonalInviteDto[]> {
  const { results } = await db
    .prepare(
      `SELECT i.*, u.display_name AS accepted_by_name FROM band_invitations i
       LEFT JOIN users u ON u.id = i.accepted_by
       WHERE i.band_id = ? AND i.invitee_name IS NOT NULL ORDER BY i.created_at DESC LIMIT 100`,
    )
    .bind(bandId)
    .all<PersonalInviteRow & { accepted_by_name: string | null }>();
  return results.map(toPersonalInviteDto);
}

export async function findPersonalInvite(db: D1Database, token: string) {
  if (!TOKEN_RE.test(token)) return null;
  return db
    .prepare(
      `SELECT i.*, b.name AS band_name, b.image_url AS band_image_url
       FROM band_invitations i JOIN bands b ON b.id = i.band_id
       WHERE i.code = ? AND i.invitee_name IS NOT NULL AND b.deleted_at IS NULL`,
    )
    .bind(await hashToken(token))
    .first<PersonalInviteRow & { band_name: string; band_image_url: string | null }>();
}

export async function revokePersonalInvite(db: D1Database, bandId: string, inviteId: string) {
  const res = await db
    .prepare(
      `UPDATE band_invitations SET revoked_at = ? WHERE id = ? AND band_id = ? AND revoked_at IS NULL
       AND invitee_name IS NOT NULL`,
    )
    .bind(nowIso(), inviteId, bandId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * Takes the invitation for `userId`. The single UPDATE is the lock: of two people opening the
 * same link at once, only one changes the row.
 */
export async function claimPersonalInvite(
  db: D1Database,
  inviteId: string,
  userId: string,
): Promise<boolean> {
  const now = nowIso();
  const res = await db
    .prepare(
      `UPDATE band_invitations SET uses = uses + 1, accepted_by = ?, accepted_at = ?
       WHERE id = ? AND uses < max_uses AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(userId, now, inviteId, now)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Puts the claim back when joining failed after it, so the link is not burnt for nothing. */
export async function releasePersonalInvite(db: D1Database, inviteId: string, userId: string) {
  await db
    .prepare(
      `UPDATE band_invitations SET uses = uses - 1, accepted_by = NULL, accepted_at = NULL
       WHERE id = ? AND accepted_by = ? AND uses > 0`,
    )
    .bind(inviteId, userId)
    .run();
}

/**
 * The band was set up on behalf of someone without an account: whoever accepts this invitation
 * becomes its owner, and what the set-up created in the band is recorded as theirs.
 */
export async function transferOwnership(
  db: D1Database,
  bandId: string,
  fromUserId: string,
  toUserId: string,
) {
  const now = nowIso();
  await db.batch([
    db
      .prepare("UPDATE bands SET created_by = ?, updated_at = ? WHERE id = ? AND created_by = ?")
      .bind(toUserId, now, bandId, fromUserId),
    db
      .prepare("UPDATE rehearsal_schedules SET created_by = ? WHERE band_id = ? AND created_by = ?")
      .bind(toUserId, bandId, fromUserId),
    db
      .prepare("UPDATE events SET created_by = ? WHERE band_id = ? AND created_by = ?")
      .bind(toUserId, bandId, fromUserId),
    db
      .prepare("UPDATE songs SET created_by = ? WHERE band_id = ? AND created_by = ?")
      .bind(toUserId, bandId, fromUserId),
    db
      .prepare("UPDATE repertoires SET created_by = ? WHERE band_id = ? AND created_by = ?")
      .bind(toUserId, bandId, fromUserId),
    db
      .prepare(
        `UPDATE band_members SET can_edit_repertoire = 1, can_manage_events = 1, can_control_rehearsal = 1,
           can_post_announcements = 1 WHERE band_id = ? AND user_id = ?`,
      )
      .bind(bandId, toUserId),
  ]);
}

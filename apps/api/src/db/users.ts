import type { UserDto, UserPreferencesDto } from "@bandsync/shared";
import type { AuthUser } from "../env";
import { newId, randomToken, sha256Hex } from "../lib/ids";
import { addMs, DAY_MS, nowIso } from "../lib/time";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  avatar_url: string | null;
  primary_instrument: string | null;
  secondary_instruments: string;
  created_at: string;
  locale: string | null;
}

function parseJsonArray(text: string | null): string[] {
  try {
    const v = JSON.parse(text ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    primaryInstrument: row.primary_instrument,
    secondaryInstruments: parseJsonArray(row.secondary_instruments),
    locale: row.locale ?? "en",
    createdAt: row.created_at,
  };
}

export function toUserDto(u: AuthUser): UserDto {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    primaryInstrument: u.primaryInstrument,
    secondaryInstruments: u.secondaryInstruments,
    createdAt: u.createdAt,
  };
}

const USER_SELECT = `SELECT u.id, u.email, u.password_hash, u.display_name, u.avatar_url, u.primary_instrument,
  u.secondary_instruments, u.created_at, p.locale FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id`;

export async function findUserByEmail(db: D1Database, email: string) {
  return db
    .prepare(`${USER_SELECT} WHERE u.email = ? AND u.deleted_at IS NULL`)
    .bind(email)
    .first<UserRow>();
}

export async function findUserById(db: D1Database, id: string) {
  return db
    .prepare(`${USER_SELECT} WHERE u.id = ? AND u.deleted_at IS NULL`)
    .bind(id)
    .first<UserRow>();
}

export async function createUser(
  db: D1Database,
  input: {
    email: string;
    passwordHash: string;
    displayName: string;
    primaryInstrument?: string | null;
    locale?: string;
  },
): Promise<AuthUser> {
  const id = newId();
  const ts = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, email, password_hash, display_name, primary_instrument, secondary_instruments, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
      )
      .bind(
        id,
        input.email,
        input.passwordHash,
        input.displayName,
        input.primaryInstrument ?? null,
        ts,
        ts,
      ),
    db
      .prepare("INSERT INTO user_preferences (user_id, locale, updated_at) VALUES (?, ?, ?)")
      .bind(id, input.locale ?? "en", ts),
  ]);
  return {
    id,
    email: input.email,
    displayName: input.displayName,
    avatarUrl: null,
    primaryInstrument: input.primaryInstrument ?? null,
    secondaryInstruments: [],
    locale: input.locale ?? "en",
    createdAt: ts,
  };
}

export async function updateUserProfile(
  db: D1Database,
  userId: string,
  patch: {
    displayName?: string;
    primaryInstrument?: string | null;
    secondaryInstruments?: string[];
    avatarUrl?: string | null;
  },
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.displayName !== undefined) {
    sets.push("display_name = ?");
    values.push(patch.displayName);
  }
  if (patch.primaryInstrument !== undefined) {
    sets.push("primary_instrument = ?");
    values.push(patch.primaryInstrument);
  }
  if (patch.secondaryInstruments !== undefined) {
    sets.push("secondary_instruments = ?");
    values.push(JSON.stringify(patch.secondaryInstruments));
  }
  if (patch.avatarUrl !== undefined) {
    sets.push("avatar_url = ?");
    values.push(patch.avatarUrl);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  values.push(nowIso(), userId);
  await db
    .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function updatePasswordHash(db: D1Database, userId: string, passwordHash: string) {
  await db
    .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .bind(passwordHash, nowIso(), userId)
    .run();
}

/* ---------------- preferences ---------------- */

interface PrefRow {
  locale: string;
  theme: string;
  notation: string;
  material_preferences: string;
  click_sound: string;
  click_volume: number;
  time_zone: string | null;
}

export async function getPreferences(db: D1Database, userId: string): Promise<UserPreferencesDto> {
  const row = await db
    .prepare("SELECT * FROM user_preferences WHERE user_id = ?")
    .bind(userId)
    .first<PrefRow>();
  if (!row) {
    return {
      locale: "en",
      theme: "system",
      notation: "english",
      materialPreferences: {},
      clickSound: "beep",
      clickVolume: 0.8,
      timeZone: null,
    };
  }
  let prefs: Record<string, string[]> = {};
  try {
    prefs = JSON.parse(row.material_preferences);
  } catch {
    prefs = {};
  }
  return {
    locale: row.locale,
    theme: row.theme,
    notation: row.notation,
    materialPreferences: prefs,
    clickSound: row.click_sound,
    clickVolume: row.click_volume,
    timeZone: row.time_zone,
  };
}

export async function updatePreferences(
  db: D1Database,
  userId: string,
  patch: {
    locale?: string;
    theme?: string;
    notation?: string;
    materialPreferences?: Record<string, string[]>;
    clickSound?: string;
    clickVolume?: number;
    timeZone?: string;
  },
) {
  const current = await getPreferences(db, userId);
  const merged = {
    locale: patch.locale ?? current.locale,
    theme: patch.theme ?? current.theme,
    notation: patch.notation ?? current.notation,
    materialPreferences: patch.materialPreferences
      ? { ...current.materialPreferences, ...patch.materialPreferences }
      : current.materialPreferences,
    clickSound: patch.clickSound ?? current.clickSound,
    clickVolume: patch.clickVolume ?? current.clickVolume,
    timeZone: patch.timeZone ?? current.timeZone,
  };
  await db
    .prepare(
      `INSERT INTO user_preferences (user_id, locale, theme, notation, material_preferences, click_sound, click_volume, time_zone, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET locale = excluded.locale, theme = excluded.theme, notation = excluded.notation,
         material_preferences = excluded.material_preferences, click_sound = excluded.click_sound,
         click_volume = excluded.click_volume, time_zone = excluded.time_zone, updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      merged.locale,
      merged.theme,
      merged.notation,
      JSON.stringify(merged.materialPreferences),
      merged.clickSound,
      merged.clickVolume,
      merged.timeZone,
      nowIso(),
    )
    .run();
  return merged;
}

/* ---------------- auth sessions ---------------- */

export async function createAuthSession(
  db: D1Database,
  userId: string,
  meta: { userAgent: string | null; ip: string | null },
  ttlDays: number,
): Promise<{ token: string; id: string; expiresAt: string }> {
  const token = randomToken(32);
  const id = newId();
  const ts = nowIso();
  const expiresAt = addMs(ttlDays * DAY_MS);
  await db
    .prepare(
      `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, last_used_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, await sha256Hex(token), ts, expiresAt, ts, meta.userAgent, meta.ip)
    .run();
  return { token, id, expiresAt };
}

export async function findAuthSession(db: D1Database, token: string) {
  const hash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.id as session_id, s.expires_at, s.last_used_at, u.id, u.email, u.password_hash, u.display_name, u.avatar_url,
              u.primary_instrument, u.secondary_instruments, u.created_at, p.locale
       FROM auth_sessions s JOIN users u ON u.id = s.user_id LEFT JOIN user_preferences p ON p.user_id = u.id
       WHERE s.token_hash = ? AND u.deleted_at IS NULL`,
    )
    .bind(hash)
    .first<UserRow & { session_id: string; expires_at: string; last_used_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.prepare("DELETE FROM auth_sessions WHERE id = ?").bind(row.session_id).run();
    return null;
  }
  // Touch at most once per 10 minutes to save writes.
  if (Date.now() - new Date(row.last_used_at).getTime() > 10 * 60 * 1000) {
    await db
      .prepare("UPDATE auth_sessions SET last_used_at = ? WHERE id = ?")
      .bind(nowIso(), row.session_id)
      .run();
  }
  return { sessionId: row.session_id, user: toAuthUser(row) };
}

export async function deleteAuthSession(db: D1Database, sessionId: string) {
  await db.prepare("DELETE FROM auth_sessions WHERE id = ?").bind(sessionId).run();
}

export async function deleteAllUserSessions(db: D1Database, userId: string) {
  await db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId).run();
}

/* ---------------- password reset ---------------- */

export async function createPasswordReset(db: D1Database, userId: string): Promise<string> {
  const token = randomToken(32);
  await db
    .prepare(
      "INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(newId(), userId, await sha256Hex(token), addMs(60 * 60 * 1000), nowIso())
    .run();
  return token;
}

export async function consumePasswordReset(db: D1Database, token: string): Promise<string | null> {
  const hash = await sha256Hex(token);
  const row = await db
    .prepare("SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?")
    .bind(hash)
    .first<{ id: string; user_id: string; expires_at: string; used_at: string | null }>();
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) return null;
  await db
    .prepare("UPDATE password_resets SET used_at = ? WHERE id = ?")
    .bind(nowIso(), row.id)
    .run();
  return row.user_id;
}

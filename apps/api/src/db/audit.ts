import { nowIso } from "../lib/time";

export async function audit(
  db: D1Database,
  entry: {
    bandId: string | null;
    actorUserId: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await db
    .prepare(
      "INSERT INTO audit_logs (band_id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      entry.bandId,
      entry.actorUserId,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      nowIso(),
    )
    .run();
}

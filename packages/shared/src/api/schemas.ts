import { z } from "zod";
import {
  BAND_ROLES,
  INSTRUMENTS,
  LIMITS,
  LOCALES,
  MATERIAL_TYPES,
  NOTATIONS,
  REPERTOIRE_KINDS,
  THEMES,
} from "../constants";

/* ------------------------------------------------------------------ */
/* Error codes: stable, language-independent                           */
/* ------------------------------------------------------------------ */
export const API_ERROR_CODES = [
  "validation_error",
  "unauthorized",
  "forbidden",
  "not_found",
  "email_in_use",
  "invalid_credentials",
  "invite_invalid",
  "invite_expired",
  "invite_revoked",
  "invite_used",
  "already_member",
  "rate_limited",
  "conflict",
  "payload_too_large",
  "unsupported_media",
  "internal_error",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message?: string; details?: unknown };
}

/* ------------------------------------------------------------------ */
/* Common                                                              */
/* ------------------------------------------------------------------ */
export const idSchema = z.string().min(8).max(64);
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax);
export const displayNameSchema = z.string().trim().min(1).max(LIMITS.displayNameMax);
export const localeSchema = z.enum(LOCALES);
export const instrumentSchema = z.enum(INSTRUMENTS);
export const materialTypeSchema = z.enum(MATERIAL_TYPES);
export const notationSchema = z.enum(NOTATIONS);
export const themeSchema = z.enum(THEMES);
export const roleSchema = z.enum(BAND_ROLES);

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  locale: localeSchema.optional(),
  primaryInstrument: instrumentSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(256),
  password: passwordSchema,
});

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  primaryInstrument: instrumentSchema.nullable().optional(),
  secondaryInstruments: z.array(instrumentSchema).max(8).optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
});

export const updatePreferencesSchema = z.object({
  locale: localeSchema.optional(),
  theme: themeSchema.optional(),
  notation: notationSchema.optional(),
  /** Preferred material types per instrument, most preferred first. */
  materialPreferences: z
    .partialRecord(instrumentSchema, z.array(materialTypeSchema).max(6))
    .optional(),
  clickSound: z.enum(["beep", "wood", "tick"]).optional(),
  clickVolume: z.number().min(0).max(1).optional(),
  timeZone: z.string().max(80).optional(),
});
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  primaryInstrument: string | null;
  secondaryInstruments: string[];
  createdAt: string;
}

export interface UserPreferencesDto {
  locale: string;
  theme: string;
  notation: string;
  materialPreferences: Record<string, string[]>;
  clickSound: string;
  clickVolume: number;
  timeZone: string | null;
}

/* ------------------------------------------------------------------ */
/* Bands                                                               */
/* ------------------------------------------------------------------ */
export const createBandSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.bandNameMax),
  description: z.string().trim().max(1000).optional(),
  genre: z.string().trim().max(80).optional(),
});
export const updateBandSchema = createBandSchema.partial().extend({
  imageUrl: z.string().url().max(500).nullable().optional(),
});

export const memberPermissionsSchema = z.object({
  canEditRepertoire: z.boolean(),
  canManageEvents: z.boolean(),
  canControlRehearsal: z.boolean(),
  canPostAnnouncements: z.boolean(),
});
export type MemberPermissions = z.infer<typeof memberPermissionsSchema>;

export const updateMemberSchema = z.object({
  role: roleSchema.optional(),
  instrument: instrumentSchema.nullable().optional(),
  permissions: memberPermissionsSchema.partial().optional(),
});

export const createInviteSchema = z.object({
  kind: z.enum(["code", "link", "email"]),
  email: emailSchema.optional(),
  role: roleSchema.default("member"),
  instrument: instrumentSchema.optional(),
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(LIMITS.inviteDefaultTtlHours),
  maxUses: z.number().int().min(1).max(100).default(1),
  locale: localeSchema.optional(),
});

export const acceptInviteSchema = z.object({ code: z.string().trim().min(6).max(64) });

export interface BandDto {
  id: string;
  name: string;
  description: string | null;
  genre: string | null;
  imageUrl: string | null;
  createdAt: string;
  myRole: string;
  myPermissions: MemberPermissions;
  memberCount: number;
}

export interface BandMemberDto {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  instrument: string | null;
  permissions: MemberPermissions;
  joinedAt: string;
}

export interface InviteDto {
  id: string;
  kind: string;
  code: string;
  email: string | null;
  role: string;
  instrument: string | null;
  status: "active" | "revoked" | "expired" | "used";
  usesLeft: number;
  expiresAt: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Songs                                                               */
/* ------------------------------------------------------------------ */
const bpmSchema = z.number().min(LIMITS.bpmMin).max(LIMITS.bpmMax);

export const songSectionSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(60),
  bars: z.number().int().min(0).max(999),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const createSongSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.songTitleMax),
  artist: z.string().trim().max(160).optional().nullable(),
  album: z.string().trim().max(160).optional().nullable(),
  externalId: z.string().trim().max(120).optional().nullable(),
  durationSeconds: z.number().int().min(0).max(36000).optional().nullable(),
  originalBpm: bpmSchema.optional().nullable(),
  originalKey: z.string().trim().max(12).optional().nullable(),
  version: z
    .object({
      bpm: bpmSchema.optional().nullable(),
      key: z.string().trim().max(12).optional().nullable(),
      beatsPerBar: z.number().int().min(1).max(32).default(4),
      beatUnit: z
        .number()
        .int()
        .refine((n) => [1, 2, 4, 8, 16].includes(n))
        .default(4),
      notes: z.string().trim().max(2000).optional().nullable(),
      referenceUrl: z.string().url().max(500).optional().nullable(),
    })
    .default({ beatsPerBar: 4, beatUnit: 4 }),
  sections: z.array(songSectionSchema).max(60).optional(),
});
export const updateSongSchema = createSongSchema.partial();

export const createMaterialSchema = z.object({
  type: materialTypeSchema,
  title: z.string().trim().min(1).max(120),
  instrument: instrumentSchema.nullable().optional(),
  body: z.string().max(LIMITS.materialBodyMax).optional().nullable(),
  externalUrl: z.string().url().max(500).optional().nullable(),
  fileId: idSchema.optional().nullable(),
  key: z.string().trim().max(12).optional().nullable(),
});
export const updateMaterialSchema = createMaterialSchema.partial();

export interface SongSectionDto {
  id: string;
  name: string;
  position: number;
  bars: number;
  notes: string | null;
}

export interface SongMaterialDto {
  id: string;
  songId: string;
  versionId: string;
  type: string;
  title: string;
  instrument: string | null;
  body: string | null;
  externalUrl: string | null;
  fileId: string | null;
  fileUrl: string | null;
  key: string | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SongDto {
  id: string;
  bandId: string;
  title: string;
  artist: string | null;
  album: string | null;
  externalId: string | null;
  durationSeconds: number | null;
  originalBpm: number | null;
  originalKey: string | null;
  version: {
    id: string;
    bpm: number | null;
    key: string | null;
    beatsPerBar: number;
    beatUnit: number;
    notes: string | null;
    referenceUrl: string | null;
  };
  sections: SongSectionDto[];
  materialSummary: { type: string; instrument: string | null; count: number }[];
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Repertoires                                                         */
/* ------------------------------------------------------------------ */
export const createRepertoireSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(REPERTOIRE_KINDS).default("custom"),
  description: z.string().trim().max(500).optional().nullable(),
});
export const updateRepertoireSchema = createRepertoireSchema.partial();
export const addRepertoireItemSchema = z.object({
  songId: idSchema,
  position: z.number().int().min(0).optional(),
  notes: z.string().trim().max(300).optional().nullable(),
});
export const reorderRepertoireSchema = z.object({ songIds: z.array(idSchema).max(500) });

export interface RepertoireItemDto {
  id: string;
  songId: string;
  position: number;
  notes: string | null;
  song: Pick<SongDto, "id" | "title" | "artist"> & { bpm: number | null; key: string | null };
}

export interface RepertoireDto {
  id: string;
  bandId: string;
  name: string;
  kind: string;
  description: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  items?: RepertoireItemDto[];
}

/* ------------------------------------------------------------------ */
/* Rehearsal sessions                                                  */
/* ------------------------------------------------------------------ */
export const createRehearsalSchema = z.object({
  repertoireId: idSchema.optional().nullable(),
  title: z.string().trim().max(120).optional().nullable(),
});

export interface RehearsalSessionDto {
  id: string;
  bandId: string;
  title: string | null;
  status: string;
  repertoireId: string | null;
  createdBy: string;
  createdAt: string;
  endedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */
export const ALLOWED_UPLOAD_TYPES = [
  "application/pdf",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface FileDto {
  id: string;
  bandId: string;
  name: string;
  contentType: string;
  size: number;
  createdBy: string;
  createdAt: string;
  url: string;
}

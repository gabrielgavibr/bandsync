export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  REHEARSAL: DurableObjectNamespace;
  /** Serialises and caches every MusicBrainz request (1 request/second). */
  MB_GATEWAY: DurableObjectNamespace;
  /** Drives one AutoArrange preparation job, one step per alarm. */
  PREPARE_JOB: DurableObjectNamespace;
  ASSETS?: Fetcher;
  APP_ENV: "development" | "test" | "production" | string;
  APP_URL: string;
  PBKDF2_ITERATIONS?: string;
  /** Secret. When set, every request needs the staging access cookie (see middleware/stagingGate). */
  STAGING_ACCESS_KEY?: string;
  /** Overrides for tests and local stubs; production uses the public endpoints. */
  MUSICBRAINZ_BASE_URL?: string;
  MUSICBRAINZ_MIN_INTERVAL_MS?: string;
  /** Contact shown in the User-Agent sent to MusicBrainz, as their API rules require. */
  MUSICBRAINZ_CONTACT?: string;
  YOUTUBE_OEMBED_BASE?: string;
  SPOTIFY_OEMBED_BASE?: string;
  /** "on" (default) or "off". Only turn off for local development. */
  RATE_LIMITS?: string;
  MAIL_PROVIDER?: string;
  MAIL_API_KEY?: string;
  MAIL_FROM?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  primaryInstrument: string | null;
  secondaryInstruments: string[];
  locale: string;
  createdAt: string;
}

export interface Membership {
  bandId: string;
  userId: string;
  role: "admin" | "member";
  instrument: string | null;
  canEditRepertoire: boolean;
  canManageEvents: boolean;
  canControlRehearsal: boolean;
  canPostAnnouncements: boolean;
  joinedAt: string;
}

export type AppVariables = {
  user: AuthUser;
  sessionId: string;
  membership: Membership;
  requestId: string;
};

export type AppEnv = { Bindings: Env; Variables: AppVariables };

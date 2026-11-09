export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  REHEARSAL: DurableObjectNamespace;
  ASSETS?: Fetcher;
  APP_ENV: "development" | "test" | "production" | string;
  APP_URL: string;
  PBKDF2_ITERATIONS?: string;
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

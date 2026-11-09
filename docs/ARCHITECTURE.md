# BandSync — Architecture

## Monorepo layout

```
bandsync/
  package.json              pnpm workspace root (scripts, Biome, TypeScript)
  pnpm-workspace.yaml       apps/*, packages/*, e2e
  tsconfig.base.json        strict TS defaults shared by every package
  biome.json                lint + format
  apps/
    api/                    @bandsync/api — Cloudflare Worker
      src/index.ts          Hono app, middleware, route mounting, error handler
      src/env.ts            Env bindings, AuthUser, Membership, Hono variables
      src/lib/              errors, ids, password (PBKDF2), cookies, ratelimit, logger, mailer, validate, params, time
      src/db/               one module per aggregate: users, bands, songs, repertoires, rehearsals, files, audit
      src/middleware/auth.ts requireAuth, requireMembership, requirePermission, requireAdmin, requireRepertoireEditor
      src/routes/           auth, me, bands (+invites), songs (+materials), repertoires, rehearsals (+ws), files
      src/durable/RehearsalSessionDO.ts  live session authority
      migrations/0001_init.sql
      seed/demo.sql         fictional demo data (local only)
      test/                 Worker integration tests (@cloudflare/vitest-plugin)
      wrangler.jsonc
    web/                    @bandsync/web — React 19 + Vite 8 + Tailwind 4 PWA
      src/app/              App, routes, AppShell, Brand, NotFoundPage
      src/lib/              api client, i18n, format, theme, cn, materials, audio/, realtime/
      src/components/ui/    Button, Field, Card, Badge, Dialog, Toast, Misc (PageHeader, EmptyState, Segmented, Toggle…)
      src/features/         auth, bands, repertoire, rehearsal, tools, profile
      src/locales/{en,pt-BR}/*.json
      test/                 Vitest + Testing Library (jsdom)
  packages/
    shared/                 @bandsync/shared — framework-free domain code
      src/constants.ts      instruments, material types, roles, locales, limits
      src/music/            notes/keys, chord parsing/transposition, time signatures
      src/sync/             ClockEstimator, metronome timeline math
      src/protocol/         realtime message schemas, SessionState, deriveStatus
      src/api/schemas.ts    Zod schemas + DTO types + stable error codes
  e2e/                      Playwright (@playwright/test 1.63, two browser contexts)
  docs/
```

`@bandsync/shared` is consumed as TypeScript source (`main: src/index.ts`) by both the Worker (bundled by wrangler/esbuild) and the web app (Vite). There is no build step for it.

## Stack and why

| Layer           | Choice                                                                   | Why                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend runtime | Cloudflare Workers                                                       | Edge latency for the realtime session, zero servers to run, free tier covers a band                                                                 |
| HTTP framework  | Hono 4                                                                   | Tiny, typed, first-class Workers support, middleware model matches our auth/permission chain                                                        |
| Database        | Cloudflare D1 (SQLite)                                                   | Relational model fits bands/songs/materials; migrations are plain SQL; runs locally in workerd                                                      |
| Files           | Cloudflare R2                                                            | Private object storage; every download goes through a membership check in the Worker, no public URLs                                                |
| Live sessions   | Durable Objects with Hibernatable WebSockets                             | One object per session is a natural single authority: serialised command handling, in-memory state with durable storage, idle sessions cost nothing |
| Frontend        | React 19, Vite 8, TypeScript                                             | Mainstream, fast dev loop, PWA plugin available                                                                                                     |
| Styling         | Tailwind CSS 4 with CSS variables                                        | Dark/light themes via tokens, consistent spacing, no component-library lock-in                                                                      |
| Data fetching   | TanStack Query 5                                                         | Caching, invalidation and loading/error states for REST; realtime state bypasses it                                                                 |
| i18n            | i18next + react-i18next                                                  | Namespaces, plurals, interpolation, missing-key handler, language change without reload                                                             |
| Validation      | Zod 4 (shared)                                                           | Same schemas validate requests in the Worker and types the client                                                                                   |
| Lint/format     | Biome 2                                                                  | Single fast tool for TS/JSON                                                                                                                        |
| Tests           | Vitest 4; `@cloudflare/vitest-plugin` for the Worker; Playwright for e2e | Worker tests run inside workerd with real D1/DO/R2 bindings and isolated storage per test                                                           |

### Alternatives considered

- **Drizzle ORM**: skipped to avoid a second migration system; D1 prepared statements with typed row interfaces are explicit and small.
- **Separate API origin**: rejected. The Worker serves the SPA through the `assets` binding (`run_worker_first: ["/api/*"]`), so cookies are first-party and no CORS is needed. In development Vite proxies `/api` (with WebSocket upgrade) to wrangler.
- **Durable Object RPC**: the Worker talks to the DO over `fetch` (`/init`, `/state`, `/ws`) so the WebSocket upgrade response can be passed straight through.

## Request flow

```
Browser ──HTTP/WS──▶ Worker (Hono)
   │                   ├─ request id + structured log
   │                   ├─ Origin check on state-changing methods
   │                   ├─ requireAuth (cookie → auth_sessions → user)
   │                   ├─ requireMembership(:bandId) → Membership
   │                   ├─ requirePermission(...)
   │                   └─ route handler → src/db/* → D1 / R2
   │
   └─ /api/bands/:bandId/rehearsals/:id/ws
                       Worker authenticates, then forwards the upgrade to
                       RehearsalSessionDO (idFromName(sessionId)) with x-bs-* identity headers.
                       The DO accepts the socket (hibernation API) and owns the session state.
```

Everything under `/api` returns JSON. Non-API paths fall through to the static assets binding with SPA fallback.

## Authentication

- **Password hashing**: PBKDF2-SHA256 through Web Crypto (the only KDF natively available in Workers). Iterations come from `PBKDF2_ITERATIONS` (default 100 000) and are embedded in the stored string `pbkdf2$sha256$<iter>$<salt>$<hash>`, so the cost can be raised later without breaking existing logins. Constant-time comparison. Unknown e-mails are verified against a dummy hash so timing does not reveal account existence.
- **Sessions**: opaque 32-byte random token; only its SHA-256 is stored in `auth_sessions` with expiry (30 days), user agent and IP. Delivered as `bs_session` cookie: `HttpOnly; SameSite=Lax; Path=/; Secure` on HTTPS. `last_used_at` is touched at most every 10 minutes.
- **CSRF**: SameSite=Lax plus an `Origin` check on every non-GET `/api` request (must equal the request origin or `APP_URL`).
- **Password reset**: single-use hashed token, 1 h expiry; all sessions of the user are deleted on reset. The response to "forgot password" is identical whether or not the e-mail exists. Without a mail provider the link is logged, and returned in the response only when `APP_ENV !== production`.
- **Rate limiting**: fixed-window counters in the `rate_limits` D1 table keyed by route + client IP (`cf-connecting-ip`, falling back to `x-forwarded-for`). Limits: register 30/h, login 20/15 min, forgot 5/h, reset 10/h, invite lookup 30/10 min, invite accept 20/10 min, invite creation 30/h per band. Under `APP_ENV=test` the limiter is skipped unless the request sends `x-test-ratelimit: 1`.

## Permission model

- A user has a `band_members` row per band with `role` (`admin` | `member`) and four flags: `can_edit_repertoire`, `can_manage_events`, `can_control_rehearsal`, `can_post_announcements`. Admins implicitly have every flag.
- Defaults for a new member: edit repertoire ✓, manage events ✗, control rehearsal ✓, post announcements ✓. The band creator is admin with everything.
- Enforcement happens in middleware on the Worker (`requireMembership`, `requireAdmin`, `requireRepertoireEditor`, explicit checks in rehearsal routes) and inside the Durable Object for live commands (`canControl`, `isAdmin` forwarded from the membership). The UI only hides what the backend would refuse anyway.
- Non-members receive **404**, not 403, for any band-scoped route, so band ids cannot be enumerated.
- A band always keeps at least one admin (demotion/removal of the last admin is refused with `conflict`).
- Members may edit their own instrument and leave the band; everything else on members is admin-only.

## Internationalisation

- Locales: `pt-BR`, `en`; English is the fallback. Resources are bundled statically from `src/locales/<locale>/<namespace>.json`.
- Namespaces: `common`, `auth`, `band`, `repertoire`, `rehearsal`, `tools`, `profile`. Keys are semantic (`rehearsal.controls.start`), never English sentences.
- Detection order: `localStorage` (`bandsync.locale`) → `navigator.language`, mapped through `resolveLocale` (`pt*` → pt-BR, `en*` → en, anything else → en). After sign-in the **account preference wins** and is applied on every device.
- Language changes call `i18next.changeLanguage` and update `<html lang>` without a reload.
- Missing keys are recorded in `missingKeys` and warned in dev; the unit test `test/i18n.test.tsx` asserts that both locales have exactly the same key set, no empty strings and identical interpolation placeholders.
- Dates, numbers and relative times use `Intl` with the active locale (`src/lib/format.ts`). Instants are stored as UTC ISO strings and converted for display.
- Musical data is never translated: pitch classes are stored as numbers or English spellings; the Latin/English display choice is a user preference (`notation`) applied at render time (`spellPitchClass`, `respellChordSheet`).
- API error codes are language-independent (`validation_error`, `invalid_credentials`, `invite_expired`, …) and mapped to translated messages in the client (`common.errors.<code>`).
- Transactional e-mail templates (reset, invite) exist in pt-BR and en and pick the recipient's locale.

## Files

Uploads go to `POST /api/bands/:bandId/files` as multipart (`file` field), limited to 25 MB and to an allow-list of content types (PDF, MP3/MP4/WAV/OGG audio, PNG/JPEG/WebP). The object key is `bands/<bandId>/<fileId>`. Downloads are served by the Worker at `/api/bands/:bandId/files/:fileId` after the membership check, with `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` and private caching. There are no public or signed URLs.

## Logging and errors

- `lib/logger.ts` emits single-line JSON (`ts`, `level`, `event`, fields). Every `/api` request logs method, path, status, duration and request id (`x-request-id` echoed back). Suppressed under `APP_ENV=test`.
- `ApiError` carries a stable code, HTTP status and optional Zod `details`; unexpected exceptions become `internal_error` with a logged stack.

## Realtime and audio

See `REALTIME_PROTOCOL.md` (session state, messages, conductor rules) and `AUDIO_SYNC.md` (clock estimation, timeline, scheduler).

## Decisions and trade-offs

| Decision                                                                       | Rationale                                                                                                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setlists are repertoires with `kind = 'setlist'`                               | One ordering model instead of two near-identical tables (`setlists`/`setlist_items` from the original entity list were dropped)                              |
| Permissions as columns on `band_members` instead of a `band_permissions` table | Four booleans, queried on every request; a join table would add cost without flexibility we need now                                                         |
| Live state in Durable Object storage, metadata in D1                           | The DO is the authority and survives restarts; D1 keeps `rehearsal_sessions`, `rehearsal_participants` and `rehearsal_events` for listing, history and audit |
| Full-state broadcasts (`state` messages) instead of diffs                      | State is a few KB; full snapshots make ordering trivial (`seq`) and reconnection safe                                                                        |
| Client derives `counting_in` → `playing` locally                               | The server commits status only on events; the client uses `deriveStatus` with its clock estimate so the badge changes exactly when the count-in ends         |
| D1-based fixed-window rate limiter                                             | Portable and testable now; can be swapped for the Rate Limiting binding or a DO without changing routes                                                      |
| Soft deletes (`deleted_at`) on bands, songs, materials, repertoires, files     | Supports future export/undo; queries always filter `deleted_at IS NULL`                                                                                      |
| PBKDF2 rather than Argon2/bcrypt                                               | Only Web Crypto is available in Workers without WASM; parameters are stored per hash for future upgrades                                                     |

## AutoArrange

Recording identification, reference sources and preparation jobs live in their own module
(`packages/shared/src/autoarrange`, `apps/api/src/autoarrange`, `apps/web/src/features/autoarrange`)
with two more Durable Objects: `MusicBrainzGatewayDO` (a single instance that spaces, retries and
caches calls to MusicBrainz) and `PrepareJobDO` (one instance per job, one pipeline step per alarm).
External content is never copied: metadata comes from the MusicBrainz API, video is played through
YouTube's official player, chord and tab sites are linked only. Audio analysis is not implemented.
Full description, limits and roadmap in `AUTOARRANGE.md`.

## Known limitations

- E-mail delivery is not configured; only a Resend adapter stub exists behind `MAIL_PROVIDER=resend`.
- No external metadata search, no licensed chord/tab integrations.
- The web bundle is a single ~620 kB chunk (no route-level code splitting yet).
- Offline behaviour of the PWA is limited to the precached shell; API calls are never cached.
- Acoustic synchronisation between real devices has not been measured (see `AUDIO_SYNC.md`).
- Calendar, announcements, polls, tasks and recordings have schema only.

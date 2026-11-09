# BandSync — Deployment

Everything runs on Cloudflare: one Worker serves the API and the built SPA (assets binding), with D1, R2 and a Durable Object. Nothing below has been executed against a real Cloudflare account from this repository yet; the steps follow the current `wrangler.jsonc` and wrangler 4 commands.

## Prerequisites

- Cloudflare account with Workers (Durable Objects require the Workers Paid plan or the free SQLite-backed DO allowance — check current plan terms).
- `pnpm install` done; wrangler is a dev dependency of `apps/api`.

```bash
pnpm --filter @bandsync/api exec wrangler login
```

## 1. Create the production resources

Database:

```bash
pnpm --filter @bandsync/api exec wrangler d1 create bandsync-prod
```

Copy the returned `database_id` into `apps/api/wrangler.jsonc` under `env.production.d1_databases[0].database_id` (replace `REPLACE_WITH_PRODUCTION_D1_ID`).

Bucket:

```bash
pnpm --filter @bandsync/api exec wrangler r2 bucket create bandsync-files-prod
```

The Durable Object classes are declared in `wrangler.jsonc` and created by the deploy: `RehearsalSessionDO` (tag `v1`), `MusicBrainzGatewayDO` and `PrepareJobDO` (tag `v2`, AutoArrange). Nothing to create manually.

## 2. Configure variables and secrets

Plain variables live in `wrangler.jsonc` → `env.production.vars`:

| Variable            | Value                                                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`           | `production` (disables dev-only behaviour such as returning reset links)                                                                                                                                                                                         |
| `APP_URL`           | public origin, e.g. `https://bandsync.example.com` — used in e-mails/invite links and in the Origin check                                                                                                                                                        |
| `PBKDF2_ITERATIONS` | `100000` default. Hashing is native but counted as CPU time; on the Workers free plan (10 ms CPU per request) lower it (e.g. `20000`) or expect occasional limit errors on login. Existing hashes keep their own iteration count, so this can change at any time |

Secrets (only needed if you want e-mails to be sent; without them, e-mails are logged and invite links are shown in the UI for manual sharing):

```bash
pnpm --filter @bandsync/api exec wrangler secret put MAIL_PROVIDER --env production
```

```bash
pnpm --filter @bandsync/api exec wrangler secret put MAIL_API_KEY --env production
```

```bash
pnpm --filter @bandsync/api exec wrangler secret put MAIL_FROM --env production
```

Supported `MAIL_PROVIDER` value today: `resend` (HTTP API adapter in `src/lib/mailer.ts`). Any other value falls back to console logging.

For local development copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`; it is git-ignored.

### AutoArrange variables (optional)

| Variable                                      | Purpose                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MUSICBRAINZ_CONTACT`                         | Contact (a URL or an address chosen by whoever runs the deployment) added to the `User-Agent` sent to MusicBrainz, as their API etiquette asks. Without it the app identifies itself only as `BandSync/<version>`, which MusicBrainz may throttle more. Not set anywhere in this repository. |
| `MUSICBRAINZ_BASE_URL`, `YOUTUBE_OEMBED_BASE` | Override the external endpoints (used by tests and local e2e).                                                                                                                                                                                                                               |
| `MUSICBRAINZ_MIN_INTERVAL_MS`                 | Minimum spacing between MusicBrainz calls (default 1100).                                                                                                                                                                                                                                    |

AutoArrange needs outbound access to `musicbrainz.org` and `www.youtube.com` only. It uses no API key and no paid service; see `AUTOARRANGE.md` §10.

## 3. Apply migrations remotely

```bash
pnpm --filter @bandsync/api exec wrangler d1 migrations apply bandsync-prod --remote --env production
```

Do **not** load `seed/demo.sql` remotely.

## 4. Build and deploy

Build the SPA (output in `apps/web/dist`, which the Worker's `assets.directory` points to):

```bash
pnpm --filter @bandsync/web build
```

Deploy the Worker with assets:

```bash
pnpm --filter @bandsync/api exec wrangler deploy --env production
```

`run_worker_first: ["/api/*"]` makes every `/api` request hit the Worker; other paths are served from the assets with `not_found_handling: single-page-application`, so deep links like `/bands/<id>/rehearsal/<session>` load the app shell.

## 5. Custom domain

In the Cloudflare dashboard → Workers & Pages → bandsync → Settings → Domains & Routes, add the custom domain (or add a `routes` entry with `custom_domain: true` to `env.production` in `wrangler.jsonc`). Set `APP_URL` to that origin and redeploy. HTTPS is automatic and required for the session cookie's `Secure` flag, PWA installation and the tuner's microphone access.

## 6. Verify

```bash
curl -s https://bandsync.example.com/api/health
```

Expect `{"ok":true,"env":"production",...}`. Then register the first account through the UI, create a band and open a live session from two phones.

## Observability

`observability.enabled: true` in `wrangler.jsonc` turns on Workers Logs. The Worker emits one JSON line per API request (`http.request` with method, path, status, duration, request id) and structured events for auth, rehearsal persistence failures and mail. Tail live:

```bash
pnpm --filter @bandsync/api exec wrangler tail --env production
```

## Environments

- `development` (default, `wrangler dev`): local D1/R2/DO state under `apps/api/.wrangler/state`, `APP_URL=http://localhost:5173`, dev-only reset links.
- `staging` (`--env staging`): homologation Worker `bandsync-staging` on `*.workers.dev`, its own D1 (`bandsync-staging`), R2 bucket and Durable Object namespace, protected by an access key. See `docs/STAGING.md`.
- `production` (`--env production`): separate D1 database and bucket as above.
- Tests use `APP_ENV=test` through the Vitest plugin bindings, never a remote resource.

## Backups and data

- D1: use `wrangler d1 export bandsync-prod --remote --output backup.sql --env production` for SQL dumps; Time Travel restores are available in the dashboard.
- R2: objects are keyed `bands/<bandId>/<fileId>`; enable bucket versioning or lifecycle rules in the dashboard as needed.
- Durable Object storage holds only live session state; ended sessions keep their final snapshot but nothing depends on it.

## Privacy (LGPD) notes

- Personal data stored: e-mail, display name, optional avatar URL, instruments, preferences, session metadata (user agent, IP), audit logs with user ids.
- Passwords are hashed (PBKDF2) and never logged; session cookies are HttpOnly.
- Files and materials are private to band members; there are no public URLs.
- **Planned, not implemented:** self-service data export, account deletion (soft-delete column exists on `users`), retention policy for `auth_sessions`, `audit_logs` and `rate_limits` rows (a scheduled cleanup via Cron Triggers is the intended mechanism).

## Not configured in this repository

- An e-mail provider (only the Resend adapter exists).
- External APIs (song metadata, chord/tab providers, SMS).
- Rate limiting via Cloudflare's binding (D1 fixed-window limiter is used instead).
- CI pipeline (all suites run locally with `pnpm test`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm lint`).

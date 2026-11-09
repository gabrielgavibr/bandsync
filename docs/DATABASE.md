# BandSync — Database

Cloudflare D1 (SQLite). Schema lives in `apps/api/migrations/0001_init.sql`; migrations are versioned SQL files applied by wrangler.

## Conventions

- Primary keys are UUID strings (`crypto.randomUUID()`), except `rehearsal_events.id` and `audit_logs.id` which are `INTEGER PRIMARY KEY AUTOINCREMENT`.
- All timestamps are ISO-8601 **UTC** strings (`TEXT`). Conversion to the user's time zone happens in the client.
- Soft delete: tables with `deleted_at` are never hard-deleted by the API; every query filters `deleted_at IS NULL`.
- Booleans are `INTEGER` 0/1.
- JSON blobs (`secondary_instruments`, `material_preferences`, event payloads, audit metadata) are stored as `TEXT`.
- Foreign keys declared with `ON DELETE CASCADE` / `SET NULL`; `PRAGMA foreign_keys = ON` is set at the top of the migration.
- Technical names are English; user-facing labels are translated in the web app.

## Tables

### Identity

| Table              | Purpose                         | Key columns                                                                                                                                                                             |
| ------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`            | Accounts                        | `email` (unique, lower-cased), `password_hash` (`pbkdf2$sha256$iter$salt$hash`), `display_name`, `avatar_url`, `primary_instrument`, `secondary_instruments` (JSON array), `deleted_at` |
| `user_preferences` | One row per user (PK `user_id`) | `locale`, `theme`, `notation` (`english`/`latin`), `material_preferences` (JSON `{instrument: [types]}`), `click_sound`, `click_volume`, `time_zone`                                    |
| `auth_sessions`    | Server-side sessions            | `token_hash` (unique SHA-256 of the cookie token), `expires_at`, `last_used_at`, `user_agent`, `ip`. Indexes on `user_id`, `expires_at`                                                 |
| `password_resets`  | Reset tokens                    | `token_hash` (unique), `expires_at` (1 h), `used_at`                                                                                                                                    |

### Bands

| Table              | Purpose                            | Key columns                                                                                                                                                                                                 |
| ------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bands`            | A band                             | `name`, `description`, `genre`, `image_url`, `created_by`, `deleted_at`                                                                                                                                     |
| `band_members`     | Membership (PK `band_id, user_id`) | `role` (`admin`/`member`), `instrument`, `can_edit_repertoire`, `can_manage_events`, `can_control_rehearsal`, `can_post_announcements`, `joined_at`. Index on `user_id`                                     |
| `band_invitations` | Invitations                        | `kind` (`code`/`link`/`email`), `code` (unique; 8 chars for codes, 24 for links), `email`, `role`, `instrument`, `locale`, `max_uses`, `uses`, `expires_at`, `revoked_at`, `created_by`. Index on `band_id` |

Invitation status is derived: revoked → `revoked`; `uses >= max_uses` → `used`; past `expires_at` → `expired`; otherwise `active`.

### Files

| Table   | Purpose                    | Key columns                                                                                                                  |
| ------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `files` | Metadata for objects in R2 | `r2_key` (unique, `bands/<bandId>/<fileId>`), `name`, `content_type`, `size`, `created_by`, `deleted_at`. Index on `band_id` |

### Repertoire

| Table              | Purpose                                       | Key columns                                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `songs`            | Catalogue entry with the _original_ reference | `band_id`, `title`, `artist`, `album`, `external_id`, `duration_seconds`, `original_bpm`, `original_key`, `deleted_at`. Index `(band_id, deleted_at)`                                                                                                        |
| `song_versions`    | The band's arrangement                        | `song_id`, `label` (default `band`), `bpm`, `key`, `beats_per_bar`, `beat_unit`, `notes`, `reference_url`, `is_current`. Index `(song_id, is_current)`. The API currently creates exactly one current version per song                                       |
| `song_sections`    | Arrangement map                               | `version_id`, `name`, `position`, `bars`, `notes`. Index `(version_id, position)`                                                                                                                                                                            |
| `song_materials`   | Per-instrument materials                      | `song_id`, `version_id`, `type`, `title`, `instrument` (nullable = any), `body` (text), `external_url`, `file_id` → `files`, `key` (key the chart is written in), `version` (incremented on edit), `created_by`, `deleted_at`. Index `(song_id, deleted_at)` |
| `repertoires`      | Ordered lists of any kind                     | `band_id`, `name`, `kind` (`general`/`rehearsal`/`setlist`/`in_preparation`/`custom`), `description`, `deleted_at`                                                                                                                                           |
| `repertoire_items` | Membership of a song in a list                | `repertoire_id`, `song_id`, `position`, `notes`; `UNIQUE(repertoire_id, song_id)`. Index `(repertoire_id, position)`                                                                                                                                         |

### AutoArrange

Kept apart on purpose: the **composition** (`songs.work_mbid`, `songs.composer`), each **recording** (`song_recordings`), **automatic analysis** (`analysis_results`, immutable, with origin and review state), **reference material** (`song_references`, links only) and the **band arrangement** (`song_versions`, `song_sections`, `song_harmony`, `song_materials`). `analysis_jobs` tracks each preparation, `audio_assets` records the declared right to analyse a file, `review_events` is the confirmation trail. Details in `AUTOARRANGE.md`.

### Calendar and board (schema only — no API or UI yet)

| Table                           | Purpose                                                    | Key columns                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `events`                        | Rehearsals, shows, recordings, meetings, custom            | `type`, `title`, `starts_at`, `ends_at`, `location`, `description`, `repertoire_id`, `deleted_at`. Index `(band_id, starts_at)` |
| `event_attendance`              | RSVP (PK `event_id, user_id`)                              | `status` (`pending`/`confirmed`/`declined`), `note`, `updated_at`                                                               |
| `announcements`                 | Board posts                                                | `type` (`info`/`ack`/`poll`), `title`, `body`, `closes_at`, `deleted_at`                                                        |
| `announcement_acknowledgements` | Explicit "I read this" (PK `announcement_id, user_id`)     | `acknowledged_at`                                                                                                               |
| `poll_options`                  | Options of a poll announcement                             | `label`, `position`                                                                                                             |
| `poll_votes`                    | One vote per user per poll (PK `announcement_id, user_id`) | `option_id`, `voted_at`                                                                                                         |
| `musical_tasks`                 | "My preparation" items                                     | `song_id`, `assignee_user_id`, `title`, `description`, `due_at`, `status` (`open`/`in_progress`/`done`)                         |

### Live sessions

| Table                    | Purpose                                    | Key columns                                                                                                                                                      |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rehearsal_sessions`     | One row per session (metadata)             | `band_id`, `title`, `status` (last committed status from the DO), `repertoire_id`, `created_by`, `created_at`, `ended_at`. Index `(band_id, status, created_at)` |
| `rehearsal_participants` | Who ever joined (PK `session_id, user_id`) | `first_joined_at`, `last_seen_at`                                                                                                                                |
| `rehearsal_events`       | Append-only log of committed state changes | `seq`, `type` (`song_changed`, `metronome_started`, `conductor_changed`, …), `payload` (JSON), `actor_user_id`. Index `(session_id, seq)`                        |

### Operations

| Table         | Purpose                                                                                                                | Key columns                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `audit_logs`  | Administrative actions (`band.created`, `member.updated`, `invite.revoked`, `file.uploaded`, `user.password_reset`, …) | `band_id`, `actor_user_id`, `action`, `target_type`, `target_id`, `metadata` (JSON). Index `(band_id, created_at)` |
| `rate_limits` | Fixed-window counters (PK `key`)                                                                                       | `window_start`, `count`                                                                                            |

## Durable Object vs D1

`MusicBrainzGatewayDO` keeps only a cache of source answers and the time of its last call; `PrepareJobDO` keeps only the id of the job it drives (the job itself is in `analysis_jobs`). The rest of this section is about the live session.

| Lives in the Durable Object (`RehearsalSessionDO`, key `state`)                                                                                                                                                    | Lives in D1                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Full `SessionState`: participants and their connection/audio/ready flags, conductor, repertoire song ids, current song snapshot, metronome (bpm, meter, count-in, subdivision, running, anchor, click mode), `seq` | `rehearsal_sessions` row (listing, "active session" lookup, ended flag)             |
| `allDisconnectedAt` for the 12 h auto-end alarm                                                                                                                                                                    | `rehearsal_participants` (who joined, last seen)                                    |
|                                                                                                                                                                                                                    | `rehearsal_events` (every committed change with `seq`, best-effort via `waitUntil`) |

The DO reads D1 when it needs song or repertoire data (`getSongForSession`, `listSongIds`). Writes from the DO to D1 are fire-and-forget; a failed write is logged and never blocks the live session.

## Migrations

Local (creates `.wrangler/state` under `apps/api`):

```bash
pnpm db:migrate:local
```

Remote, production environment (after creating the database — see `DEPLOYMENT.md`):

```bash
pnpm --filter @bandsync/api exec wrangler d1 migrations apply bandsync-prod --remote --env production
```

Applied migrations:

| File                                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_init.sql`                        | Initial schema                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `0002_song_references_and_pending.sql` | Additive only. `songs`: `composer`, `reference_recording`, `reference_year`, `original_time_signature`, `original_bpm_status` / `original_key_status` (`unknown` \| `estimated` \| `confirmed`), `metadata_sources` (JSON list of `{field, value, url, note}`). `song_versions.meter_confirmed`. `song_materials.status` (`ready` \| `pending`) and `is_example`. New table `song_references` (external links, unique per song and URL). Existing rows get safe defaults.                                                                                       |
| `0003_autoarrange.sql`                 | Additive only. `songs.work_mbid`. New tables `song_recordings` (identified recordings; one reference per song), `audio_assets` (authorised audio with rights declaration), `analysis_jobs` (preparation jobs; one active job per dedupe key), `analysis_results` (immutable values with origin, method, confidence and review state), `review_events` (who confirmed what and when), `song_harmony`. `song_sections`: `kind`, `start_ms`, `end_ms`, `cues`, `origin`, `origin_result_id`. `song_materials`: `origin`, `origin_job_id`. See `AUTOARRANGE.md` §3. |
| `0004_reference_link.sql`              | Additive only. `song_recordings`: `platform`, `external_id`, `link_url`, `link_title`, `link_author`, `thumbnail_url`, `embeddable`, `link_checked_at` (the reference link and what the platform said), `metadata_edited_by` / `metadata_edited_at`, `reference_since`, `retired_at`. Existing recordings that carried a validated YouTube video get it as their link; current references get `reference_since`. No table is rebuilt and no row is deleted. See `REFERENCE_RECORDING.md` §4.                                                                    |

Add a migration by creating the next numbered file in `apps/api/migrations/`. Wrangler applies files in order and records them in the `d1_migrations` table. Tests apply every migration automatically before each test file through `test/apply-migrations.ts`.

Reset local state (destroys the local database, including seeded data and Durable Object storage):

```bash
pnpm db:reset:local
```

## Seed data

`apps/api/seed/demo.sql` is loaded with `pnpm db:seed:local` and is **development-only**. It creates four demo users (password `bandsync-demo`), one band ("Sala 3"), three songs with fictional lyrics, chords, tabs and maps written for this repository, and two repertoires. The statements use `INSERT OR IGNORE`, so re-running is safe. Never run it against a remote database with its public password; staging uses `scripts/staging-credentials.mjs`, which replaces it.

`apps/api/seed/real-repertoire.json` holds the real repertoire used for homologation (see `docs/REAL_REPERTOIRE.md`). It is applied through the REST API by `scripts/import-real-repertoire.mjs`, which only creates what is missing and never modifies existing rows.

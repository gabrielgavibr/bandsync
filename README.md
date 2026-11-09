# BandSync

**Your band. Your music. In sync.**
**Sua banda. Sua música. Todo mundo em sintonia.**

BandSync is a collaborative platform for bands: repertoire and per-instrument materials, members and invitations, and a **live rehearsal room** where everyone in the same studio joins from their own phone. The conductor picks the song; every musician instantly sees the material for _their_ instrument, and a shared metronome counts in on a common timeline.

It is **not** a remote-jamming tool. No instrument audio is streamed. Musicians are in the same room; BandSync keeps their screens and their click in sync.

## Resumo em português

O BandSync organiza a banda (músicas, versões, materiais por instrumento, repertórios, integrantes, convites e permissões) e oferece o **Ensaio ao vivo**: uma sessão em tempo real em que o regente escolhe a música e cada músico recebe automaticamente o material do seu instrumento (cifra, tablatura, mapa de bateria, letra…), com BPM, compasso e metrônomo compartilhados por um protocolo de sincronização de relógio.

Estado atual: Fase 0 (fundação) e Fase 1 (prova de conceito do Ensaio ao vivo) concluídas e testadas automaticamente; a maior parte da Fase 2 (bandas e repertório) também está implementada. Agenda, mural, votações e tarefas musicais ainda **não** existem (só as tabelas). A simultaneidade acústica entre aparelhos reais **ainda não foi medida**; veja `docs/AUDIO_SYNC.md`.

Interface em português (pt-BR) e inglês desde o início; a preferência de idioma fica na conta.

## Status

| Area                                                                                                                                                        | Status                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Accounts: e-mail + password, sessions, password reset flow, profile, preferences                                                                            | Done (e-mail delivery itself is not configured; the reset link is shown in dev) |
| Bands, members, admin/member roles, 4 granular permissions enforced server-side                                                                             | Done                                                                            |
| Invitations by code, link or e-mail (expiry, max uses, revoke)                                                                                              | Done (e-mail sending requires a provider)                                       |
| Songs with original reference + band version, arrangement sections                                                                                          | Done                                                                            |
| Per-instrument materials (text, external link, PDF/audio file in R2)                                                                                        | Done                                                                            |
| Repertoires / setlists with ordering                                                                                                                        | Done                                                                            |
| Live rehearsal: shared session, conductor role, song selection, per-instrument view, scheduled count-in, bar-aligned tempo changes, reconnection, hand-over | Done (proof of concept, tested with two browser contexts)                       |
| Clock-sync protocol + lookahead Web Audio metronome + diagnostics                                                                                           | Done in software; **acoustic simultaneity on real phones not yet measured**     |
| Tools: metronome, transposer, chromatic tuner                                                                                                               | Done                                                                            |
| i18n pt-BR / en with key-parity test                                                                                                                        | Done                                                                            |
| PWA manifest, service worker, icons                                                                                                                         | Done (offline behaviour not polished)                                           |
| Calendar, attendance, announcements, polls, musical tasks, recordings                                                                                       | **Planned** (tables exist, no API or UI)                                        |
| AutoArrange stage A: find the exact recording (MusicBrainz), official YouTube player, source registry, preparation jobs, sourced results, human review      | Done (see `docs/AUTOARRANGE.md`)                                                |
| AutoArrange audio analysis (tempo, key, structure, chords)                                                                                                  | **Not implemented** (designed; needs authorised audio and an analysis engine)   |
| Social login, SMS invites                                                                                                                                   | **Planned**                                                                     |

See `docs/ROADMAP.md` for the phase-by-phase picture.

## Quick start

Requirements: Node 22+, pnpm 10 (`corepack enable`), no Cloudflare account needed for local work.

```bash
pnpm install
```

```bash
pnpm db:migrate:local
```

```bash
pnpm db:seed:local
```

```bash
pnpm dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` (including WebSockets) to the Worker on port 8787.

Demo accounts (password `bandsync-demo`, data is fictional):

| E-mail              | Role in "Sala 3"                | Instrument |
| ------------------- | ------------------------------- | ---------- |
| ana@bandsync.demo   | admin                           | drums      |
| bruno@bandsync.demo | member                          | bass       |
| carla@bandsync.demo | member (cannot conduct)         | vocals     |
| diego@bandsync.demo | member (cannot edit repertoire) | guitar     |

To try the live room with two "devices" locally, sign in as Ana in one browser and Bruno in a private window, open the band, then **Live rehearsal → Start session**. For real phones on the same Wi-Fi see `docs/TESTING.md`.

## Repository layout

```
apps/
  api/        Cloudflare Worker (Hono) + D1 + R2 + Durable Object for live sessions
  web/        React 19 + Vite + Tailwind 4 PWA, i18next (pt-BR, en)
packages/
  shared/     Zod schemas, realtime protocol, music theory, clock sync and metronome math
e2e/          Playwright suite (two browser contexts in one rehearsal)
docs/         Product, architecture, database, protocol, audio sync, roadmap, testing, deployment
```

## Scripts (repository root)

| Command                       | What it does                                                             |
| ----------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`                    | Runs the API (wrangler dev, port 8787) and the web app (Vite, port 5173) |
| `pnpm build`                  | Builds every package (web bundle + worker dry-run)                       |
| `pnpm typecheck`              | TypeScript across the workspace                                          |
| `pnpm lint` / `pnpm lint:fix` | Biome                                                                    |
| `pnpm test`                   | Unit + Worker integration tests (shared, api, web)                       |
| `pnpm test:e2e`               | Playwright end-to-end tests (starts both servers)                        |
| `pnpm db:migrate:local`       | Applies D1 migrations to the local database                              |
| `pnpm db:seed:local`          | Loads the fictional demo data                                            |
| `pnpm db:reset:local`         | Wipes local state and re-applies migrations                              |

## Documentation

- `docs/PRODUCT.md` — vision, modules, acceptance criteria
- `docs/ARCHITECTURE.md` — stack, auth, permissions, i18n, decisions
- `docs/DATABASE.md` — schema, migrations, seed policy
- `docs/REALTIME_PROTOCOL.md` — WebSocket messages and session rules
- `docs/AUDIO_SYNC.md` — clock sync, metronome timeline, calibration procedure
- `docs/ROADMAP.md` — phases and next steps
- `docs/TESTING.md` — how to run and extend the test suites, multi-device testing
- `docs/DEPLOYMENT.md` — Cloudflare setup and production deploy
- `docs/STAGING.md` — homologation environment
- `docs/REAL_REPERTOIRE.md` — the real songs used for homologation
- `docs/AUTOARRANGE.md` — recording identification, sources, preparation jobs, analysis roadmap

## Licensing of musical content

BandSync stores only material the band adds itself. It does not scrape or fetch lyrics, chords or tabs from third-party sites: AutoArrange reads open metadata from the MusicBrainz API, plays YouTube only through the official embedded player (no download or audio extraction) and keeps plain links to chord and tab sites. The demo seed contains fictional songs written for this repository.

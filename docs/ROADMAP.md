# BandSync — Roadmap

Phases follow the master specification. Status reflects the code in this repository, not intentions.

## Phase 0 — Technical foundation — **Done**

- pnpm monorepo: `apps/api`, `apps/web`, `packages/shared`, `e2e`; strict TypeScript, Biome.
- Cloudflare Worker (Hono) with D1, R2 and Durable Object bindings; local development with `wrangler dev`.
- Versioned D1 migration with the full schema (including tables for later phases).
- Authentication: register, login, logout, password reset flow, HttpOnly cookie sessions, rate limiting, audit log.
- Design system: tokens, dark/light theme, reusable components (Button, Field, Card, Badge, Dialog, Toast, Segmented, Toggle…).
- Internationalisation pt-BR / en as a foundation requirement, with parity tests.
- PWA manifest, icons and service worker.
- Test tooling: Vitest for shared and web, `@cloudflare/vitest-plugin` for the Worker, Playwright for e2e.
- Documentation set (this `docs/` folder).

## Phase 1 — Live rehearsal proof of concept — **Done**

- Session creation and join from several devices; connected participants with instrument, audio and ready flags.
- Conductor role: automatic assignment, transfer, claim, 90 s grace after disconnect, admin override.
- Song selection, next/previous within a repertoire, state distribution with monotonic `seq`.
- Per-instrument material resolution on each device; local-only zoom, material switch and transposed display.
- Scheduled start on the server clock, count-in, bar-aligned tempo changes, stop.
- Clock-sync protocol (NTP-style estimator) and lookahead Web Audio metronome.
- Late join and reconnection with full snapshot; conductor-offline take-over; ended-session handling.
- Sync diagnostics dialog.
- Automated coverage: 7 WebSocket Durable Object tests and a two-browser-context Playwright scenario.
- **Not done:** acoustic measurement on real phones (procedure written, see `AUDIO_SYNC.md`).

## Phase 2 — Bands and repertoire — **Mostly done**

Done:

- Bands (create, overview, edit via API), members, roles, four granular permissions enforced server-side.
- Invitations by code, link and e-mail with expiry, max uses, revoke and status; join page.
- Songs with original reference and band version; arrangement sections.
- Materials per instrument (text, external link, R2 files), versions, preferred material per user.
- Repertoires of all kinds with ordering; integrated into the live room (repertoire selection, next/previous).
- Private file upload and download.

Missing:

- Song metadata search (MusicBrainz or similar) — only a notice in the form today.
- SMS / messaging invitations (model supports a `kind`, no channel).
- Social login and e-mail verification.
- Band detail editing UI (image, description) beyond the API.
- Material drag-and-drop ordering and per-material notes.

## Phase 3 — Band management — **Planned**

Tables exist (`events`, `event_attendance`, `announcements`, `announcement_acknowledgements`, `poll_options`, `poll_votes`); no API routes or UI yet.

- Calendar: rehearsals, shows, recordings, meetings, custom events; location, related repertoire, files.
- Attendance: confirmed / declined / pending per member, visible to admins, change history.
- Board: informative posts, posts requiring explicit acknowledgement (distinct from having opened the post), polls with results and timestamps.
- Reminders and notifications (push/e-mail) once a delivery channel is configured.

## Phase 4 — Advanced tools — **Partial**

Done:

- Transposer for structured chord charts, English/Latin note names.
- Arrangement map shown as shared information in the song page and the room.
- Chromatic tuner (microphone autocorrelation).
- Standalone metronome sharing the room's engine.

Planned:

- Musical tasks / "my preparation" (table exists).
- Rehearsal recordings attached to songs, markers and notes.
- Section following along the metronome timeline, switchable, tolerant of sections that do not last exactly the written bars.
- Reader improvements: auto-scroll, annotations, personal notes inside the room.

## Phase 5 — Optimisation and distribution — **Planned**

- Run the real-device calibration procedure; decide on output-latency compensation and manual per-device offset.
- Screen wake-lock during a session; background-resume hardening.
- PWA offline polish (cached song materials for the active repertoire).
- Route-level code splitting (room and tools are currently in the main bundle).
- Accessibility pass (focus order in the room, reduced-motion beat indicator).
- Production deployment on Cloudflare with custom domain; e-mail provider; monitoring.
- LGPD: data export and account deletion endpoints.

## AutoArrange — **Stage A done**

Detailed in `AUTOARRANGE.md`.

- **A — Identification and sources — Done.** Add-song wizard (search by title/artist, one result per recording, release choice, YouTube link validated and played in the official player), source registry with what each site allows, preparation jobs on a Durable Object (states, retry, cancel, dedupe, cost budget), results stored with origin/method/review state, human confirmation of the band's tempo, key and meter with who and when, song-sheet panel, live session using the confirmed values.
- **Reference recording by link — Done.** Songs are added by pasting a YouTube, YouTube Music or Spotify link; one main reference per song, shown on the song page, song list, repertoire and live room; replacement asks first and keeps history; the song page has two blocks (reference recording, band arrangement) with sources under "Technical details"; authorised audio can be uploaded and tied to the reference. See `REFERENCE_RECORDING.md`.
- **B — Authorised audio analysis — Not implemented.** Authorised audio can be uploaded with a rights declaration and the pipeline steps exist; there is no analysis engine. Tempo, key, structure and chords are not produced.
- **C — Arrangement-map editor — Not implemented.** Section timing and cue columns exist.
- **D — Per-instrument materials — Not implemented.** Harmony table exists; pending workspaces per instrument are created today.
- **E — Live integration and homologation — Partial.** The live room uses the band's confirmed tempo and meter; it does not follow an arrangement map yet.

## Next recommended step

Run the **acoustic calibration** on two real phones (`AUDIO_SYNC.md` §9) and log the results. Everything downstream in the sync design (latency compensation, quality thresholds, whether synced mode can be recommended over central click) depends on that measurement, and it is the one acceptance criterion that software tests cannot settle. In parallel, Phase 3 (calendar and board) is the next feature block with no technical unknowns.

For AutoArrange, the next step is **stage B with an in-browser engine** on a file the member provides (no server cost), validated against the three real songs before any estimate is shown without "review needed". A server-side engine is a paid service and needs authorisation first.

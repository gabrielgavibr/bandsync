# BandSync — AutoArrange

AutoArrange helps a band go from "we want to play this song" to "everyone has the right
recording, the right references and a slot for their own material". It is built in stages.
**Stage A (identification and sources) is implemented.** **Stage B is implemented in part:**
BandSync's own engine estimates tempo, beats, meter and key on the member's device, from the
microphone while the reference plays or from an authorised audio file (section 16). Chords and
sections are not produced yet. Every estimate is shown as "review needed" until the band confirms it.

> **Read first:** songs are now added by pasting a link to the recording, and the song page is
> built around one main reference recording. That flow, its platforms and its rules are described
> in [`REFERENCE_RECORDING.md`](REFERENCE_RECORDING.md). This document covers the rest: the
> catalogue search, the preparation jobs, the review trail and the analysis roadmap.

## 1. Principles

1. **Nothing is invented.** A value exists only if a named source gave it or a band member typed
   it. A step that cannot run reports _why_ (`no_authorized_audio`, `engine_not_configured`).
2. **Composition, recording, analysis, reference material and band arrangement are different
   things** and live in different tables (section 3).
3. **Every automatic value carries its origin**: value, method, method version, confidence (only
   when calibrated), source URL, review state and date.
4. **People decide.** Automatic data never overwrites what the band typed, and what the band
   uses in rehearsal (tempo, key, meter) is confirmed by a person; who and when are recorded.
5. **A link is not a licence.** A YouTube link is played through the official player only; audio
   is analysed only from a file a member declares the band is allowed to use.
6. **Third-party charts and tabs are linked, never copied or rewritten.**

## 2. Architecture

```
 Web app (React)                         Worker (Hono)                        Outside
 ───────────────                         ─────────────                        ───────
 Add-song wizard ── search ───────────▶ /autoarrange/search ──┐
                 ── recording details ▶ /autoarrange/recordings┤   MusicBrainzGatewayDO ──▶ musicbrainz.org
                 ── YouTube check ────▶ /autoarrange/youtube ──┼──────────────────────────▶ youtube.com/oembed
                 ── prepare ──────────▶ /autoarrange/prepare ──┤   (one call at a time, ≥1.1 s apart,
 Job progress  ◀── poll ───────────────  /autoarrange/jobs/:id │    retry on 503/429, cached)
 Review form   ── confirm/edit ───────▶ /autoarrange/songs/:id/review
 Song sheet panel ◀──────────────────── /autoarrange/songs/:id │
                                                               ▼
                                             PrepareJobDO (one per job, one step per alarm)
                                               1 searching_references
                                               2 analyzing_audio        ← engine interface (stage B)
                                               3 detecting_structure    ← engine interface (stage B)
                                               4 preparing_materials
                                                               │
                                                               ▼
                                             D1: song_recordings, analysis_jobs, analysis_results,
                                                 review_events, audio_assets, song_harmony, …
 Live rehearsal ◀── band tempo / meter ──── song_versions (confirmed by the band)
```

| Piece           | Where                                          | Role                                                                                                                                              |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure logic      | `packages/shared/src/autoarrange/`             | Types, zod schemas, MusicBrainz query/normalisation, YouTube URL parsing, job state machine. No I/O; unit-tested against captured real responses. |
| Routes          | `apps/api/src/routes/autoarrange.ts`           | `/api/bands/:bandId/autoarrange/*`, membership and editor permissions, rate limits.                                                               |
| Source registry | `apps/api/src/autoarrange/connectors.ts`       | One entry per source with what BandSync may do with it. The UI reads it; no provider is hard-coded in the interface.                              |
| Clients         | `apps/api/src/autoarrange/clients.ts`          | MusicBrainz (through the gateway) and YouTube oEmbed.                                                                                             |
| Gateway         | `apps/api/src/durable/MusicBrainzGatewayDO.ts` | Single instance. Serialises calls so the whole deployment respects one request per second, retries 503/429, caches answers.                       |
| Job runner      | `apps/api/src/durable/PrepareJobDO.ts`         | One instance per job. One step per alarm, retry with back-off, attempt limit, cost budget, cancellation.                                          |
| Pipeline        | `apps/api/src/autoarrange/pipeline.ts`         | The four steps.                                                                                                                                   |
| Web             | `apps/web/src/features/autoarrange/`           | Wizard, job progress, results, review form, song-sheet panel.                                                                                     |

### Why Durable Objects

- **Rate limit with one owner.** MusicBrainz allows about one request per second per client. A
  Worker has many isolates; only a single object can guarantee the spacing.
- **Work outside the request.** `POST /prepare` answers at once; steps run on alarms, survive
  restarts and are retried.
- **No queue product needed.** Alarms are available on the free plan, so stage A adds no paid
  service.

## 3. Data model (migrations `0003_autoarrange.sql` and `0004_reference_link.sql`, additive)

| Concept            | Table                                                                                                                              | Notes                                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Composition        | `songs.work_mbid`, `songs.composer`                                                                                                | The work, independent of who recorded it.                                                                                                                                                              |
| Recording          | `song_recordings`                                                                                                                  | One row per identified recording: MusicBrainz id, artist credit, release, duration, ISRCs, works, links, validated YouTube video. At most one **reference** recording per song (partial unique index). |
| Automatic analysis | `analysis_results`                                                                                                                 | Immutable rows: kind, value, method, method version, confidence, calibrated flag, origin, source URL, review state, reviewer, dates. A correction adds a new row; the original stays.                  |
| Authorised audio   | `audio_assets`                                                                                                                     | A stored file plus the declared legal basis (`own_recording`, `licensed`, `permission_from_owner`), who declared it and when.                                                                          |
| Jobs               | `analysis_jobs`                                                                                                                    | Status, per-step record, attempts, error, cost units, dedupe key (partial unique index on active jobs).                                                                                                |
| Reviews            | `review_events`                                                                                                                    | Who confirmed, edited or rejected what, with the value before and after.                                                                                                                               |
| Reference material | `song_references` (existing)                                                                                                       | Links only: MusicBrainz, the official video, search links on chord/tab sites.                                                                                                                          |
| Band arrangement   | `song_versions`, `song_sections` (+ `kind`, `start_ms`, `end_ms`, `cues`, `origin`), `song_harmony`, `song_materials` (+ `origin`) | What the band actually plays. Automatic drafts are marked with their origin and never replace band content.                                                                                            |

`song_harmony` and the timing/cue columns of `song_sections` are structure for stages C and D;
nothing writes automatic content to them yet.

## 4. Sources and their restrictions

Checked on 2026-11-09. Each source is an independent connector.

| Source                     | What BandSync does                                                                                                                                                                                                   | What it does **not** do                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MusicBrainz**            | Official JSON web service: search recordings, read one recording with releases, ISRCs, works and their writers, URL relations. Core data is CC0 and may be stored. One request per second, identifying `User-Agent`. | No scraping of pages.                                                                                                                                                   |
| **YouTube, YouTube Music** | Identifies a pasted link through oEmbed (title, channel, thumbnail) and plays it in the official privacy-enhanced embedded player.                                                                                   | **No download, no audio extraction, no storage of the audio.** Embedding can be disabled by the video owner; then only the link is shown.                               |
| **Spotify**                | Identifies a pasted track link through oEmbed (title and cover only) and plays it in the official embedded player.                                                                                                   | **No download, no audio extraction.** No artist or duration from the public endpoint; the Web API is not configured.                                                    |
| **Cifra Club**             | Listed in the source registry as link-only. The preparation no longer creates search links to it.                                                                                                                    | No request is made by the server (the site refuses automated requests with HTTP 403 and its legal notice forbids extraction and framing). No content is read or stored. |
| **Cifras.com.br**          | Link-only, as above.                                                                                                                                                                                                 | `robots.txt` disallows `/busca` and `/api/`; content is for personal use. Nothing is fetched.                                                                           |
| **Songsterr**              | Link-only, as above.                                                                                                                                                                                                 | `robots.txt` disallows `/api/`; tab licences do not cover showing them elsewhere. Nothing is fetched.                                                                   |

Consequences that the interface states plainly:

- Chord and tab sites allow links only. They are not shown in the add-song flow or on the song
  page any more; links stored earlier stay under "Technical details".
- MusicBrainz is community data. A recording may have no linked work, so the composer may be
  absent (true today for the catalogued recordings of _Esotérico_ and for Gilberto Gil's
  _O Segundo Sol_). The app then says "the source does not say who wrote this recording".
- MusicBrainz does not publish tempo, key or structure. Those can only come from audio analysis
  or from the band.

## 5. Preparation pipeline

`POST /prepare` resolves the recording **from the source itself** (client-supplied metadata is
never trusted), creates the song if needed, stores the reference recording and starts a job.

| Step                   | Today                                                                                                                                                                                                                                                                              | Result    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `searching_references` | **Implemented.** When the recording has a catalogue id, reads it from MusicBrainz and stores duration and composer as results with origin and source URL. A recording identified only by its link has nothing to read (`no_recording_identifier`). No links are added to the song. | `done`    |
| `analyzing_audio`      | **Not implemented.** Skipped with `no_authorized_audio` when the band gave no file, or `engine_not_configured` when it did.                                                                                                                                                        | `skipped` |
| `detecting_structure`  | **Not implemented.** Same reasons.                                                                                                                                                                                                                                                 | `skipped` |
| `preparing_materials`  | **Implemented.** Fills only _empty_ song fields from sourced data and opens one pending workspace per instrument in the band (drums: arrangement map, bass: tab, guitar and keys: chords, vocals: lyrics). The workspaces are empty on purpose: the band fills them.               | `done`    |

Job states: `pending` → `searching_references` → `analyzing_audio` → `detecting_structure` →
`preparing_materials` → `awaiting_review` → `completed`, plus `failed` and `cancelled`.

Safeguards:

- **Deduplication**: one active job per (song, recording, audio file, pipeline version).
- **Retries**: a failed step is retried with back-off, at most 3 attempts; then the job fails
  with a stable error code and can be retried by a person.
- **Cost budget**: at most 12 external calls per job.
- **Limits**: 40 jobs per band per day; per-user rate limits on every route that reaches an
  external service.
- **Cancellation** at any point; a running step never overwrites a cancellation.

## 6. Human review

- Results start as `unreviewed` (sourced) or `needs_review` (an estimate without calibrated
  confidence of at least 0.8). No engine reports calibrated confidence today, so every future
  estimate will start as "review needed" until its confidence has been validated on real songs.
- The band confirms its own tempo, key and meter. Each confirmation writes a `review_events` row
  (who, when, before, after) and updates the band version used by the live session. A confirmed
  tempo removes the "not confirmed" warning in the rehearsal room.
- A job in `awaiting_review` is closed by a person ("Finish review").

## 7. What analysis is really available

| Capability                                   | Today                             | Needs                                |
| -------------------------------------------- | --------------------------------- | ------------------------------------ |
| Identify the exact recording among versions  | **Yes** (MusicBrainz)             | —                                    |
| Duration, release, year, ISRC, artist credit | **Yes**, sourced                  | —                                    |
| Composer / lyricist                          | **When MusicBrainz links a work** | Band input otherwise                 |
| Official video for listening                 | **Yes**, embedded player          | —                                    |
| Links to charts and tabs                     | **Search links only**             | A person opens them                  |
| Tempo (BPM), tempo stability                 | **No**                            | Stage B engine + authorised audio    |
| Key                                          | **No**                            | Stage B                              |
| Meter                                        | **No**                            | Stage B; hard to estimate reliably   |
| Beat / downbeat grid                         | **No**                            | Stage B                              |
| Sections (intro, verse, chorus…)             | **No**                            | Stage B                              |
| Chords                                       | **No**                            | Stage B; lowest expected reliability |
| Stops, breaks, dynamics                      | **No**                            | Stage B/C, mostly human              |

## 8. Candidate libraries and models for stage B

None of these is installed or used. Licences must be re-checked at adoption time. Accuracy
figures in the literature come from benchmark sets dominated by Western pop; they are **not** a
promise for reggae, MPB or live recordings and must be validated on the band's own repertoire.

| Candidate                              | Does                                           | Licence                                  | Runs                | Notes                                                                              |
| -------------------------------------- | ---------------------------------------------- | ---------------------------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| **librosa**                            | Tempo, beat tracking, chroma, onset strength   | ISC                                      | Python              | Good baseline. Tempo octave errors (half/double) are common, especially in reggae. |
| **Essentia / essentia.js**             | Tempo, key, beats, many descriptors            | AGPL-3.0 (commercial licence available)  | C++/Python, WASM    | Strong, but AGPL obligations apply to a network service.                           |
| **madmom**                             | Beat, downbeat, tempo, chords                  | Code BSD; **trained models CC BY-NC-SA** | Python              | Models are non-commercial.                                                         |
| **All-In-One (allin1)**                | Beats, downbeats, tempo, functional sections   | MIT (code); depends on Demucs and madmom | Python, GPU advised | Best single candidate for structure; check the model licences of its dependencies. |
| **Demucs**                             | Source separation (drums, bass, vocals, other) | MIT                                      | Python, GPU advised | Helps bass-line and drum analysis; heavy.                                          |
| **Basic Pitch**                        | Polyphonic note transcription                  | Apache-2.0                               | Python, TF.js       | Useful for a bass-line draft after separation.                                     |
| **MSAF**                               | Structural segmentation                        | MIT                                      | Python              | Boundaries without section names.                                                  |
| **Chordino / NNLS Chroma**             | Chord estimation                               | GPL                                      | Vamp plugin         | Major/minor triads are fair; extended chords are not.                              |
| **aubio**                              | Onset, tempo, pitch                            | GPL-3.0                                  | C/Python            | Light.                                                                             |
| **Meyda**, **web-audio-beat-detector** | Features and tempo in the browser              | MIT                                      | Browser             | Enough for a first in-browser tempo estimate.                                      |

Realistic expectations, to be confirmed by our own tests: tempo is usually right up to a factor
of two; key is right for most tonal pop songs but confuses relative major/minor; section
boundaries are useful drafts; chord labels need human correction; meter, stops and dynamics need
a person.

## 9. Execution strategy on Cloudflare

Heavy audio processing never runs inside an ordinary Worker request (CPU and memory limits, no
native audio libraries). The pipeline already isolates analysis behind steps 2 and 3, so an
engine can be added without changing the job model. Options, in order of preference:

1. **In-browser engine on a file the member provides** (Web Audio + WASM). The file never
   leaves the device unless the member chooses to store it. No server cost. Limits: lighter
   algorithms only (tempo, beats, key); results are estimates, always "review needed".
2. **External analysis service behind the same engine interface** (a container running the
   Python stack). The job hands over a short-lived signed URL of the authorised file and waits
   for a callback, exactly like a step waits today. **This is a paid service and needs explicit
   authorisation before it is created.**
3. **Cloudflare Containers / Workers AI**, if a suitable runtime or model becomes available and
   authorised. Not assumed.

Until one of these exists, steps 2 and 3 report `engine_not_configured`.

## 10. Costs

| Item                                       | Cost today                                                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MusicBrainz web service                    | Free; rate-limited. Commercial products are asked to support MetaBrainz.                                                                                                                       |
| YouTube oEmbed and embedded player         | Free, no API key.                                                                                                                                                                              |
| Workers, D1, R2, Durable Objects (stage A) | Within the free plan at rehearsal scale.                                                                                                                                                       |
| Workers Paid plan                          | US$ 5/month if limits are exceeded (not required by stage A).                                                                                                                                  |
| Analysis service (stage B, option 2)       | **Not contracted.** Depends on provider and hardware (CPU is enough for librosa-class analysis; source separation and structure models want a GPU). To be estimated and authorised before use. |
| Commercial licences (e.g. Essentia)        | Not contracted; only if such a library is chosen.                                                                                                                                              |

No paid service was started for AutoArrange.

## 11. Stages

| Stage | Scope                                                                                                                                                         | Status                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **A** | Identify the recording, sources, connectors, job model, results with origin, human review, wizard, song-sheet panel, live session using confirmed band values | **Done**                                                                              |
| **B** | Authorised audio upload flow in the UI, analysis engine (tempo, beats, key, sections, chords), calibration of confidence on real songs                        | Structure ready (`audio_assets`, steps 2–3, result kinds); engine **not implemented** |
| **C** | Arrangement-map editor: sections on a timeline, cues, stops                                                                                                   | Columns ready; editor not implemented                                                 |
| **D** | Per-instrument views: harmony per section, bass and drum drafts                                                                                               | Table ready (`song_harmony`); not implemented                                         |
| **E** | Live session follows the map (current section, next cue), full homologation                                                                                   | Not implemented (live already uses the band's confirmed tempo and meter)              |

## 12. API

All under `/api/bands/:bandId/autoarrange`, authenticated members only; writes need permission to
edit the repertoire.

| Method and path                                                        | Purpose                                                                                                   |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /connectors`                                                      | Source registry and engine state.                                                                         |
| `GET /search?title=&artist=`                                           | Recording candidates (one per recording, not per song).                                                   |
| `GET /recordings/:mbid`                                                | One recording: releases, ISRCs, works, writers, default release.                                          |
| `POST /reference/identify`                                             | Identify a pasted link (YouTube, YouTube Music, Spotify). `POST /youtube` is the older YouTube-only form. |
| `PUT /songs/:songId/reference/link` · `PATCH /songs/:songId/reference` | Change the link of the reference recording; correct its title or artist.                                  |
| `POST /prepare`                                                        | Identify, store the reference recording, start a job (or return the active one).                          |
| `GET /jobs/:jobId`                                                     | Job progress.                                                                                             |
| `POST /jobs/:jobId/cancel` · `/retry` · `/complete`                    | Cancel, retry a failed job, finish the review.                                                            |
| `GET /songs/:songId`                                                   | Recordings, jobs, results, reviews, authorised audio, confirmations.                                      |
| `POST /songs/:songId/review`                                           | Confirm, edit or reject a result or a band value.                                                         |
| `POST /songs/:songId/audio-assets`                                     | Register an uploaded file as authorised audio (requires the rights declaration).                          |

Errors use the stable codes of the rest of the API; `upstream_unavailable` (503) means a source
did not answer and the person may try again.

## 13. Known limitations

- No audio analysis. BPM, key, meter, sections and chords are whatever the band types.
- Authorised audio can be uploaded from the song page (with a rights declaration) and is tied to
  the reference recording, but no engine reads the file: the page reports "analysis pending".
- MusicBrainz may throttle shared cloud addresses; the gateway retries and, if it still fails,
  the app says the source is unavailable.
- Search finds what MusicBrainz catalogues. A recording missing there can be entered by hand
  ("Register manually" in the wizard); it then has no identifier and nothing is read from a source.
- Whether the embedded player works depends on the video owner's settings and on the device
  being able to reach YouTube.
- Pending workspaces follow the instruments of the band's members at preparation time.

## 14. Tests

- `packages/shared/test/autoarrange.test.ts` — query building, normalisation, release choice,
  YouTube URL parsing, job state machine, against captured real MusicBrainz/YouTube responses.
- `apps/api/test/autoarrange.test.ts` — routes, gateway spacing/retry/cache, job runner
  (retry, failure, cancel, budget, dedupe), review trail, permissions, with a fake outbound
  service replaying the same captures.
- `e2e/tests/autoarrange.spec.ts` — adding by link, reference shown to every member, live
  rehearsal on two devices, replacement, and the catalogue search in Portuguese on a phone,
  against a local stub of the external services. Reference-link tests are listed in
  `REFERENCE_RECORDING.md` §11.
- `e2e/staging/homologation.staging.ts` — the same flow against the real services on staging.

## 15. Applying it to the real repertoire

See [`REFERENCE_RECORDING.md`](REFERENCE_RECORDING.md) §9. `apps/api/scripts/prepare-real-repertoire.mjs`
sets the reference of the three real songs through the API: _Pérola Negra_ with its confirmed
YouTube link; _Esotérico_ (_Um Banda Um_) and _O Segundo Sol_ (_Cássia Reggae, Vol. 1_) with the
link pending, because no exact link was confirmed. It is idempotent and never changes the band's
own values.

## 16. Listening to the reference (stage B, first part)

A link to YouTube or Spotify can never be downloaded or analysed (platform terms; Spotify also
closed its audio-analysis API to new apps in 2024). BandSync listens in the two ways that are
allowed, both free and on the member's device:

| Input                                           | How                                                                                                                                                                               | Kept                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Microphone** ("Ouvir pelo microfone")         | The member plays the reference (in the app's player, another device or a speaker). The device listens for 15–60 s with echo cancellation, noise suppression and gain control off. | Nothing: the audio is analysed and discarded; only the results are sent. |
| **Authorised file** ("Enviar áudio autorizado") | A file the band declares it may process (own recording, licensed, permission from the owner). Analysed right after the upload, or later with "Analisar".                          | The file, as before, tied to the reference recording.                    |

**Engine** (`packages/shared/src/analysis/analyze.ts`, `bandsync-browser` `listen-v1`, no
dependencies, runs in a Web Worker): mono 11 025 Hz; spectral-flux onset envelope; tempo from its
autocorrelation with a log-normal prior around 120 BPM; beats by dynamic programming (Ellis 2007)
with sub-frame refinement and a line fit for the final tempo; meter from where the strongest
low-frequency accents fall in groups of 2, 3 or 4 beats; key from the chroma profile against the
Krumhansl–Kessler profiles; tempo stability from ~10 s windows. About 0.5 s for a 4-minute song.

**What is stored** (`POST /songs/:songId/analysis`, migration `0005_analysis_input.sql`): one
`analysis_results` row per kind (`bpm`, `tempo_ambiguity`, `tempo_stability`, `time_signature`,
`key`, `beats`) with `origin = audio_analysis`, method `bandsync-browser.microphone` or
`.audio_file`, the engine version, how many seconds were analysed, the file when there is one,
who ran it, the reference recording, `confidence = null`, `confidence_calibrated = false` and
review state **needs review**. The band's tempo, key and meter are never filled in by it.

**Review**: under each band value the latest estimates appear as suggestions ("Estimativa: 96 BPM
· ou 48 BPM · Revisão necessária"). Tapping one fills the field; nothing is saved until "Confirmar".
The estimate is then marked confirmed (same value) or corrected (another value), with who and when;
the original estimate is kept.

**Measured** on synthetic grooves with a known answer (`packages/shared/test/analysis.test.ts`):
tempo within 0.3 BPM from 72 to 140 BPM, also through room noise; 4/4 and 3/4; keys C, D, Am, Em,
F#m, with the relative key among the candidates; tempo drift detected; silence and clips shorter
than 8 s refused. In the browser, with Chromium's fake microphone playing a synthetic groove,
the app finds 96 BPM, A minor and 4/4 (`e2e/tests/listen.spec.ts`).

**Not yet known**: accuracy on real recordings. No real song was available to measure, so the
confidence is not calibrated and every value needs review. Expected weak points: half/double tempo
(both readings are always shown — the band chooses, which matters for reggae), relative
major/minor, compound meters such as 6/8, songs without a steady pulse, quiet or noisy rooms.
Chords and section boundaries are the next part of stage B.

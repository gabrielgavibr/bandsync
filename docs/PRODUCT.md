# BandSync — Product

## Vision

BandSync is the digital control room of a band during preparation, rehearsal and performance. It replaces the pile of PDFs, group-chat messages and personal metronomes with one shared place: the band's songs in _its own_ arrangement, the material each musician needs, who is in the band and what they may do, and a live rehearsal room that keeps everyone on the same song and the same tempo.

The guiding premise: **the song is collective, the view is individual.**

BandSync is for musicians who are physically together. It never streams instrument audio over the network and is not a remote-jamming product.

## Personas

| Persona                                | Needs                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Drummer / musical director (conductor) | Choose the song for everyone, set the tempo, count in, see the arrangement map, hand over control when needed               |
| Bassist / guitarist                    | Open the rehearsal and immediately see their tab or chord chart, in the key the band plays, large enough to read on a phone |
| Vocalist                               | Lyrics (optionally with chords), no clutter                                                                                 |
| Keys / horns                           | Chords or sheet music (PDF) for their part                                                                                  |
| Band admin                             | Invite people, set permissions, keep the repertoire tidy, know who can conduct                                              |
| Musician in several bands              | One account, bands kept apart, preferences (language, notation, preferred material) follow the account                      |

## The live rehearsal (Ensaio ao vivo)

1. Someone allowed to conduct starts a session, optionally tied to a repertoire.
2. Everyone joins from their own phone or tablet. The first participant allowed to conduct becomes the conductor.
3. The conductor picks a song. The server loads the band's version (BPM, meter, key) and broadcasts it.
4. Each device resolves the material for its musician: explicit preference, then the default order for the instrument, then any material tagged for the instrument, then lyrics/chords.
5. The conductor starts. The server schedules the start a couple of seconds in the future on its own clock; every device converts that instant into its local audio timeline and plays the count-in and the click itself. No audio crosses the network.
6. Reading actions (zoom, switching material, transposing the displayed chart) are local and never affect other devices. Muting your own click is also local to you, while the shared timeline keeps running.
7. If the conductor disconnects, the role is held for 90 s; anyone allowed to conduct may take over immediately, and after the grace period the role is released automatically.

## Features by module

Status legend: **Done** (implemented and covered by automated tests), **Partial** (implemented with known gaps), **Planned** (designed and/or tables exist, no API or UI yet).

### Accounts and authentication

| Feature                                                                                                                           | Status                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Register with e-mail and password, sign in, sign out                                                                              | Done                                                                                        |
| Password recovery flow (token, single use, 1 h expiry, revokes other sessions)                                                    | Done — e-mail delivery depends on a provider; in development the link is returned to the UI |
| Display name, main and secondary instruments, photo URL                                                                           | Done                                                                                        |
| Preferences: language, theme, note names (C D E / Dó Ré Mi), preferred material per instrument, click sound and volume, time zone | Done                                                                                        |
| Social login                                                                                                                      | Planned                                                                                     |
| E-mail verification                                                                                                               | Planned                                                                                     |

### My bands

| Feature                                                                                      | Status                                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Create a band (creator becomes admin), list my bands, band overview                          | Done                                                                                              |
| Edit band name, description, genre, image URL                                                | Done (API; UI for editing band details is minimal)                                                |
| Members list, roles admin/member, instrument per band                                        | Done                                                                                              |
| Granular permissions: edit repertoire, manage events, conduct rehearsals, post announcements | Done (enforced in the backend; manage events/post announcements have no features behind them yet) |
| Invitations by code, private link or e-mail; expiry, max uses, revoke, usage status          | Done (e-mail sending needs a provider)                                                            |
| SMS / messaging invitations                                                                  | Planned (invite model is channel-agnostic)                                                        |
| Leave band, remove member, last-admin protection                                             | Done                                                                                              |

### Repertoire

| Feature                                                                                                                                                          | Status                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Songs: title, artist, album, external id, duration, original BPM and key                                                                                         | Done                                                               |
| Band version independent from the original: BPM, key, meter, notes, reference link                                                                               | Done                                                               |
| Arrangement map: ordered sections with bar counts and notes                                                                                                      | Done (shown as shared information; no automatic section following) |
| Materials per instrument: lyrics, chords, guitar/bass tab, drum map, arrangement map, notes (text); PDF, sheet music, audio (file in R2); video reference (link) | Done                                                               |
| Material versions (counter incremented on edit)                                                                                                                  | Done                                                               |
| Preferred material per musician                                                                                                                                  | Done                                                               |
| Repertoires of several kinds (general, rehearsal, setlist, in preparation, custom), ordered, song shared across lists                                            | Done                                                               |
| Song search / metadata suggestions (MusicBrainz or similar)                                                                                                      | Planned (no external fetch yet)                                    |
| Licensed chord/tab integrations                                                                                                                                  | Planned; no scraping by design                                     |

### Live rehearsal

| Feature                                                                                                                                           | Status                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Session states: created, waiting, ready, counting in, playing, paused, ended                                                                      | Done                                                                      |
| Conductor: participants, repertoire and song selection, next/previous, BPM (+/−, tap), meter, count-in, subdivision, click mode, transfer, end    | Done                                                                      |
| Member: current song, own material, BPM/meter, status, connection, zoom, material switch, transposed display, click on/off and volume, ready flag | Done                                                                      |
| Late join and reconnection with full snapshot                                                                                                     | Done                                                                      |
| Monotonic `seq` so stale events are ignored                                                                                                       | Done                                                                      |
| Conductor loss handling (grace period, take-over)                                                                                                 | Done                                                                      |
| Sync diagnostics (offset, RTT, jitter, quality)                                                                                                   | Done                                                                      |
| Click modes: synced (every device) and central (one device)                                                                                       | Done in the protocol and UI; central mode not yet tested on real hardware |
| Personal notes inside the room                                                                                                                    | Planned                                                                   |

### Metronome

| Feature                                                                                    | Status                                               |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Web Audio lookahead scheduling, accent, subdivisions, count-in, three click sounds, volume | Done                                                 |
| Stand-alone metronome in Tools                                                             | Done                                                 |
| Clock-sync protocol and scheduled start                                                    | Done                                                 |
| Measured acoustic simultaneity between real devices                                        | **Not done** — see `AUDIO_SYNC.md` for the procedure |

### Calendar, board, tasks, recordings

| Feature                                                 | Status                                        |
| ------------------------------------------------------- | --------------------------------------------- |
| Events with attendance (confirmed / declined / pending) | Planned (tables `events`, `event_attendance`) |
| Announcements: informative, acknowledgement, poll       | Planned (tables exist)                        |
| Musical tasks ("my preparation")                        | Planned (table exists)                        |
| Rehearsal recordings and markers                        | Planned                                       |

### Tools

| Feature                                                                                     | Status                                                                               |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Metronome                                                                                   | Done                                                                                 |
| Transposer for text chord charts (chords over lyrics and inline `[C]`), English/Latin names | Done                                                                                 |
| Chromatic tuner (microphone, autocorrelation)                                               | Done (requires HTTPS or localhost)                                                   |
| Reader                                                                                      | Partial — the material viewer is the reader; auto-scroll and annotations are planned |

## Core acceptance criteria

The master specification lists 15 criteria for the first live-rehearsal implementation. Current status:

| #   | Criterion                                               | Status          | Evidence                                                                                                                 |
| --- | ------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Two users open the same session on different devices    | Done            | e2e `live-rehearsal.spec.ts` (desktop + iPhone emulation), API test `rehearsal.test.ts`                                  |
| 2   | An authorised user takes control of the session         | Done            | auto-assignment, `claim_conductor`, take-over after disconnect                                                           |
| 3   | Conductor selects a song                                | Done            | `set_song`, `next_song`, `prev_song`                                                                                     |
| 4   | Selection appears automatically on the second device    | Done            | e2e asserts title on the member device without reload                                                                    |
| 5   | Each member sees a different material for the same song | Done            | e2e: drummer sees drum map, bassist sees bass tab                                                                        |
| 6   | BPM and meter loaded from the band version              | Done            | 100 BPM 4/4 vs 140 BPM; 3/4 case in API tests                                                                            |
| 7   | Conductor schedules a count-in and starts the metronome | Done            | `start` with `leadMs`; count-in → playing observed on both devices                                                       |
| 8   | Devices receive the same time reference                 | Done            | identical `anchor` asserted on both sockets                                                                              |
| 9   | Client plays the metronome locally, no audio streaming  | Done            | Web Audio scheduler per device                                                                                           |
| 10  | Basic sync-quality information recorded and shown       | Done            | diagnostics dialog: offset, RTT, jitter, samples, quality                                                                |
| 11  | Connection loss and recovery leave no inconsistent UI   | Done (software) | reconnect banner, snapshot replaces state, REST poll detects ended sessions; tested with reload and conductor disconnect |
| 12  | A member can disable audio without stopping the others  | Done            | `set_audio` is per participant; timeline unaffected                                                                      |
| 13  | Local navigation does not affect other users            | Done            | e2e asserts zoom/material switch on one device only                                                                      |
| 14  | Mobile layout                                           | Done            | room designed mobile-first; e2e runs the member on iPhone 13 emulation                                                   |
| 15  | Automated tests for state and sync flows                | Done            | 24 shared unit tests, 28 Worker tests (7 WebSocket), 17 web tests, 5 e2e                                                 |

**Acoustic simultaneity between real devices has not been validated.** Receiving the same command and the same timeline proves logical synchronisation only. The experimental procedure to measure real inter-device offset is described in `docs/AUDIO_SYNC.md` and is the first task of Phase 5.

## Non-goals (for now)

- Remote rehearsals or audio streaming between musicians.
- Fetching copyrighted lyrics, chords or tabs from third parties.
- Guessing BPM or key automatically; these are always entered and confirmed by the band.

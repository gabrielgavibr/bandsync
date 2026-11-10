# Mobile UX 2.0 and the tuner

A refinement pass for phones (iPhone first, Android compatible). No architecture, database
schema of features, synchronisation or AutoArrange logic was changed; the live room keeps the
bottom sheet and focus mode it already had.

## What was wrong (measured at 390 × 664, the iPhone 13 viewport)

- Page headers took about 300 px before any content: large title, a paragraph of explanation and
  full-size buttons stacked.
- Two navigations at once: a horizontally scrolling tab strip at the top (cut off after three
  tabs) and the bottom bar.
- One tall card per item in every list (songs, repertoires, members).
- Two real sideways overflows: the members list cut off its "Edit" control, and the tools page
  was wider than the screen.

## Design rules now shared by every screen

| Rule                                                                                                                                                                | Where                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Header: one compact line on phones (title + actions); the explanatory subtitle shows from `sm` up                                                                   | `PageHeader`                            |
| Lists are grouped rows (min 52 px), not one card per item                                                                                                           | `RowList`, `rowClass`                   |
| A card never widens its container (`min-w-0`); single-column grids are `grid-cols-1`                                                                                | `Card`, page grids                      |
| Touch targets at least 44 × 44 CSS px                                                                                                                               | icon buttons `size-11`, rows `min-h-13` |
| One bottom bar: the app's (Home, Bands, Tools, Profile) or, inside a band, the band's (Band, Rehearsal, Songs, Repertoires, Members); the header's arrow leads back | `AppShell`                              |
| The live room has neither bar nor credit: its own sheet                                                                                                             | route outside `AppShell`                |
| The way into the rehearsal is one block that says what the tap will do                                                                                              | `LiveEntryCard`                         |

## Screens

- **Home (`/`)** — "continue where you left off" (last band opened on this device, its
  rehearsal, shortcuts to its repertoires and songs), my bands as rows (members, role, a live
  mark when a session is running), tools. No next-event line: the calendar has no data yet, and
  nothing is invented.
- **Bands (`/bands`)** — all bands as rows; create / use an invite.
- **Band** — identity, rehearsal entry, the repertoire in use (the running session's, else the
  first) with "Ensaiar", then Songs / Repertoires / Members / Tools as rows with counts, then
  the last three sessions.
- **Songs** — rows: thumbnail, title (two lines before cutting), artist, the band's confirmed
  BPM (or "sem BPM"), key, marks for "has a reference" and "has an arrangement".
- **Repertoire** — numbered rows with tempo and key inline; reorder and remove stay.
- **Members** — avatar, name, instrument, role; the edit control is an icon at the row's end.
- **Rehearsal lobby** — four states, each explained: start (you will conduct), join (you enter as
  a musician), resume (you started it), none (wait for the conductor); the last ended session
  is named.
- **Tools** — one tool at a time on phones (`/tools?tool=metronome|tuner|transposer`); larger
  screens show all three.

## Tuner

### Why it needed the instrument next to the phone

Read from the code (not measured on a physical iPhone):

1. A **fixed level cut-off**: anything quieter than -40 dBFS was not analysed. The tuner
   rightly opens the microphone with the browser's voice processing off (automatic gain, noise
   suppression and echo cancellation distort or erase sustained notes), and without that
   processing a phone delivers an acoustic instrument at arm's length well below -40 dBFS.
2. A 43 ms window and a 50 Hz lower limit: the low E of a bass (41 Hz) could not be detected.
3. No stabilisation: the reading vanished on any failed frame and a running average slid
   through wrong notes after an octave slip.

### What changed (`lib/audio/pitch.ts`, `lib/audio/tuner.ts`)

- **YIN** pitch detection, independent of loudness, over a 170 ms window: search at ~12 kHz,
  refinement at full rate. 27 Hz to 1.6 kHz, within about 2 cents on test tones.
- **Level is judged against the room**, not a fixed number: the noise floor is tracked all the
  time; a sound is analysed when it stands above it by a margin.
- **Sensitivity** (Low / Normal / High, and a fine slider) moves four real thresholds: the
  margin above room noise (16 → 4 dB), the quietest level accepted (-46 → -80 dBFS), how
  periodic the sound must be (0.93 → 0.72), and how many readings must agree before a note is
  shown (2 → 4). A page cannot change the microphone's hardware gain, and multiplying samples
  would raise noise and note alike, so no digital gain is applied to detection.
- **Stability**: a new note must repeat before it replaces the shown one; a jump of an octave
  (or a twelfth) needs twice the agreement; the shown frequency is a median of the last
  readings; the reading is held for 450 ms through a dip; the attack of a pluck is skipped.
- **Input meter**: level, the mark of the minimum level analysed, and a label about loudness
  only (no signal / weak / good / too strong), kept apart from whether a note was found.
- **States**: waiting for the microphone, listening, weak signal, note detected, sound without
  a clear note, signal too strong, microphone unavailable; a hint when the room is noisy.
- **Per-person settings** saved with the account (migration `0007_tuner_preferences.sql`):
  sensitivity and the reference pitch (A4 = 415–466 Hz).

### Measured (`apps/web/test/tuner.test.ts`, `e2e/tests/tuner.spec.ts`)

Synthetic plucked-string notes with a known answer, with room noise:

| Case                                                             | Result                              |
| ---------------------------------------------------------------- | ----------------------------------- |
| A2 at -58 dBFS (18 dB below the old cut-off), normal sensitivity | read as A2, within 4 cents          |
| Same note, low sensitivity                                       | not read; state "weak signal"       |
| Bass E1 (41 Hz) … guitar E4, at -40 dBFS                         | each read as its own note           |
| Room noise alone (-72, -50, -38 dBFS), any sensitivity           | no note                             |
| Knocks / claps                                                   | no note                             |
| Decaying bass note whose 2nd harmonic dominates                  | one note throughout, no octave flip |
| Change of note                                                   | shown once, within 0.4 s            |
| Saturated input                                                  | flagged "too strong"                |

In the browser (Chromium's fake microphone, phone viewport): the weak A2 is read at Normal, not
at Low ("Sinal fraco"), read again and steady at High; settings survive a reload.

**Not done:** no test on a physical iPhone or Android, and no real instrument recordings (the
licensed recordings in the repository are full mixes, not single notes). Sensitivity defaults and
the room-noise behaviour should be confirmed on the real devices.

# BandSync — Testing

## Suites at a glance

| Suite             | Command                               | Runtime                                                                                                | Count | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared` | `pnpm --filter @bandsync/shared test` | Vitest, Node                                                                                           | 99    | note/key parsing in both notations, chord parsing and transposition, chord-sheet layout preservation, clock estimator (offset recovery, outlier rejection, quality), metronome timeline (count-in, clicks, subdivisions, bar-aligned retime), protocol schemas and `deriveStatus`; AutoArrange: MusicBrainz query building and normalisation, release choice, YouTube URL parsing, job state machine (against captured real responses); **reference links**: parsing of YouTube, YouTube Music and Spotify links, refusal of dangerous schemes, look-alike hosts and non-recording links, player and endpoint addresses, thumbnails, real and hostile oEmbed answers                                |
| `apps/api`        | `pnpm --filter @bandsync/api test`    | Vitest inside workerd (`@cloudflare/vitest-plugin`), real D1/R2/DO bindings, isolated storage per test | 97    | auth (register, validation codes, duplicates, login, logout, reset flow, e-mail non-disclosure, profile/preferences, Origin check, rate limiting), bands/members/invites/permissions, songs/materials/repertoires, R2 files, and **7 WebSocket tests** of the live session; **AutoArrange**: recording search and lookup, gateway cache and throttling, YouTube validation, preparation jobs (retry, attempt limit, budget, cancel, dedupe), review trail, authorised-audio declaration, source registry; **reference recording**: identify by link, song from a link, same reference for every member, replacement with confirmation, link added to a catalogue recording, corrections and history |
| `apps/web`        | `pnpm --filter @bandsync/web test`    | Vitest, jsdom                                                                                          | 62    | locale key parity, empty strings, placeholder parity, locale resolution, live language switch, Intl formatting, material resolution, metronome scheduler (exact instants, offset use, freeze handling, silent mode), socket client (seq ordering, pings/pongs, reconnect, ended)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `e2e`             | `pnpm test:e2e`                       | Playwright 1.63, Chromium                                                                              | 21    | UI registration → band → invite → join; pt-BR account and live switch; wrong credentials; **two-device live rehearsal**; permission to start a session; real repertoire import and live switching; **AutoArrange wizard** end to end (recording versions, prepare, review, repertoire, song sheet, live rehearsal) and on an existing song in pt-BR on a phone; **reference by link** in the browser (refused links, YouTube and Spotify, second member on a phone, repertoire, live room, replacement warning, authorised audio upload)                                                                                                                                                            |

Run everything except e2e:

```bash
pnpm test
```

Typecheck and lint:

```bash
pnpm typecheck
```

```bash
pnpm lint
```

## Worker tests

Test files of the Worker run one at a time (`fileParallelism: false`): the fake external services live in the Node process and are shared by every file, including the switch that makes the next requests fail, so parallel files could see each other's simulated outage.

`apps/api/vitest.config.ts` uses `cloudflareTest` with `wrangler.jsonc`, binds `APP_ENV=test` and `PBKDF2_ITERATIONS=1000` (fast hashing), and loads the D1 migrations through `test/apply-migrations.ts` before each file. `wrangler types` runs before the suite to generate `worker-configuration.d.ts` (git-ignored).

The live-session tests (`test/rehearsal.test.ts`) open real WebSockets against the Durable Object through `SELF.fetch` with `Upgrade: websocket`, use a small `Client` helper that waits for messages from a cursor, and exercise: conductor auto-assignment, authorisation errors, song propagation with bpm/meter, repertoire navigation, `seq` monotonicity, scheduled start anchors, bar-aligned tempo changes, per-member mute, late-join snapshots, REST/DO consistency, transfer/claim/grace, alarms (`runDurableObjectAlarm`) and session end.

### Rate limiting in tests

Under `APP_ENV=test` the per-IP limiter is skipped so suites can create many users. The test `auth.test.ts › rate limiting` opts in by sending `x-test-ratelimit: 1` together with a fixed `cf-connecting-ip`.

## AutoArrange 3.0 tests

- `packages/shared/test/prearrange*.test.ts`: the pre-arrangement engine on synthetic forms with a known answer and on real recordings (public domain / CC BY, `test/fixtures/audio/ATTRIBUTION.md`; decoded with `ffmpeg`, installed in CI).
- `apps/api/test/prearrangement.test.ts`: storage of pre-arrangements, the band's arrangement saved without touching them, member marks, player duration, Deezer discovery (ISRC, title + length, once), files of songs with no reference, validation, permissions.
- `apps/web/test/arrangement.test.ts`: the editing model and the marks → map conversion.
- `e2e/tests/prearrangement.spec.ts`: the whole flow in the browser; the YouTube IFrame API script is replaced by a stand-in (`context.route`), the audio analysis runs on a montage of the real recordings.

## AutoArrange 3.1 tests

- `packages/shared/test/structure-compare.test.ts` runs the previous structure analysis (kept in `structure-v1.ts`) and the current one on the same audio with a known answer and prints the comparison; it fails if the new one finds fewer true boundaries or more false ones on any case.
- `apps/api/test/files.test.ts`: byte ranges of private files and their permissions.
- `e2e/tests/prearrangement.spec.ts` (third test): the section player and time editing on a real recording.
- Staging checks never write to the band people use: see `STAGING.md` (Verify).

## Live rehearsal on a phone

`e2e/tests/live-mobile.spec.ts` runs the room at iPhone size (conductor and musician): the bottom sheet in its three states (one row, playing controls, everything), dragging the handle, play/stop and the click switch from the minimised row, tempo and song navigation, focus mode (material alone, zoom, the pill that brings the controls back), no sideways overflow, and that the material takes more than 72 % of the screen with the sheet minimised (measured on an iPhone 13 viewport: 83 %, against 32 % with the previous fixed panel). A second test checks that larger screens keep the full panel.

## Mobile UI and tuner

- `e2e/tests/mobile-ui.spec.ts`: home, the single bottom bar (app / band), band page, compact lists, members, the four states of the way into the rehearsal, tools; no sideways overflow at 320, 390, 430 px and sideways (844 × 390); pt-BR and en; no raw translation key on screen.
- `apps/web/test/tuner.test.ts`: the tuner's engine on signals with a known answer (weak, adequate, saturated, noise, low register, stability, reference pitch).
- `e2e/tests/tuner.spec.ts`: the tuner in the browser with Chromium's fake microphone; preferences persisted.
- See `MOBILE_UX.md`. None of this replaces a check on physical phones.

## Web tests

`apps/web/test/i18n.test.tsx` is the guard for the "both languages or not done" rule: it flattens every namespace of `en` and `pt-BR` and fails if a key exists in only one, if any string is empty, or if `{{placeholders}}` differ. It also renders a component, switches the language at runtime and checks `<html lang>` and `localStorage`.

The scheduler test uses fake timers and a fake engine whose audio clock equals `performance.now()/1000`, so expected click instants can be asserted exactly.

## End-to-end tests

```bash
pnpm test:e2e
```

`e2e/playwright.config.ts` starts both dev servers (`webServer`, `reuseExistingServer: true`) and runs with `--autoplay-policy=no-user-gesture-required` so the Web Audio click can start in headless mode. Tests create their own users through the API (`e2e/tests/helpers.ts`), copying the session cookie into browser contexts, and give each user a distinct `x-forwarded-for` so the registration limiter is not shared.

In this cloud container only, point Playwright at the pre-installed browser:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e
```

On a normal machine run `pnpm exec playwright install chromium` once inside `e2e/` and omit the variable.

External services in e2e: a local `workerd` cannot reach the internet from every environment and tests must not depend on MusicBrainz being up, so `e2e/stubs/music-services.ts` (port 8790) replays the captured MusicBrainz, YouTube and Spotify oEmbed responses from `packages/shared/test/fixtures/musicbrainz/`, and the API is started with `pnpm --filter @bandsync/api dev:e2e`, which points `MUSICBRAINZ_BASE_URL`, `YOUTUBE_OEMBED_BASE` and `SPOTIFY_OEMBED_BASE` at the stub. The Worker tests use the same captures through `test/outbound.ts`. The real services are exercised only by the staging check (`e2e/staging/homologation.staging.ts`).

The live-rehearsal spec runs the conductor on a desktop viewport and the bassist on iPhone 13 emulation and saves `e2e/test-results/member-mobile.png` and `conductor-desktop.png`.

## Testing on two real phones

1. Start everything on a laptop on the same Wi-Fi: `pnpm dev`. Vite already listens on all interfaces (`--host`); use the **Network** URL it prints (for example `http://192.168.1.20:5173`).
2. On each phone open that URL, sign in as a different band member (demo accounts in the README, or create a band and invite with a code).
3. Open the band → **Live rehearsal** → start a session on the conductor's phone; join from the other phone (dashboard shows "Live rehearsal in progress").
4. Tap **Enable sound** on both; iOS Safari and Android Chrome require this gesture.
5. Keep screens on. Background tabs throttle timers and iOS suspends audio on lock; the UI will show the suspended state.

Notes:

- Web Audio works over plain `http://` on the LAN. The **tuner** (`getUserMedia`) does not: browsers require HTTPS or `localhost`. For microphone tests use `localhost` on the laptop or a tunnel with HTTPS.
- PWA installation also requires HTTPS; on the LAN you can still use the site in the browser.
- To test from a phone against a deployed Worker, follow `DEPLOYMENT.md`.

## Manual checklist for the live room

- [ ] Two devices show the same participant count; both show the conductor's name.
- [ ] Conductor picks a song → title, BPM, meter and key appear on all devices without reload.
- [ ] Drummer sees the drum map; bassist sees the bass tab; vocalist sees lyrics (default preference), and a user preference changes it.
- [ ] Zooming, switching material or transposing on one device changes nothing on the others.
- [ ] Start → count-in dots in amber, then bar/beat indication; status badge goes "Count-in" → "Playing" on every device at the end of the count-in.
- [ ] Click off on one device: its sound stops, its badge shows "click muted" to the conductor, the others keep clicking.
- [ ] Tempo +/− or Tap while playing: the change lands on the next bar without a stutter.
- [ ] Meter change while playing stops the metronome; Start again works.
- [ ] Next/previous song follows the repertoire order and disables at the edges.
- [ ] Switch to **Central click**: only the chosen device sounds; others still show the beat.
- [ ] Put a member's phone in airplane mode for 10 s: banner "Connection lost", then "Reconnected" state restores song and tempo; no second metronome, no stale commands.
- [ ] Close the conductor's browser: within seconds members see "The conductor is offline" and a member allowed to conduct can take over; after 90 s the role is released automatically.
- [ ] End session: everyone sees "Session ended"; the lobby allows starting a new one.
- [ ] Sync dialog shows samples, offset, RTT, jitter and a quality badge; Re-measure resets them.
- [ ] Switch language in Profile: the room and lobby texts change immediately; reload keeps the account's language.

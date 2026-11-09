# BandSync — Audio synchronisation

How several phones in one room play the same click at the same time, and how we know whether they actually do.

> **Status.** The protocol, estimator, timeline model and scheduler described here are implemented and unit-tested. **Acoustic simultaneity between real devices has not been measured yet.** Until the calibration procedure at the end of this document has been run on real phones, BandSync should be used with the _central click_ mode whenever precise shared audio matters.

## 1. Problem

- A WebSocket "play" message reaches each phone at a different time (network jitter of tens of ms, more on Wi-Fi).
- Each phone's clock is different from the server's and from each other's.
- `setTimeout`/`setInterval` jitter in browsers is several ms, and much worse when a tab is throttled.
- Each device adds its own output latency (Bluetooth can add 100–250 ms).

Sending "play now" and hoping is not acceptable. Instead the server publishes **when** on **its** clock, and each device converts that instant into its own audio clock.

## 2. Clock offset estimation

Implemented in `packages/shared/src/sync/clock.ts` (`ClockEstimator`) and driven by `RehearsalSocket`.

Each `ping`/`pong` round trip yields four timestamps:

```
t0  client sends ping         (client clock)
t1  server receives           (server clock)
t2  server sends pong         (server clock)
t3  client receives pong      (client clock)

offset = ((t1 − t0) + (t2 − t3)) / 2      // serverTime − clientTime
rtt    = (t3 − t0) − (t2 − t1)
```

- Window of the last **16** samples.
- Outliers: any sample whose RTT exceeds `minRTT × 1.5 + 5 ms` is ignored for the offset (queued packets, GC pauses, radio wake-ups). Samples with negative RTT are discarded.
- Offset = **median** of the accepted samples' offsets.
- Jitter = max − min of accepted offsets.
- Quality (`qualityFor`):

| Quality   | Condition                           |
| --------- | ----------------------------------- |
| `unknown` | fewer than 3 samples                |
| `good`    | min RTT ≤ 60 ms and jitter ≤ 8 ms   |
| `fair`    | min RTT ≤ 200 ms and jitter ≤ 30 ms |
| `poor`    | otherwise                           |

Ping cadence: **8 pings every 300 ms** right after connecting (fast convergence), then every **2 s** until 20 pings, then every **10 s** as keep-alive and drift tracking. Coming back from the background (`visibilitychange`) triggers a fresh burst (`resync`). The first `snapshot` also carries `serverNow`, used as a rough initial offset before pongs arrive.

The server time is `Date.now()` inside the Durable Object. Note that in Workers `Date.now()` only advances on I/O; inside a single message handler it is effectively frozen, which is fine because `t1` and `t2` are taken within the same handler and the asymmetry is sub-millisecond.

## 3. Timeline model: the tempo anchor

Implemented in `packages/shared/src/sync/metronome.ts`.

Instead of "start at T, then every 500 ms", the running timeline is one **anchor**:

```
anchor = { serverMs, beatIndex, bpm }
beatTime(k) = anchor.serverMs + (k − anchor.beatIndex) × 60000 / anchor.bpm
```

- Beat **0** is the first beat of the song. Negative indices are the count-in (`startAnchor` sets `beatIndex = −countInBars × beatsPerBar`).
- Beats are computed absolutely from the anchor, so there is no accumulated drift and every device computes exactly the same instants.
- `describeBeat(k, beatsPerBar)` gives bar number, beat in bar, accent and whether it is count-in.
- `clicksBetween(anchor, meter, from, to)` enumerates beats and subdivision clicks inside a window; nothing before the count-in start is produced.

**Scheduled start.** `start` sets `anchor.serverMs = serverNow + leadMs` (default **2000 ms**, allowed 300–5000). Two seconds is enough for every connected device to receive the state, convert it and pre-schedule the first clicks before they are due.

**Tempo change while running.** `retimeAtNextBar(anchor, beatsPerBar, newBpm, notBefore)` places a new anchor on the first bar boundary at or after `notBefore` (server uses `now + 400 ms`). Beats before the boundary stay exactly where they were; after it the new tempo applies. During the count-in the change lands on beat 0. The result is a tempo change that is never audible as a hiccup.

**Meter change while running** stops the metronome (the grid would be redefined); the conductor starts again.

## 4. Lookahead scheduler

Implemented in `apps/web/src/lib/audio/MetronomeScheduler.ts` (pattern from "A Tale of Two Clocks").

- A JS timer ticks every **25 ms**. On each tick it enumerates clicks whose _server_ time falls in `[cursor, now + 120 ms)` and schedules each one on the Web Audio clock with sample-accurate `start(when)`. The JS timer never produces sound; its jitter never reaches the ear.
- The cursor advances to the end of the window so no click is scheduled twice.
- Catch-up limit **50 ms**: after a freeze (tab hidden, phone locked) the cursor jumps to `now − 50 ms` instead of firing a burst of stale clicks.
- Clicks more than 5 ms in the past when they reach the engine are dropped, not bunched.
- A new anchor (tempo change) re-plans from the boundary; audibility can be toggled live without stopping (visual indication keeps running).

### Time-domain conversion

```
server ms  ──(− offset)──▶  client wall clock ms (Date.now())
           ──(+ perf − Date)──▶ performance.now() ms
           ──(AudioEngine.perfToAudioTime)──▶ AudioContext seconds
```

`perfToAudioTime` uses `AudioContext.getOutputTimestamp()` (pairs `contextTime` with `performanceTime`) when available, otherwise a one-shot `currentTime`/`performance.now()` sample.

### Visual beat

`useMetronome` records each scheduled beat with its client time and a `requestAnimationFrame` loop promotes it to the display when that time arrives, so the dot flashes when the click sounds, not when it was scheduled 100 ms earlier.

## 5. Audio engine

`apps/web/src/lib/audio/AudioEngine.ts` owns the single `AudioContext` (`latencyHint: "interactive"`), a master gain and three synthesised clicks (no sample files):

| Sound  | Synthesis                                                                          |
| ------ | ---------------------------------------------------------------------------------- |
| `beep` | sine, 1760 Hz accent / 1320 Hz beat / 1046 Hz subdivision, 50 ms exponential decay |
| `wood` | triangle with a fast downward pitch sweep (1800→900 Hz accent), 35 ms              |
| `tick` | 12 ms shaped noise through a band-pass (4 kHz accent / 2.6 kHz)                    |

Accent on beat 1 (level 1.0), beats 0.7, subdivision clicks 0.35.

### Unlock gate (iOS / Android)

Mobile browsers refuse to start audio without a user gesture. The room shows an **Enable sound** overlay whenever the musician has the click enabled and the engine is not `ready`. `unlock()` creates/resumes the context inside the tap handler and plays a silent buffer (needed on some iOS versions). Status values: `idle`, `locked`, `ready`, `suspended`, `unsupported`.

### Suspension and reliability

The engine listens to `statechange` and `visibilitychange`. If the OS suspends the context (screen lock, phone call, another app taking audio) the status becomes `suspended`, the overlay returns with an explanation, and the diagnostics dialog flags timing as unreliable. BandSync never pretends to be in sync when the context is not running.

`outputLatency()` (`outputLatency + baseLatency`) is shown in diagnostics; above 80 ms the UI warns about Bluetooth headphones and recommends wired output or the central click.

## 6. Modes

| Mode                                        | Where sound comes from                                                                                    | When                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Individual** (Tools → Metronome)          | the device itself, local anchor, offset 0                                                                 | practising alone; same engine and scheduler as the room                                                                                   |
| **Synced** (`clickMode = "synced"`)         | every device with click enabled plays its own clicks on the shared timeline                               | normal rehearsal; each musician controls own on/off and volume                                                                            |
| **Central click** (`clickMode = "central"`) | only `centralUserId`'s device plays; everyone else follows silently with the visual beat and shared state | **recommended** whenever acoustic precision is critical (PA, in-ear monitors, recording) and always until real-device calibration is done |

Muting is per participant (`set_audio`) and never changes the shared timeline.

## 7. Diagnostics shown to users

In the room, the activity icon opens **Sync quality**: connection state, quality badge, clock offset, min/median RTT, jitter, sample count, output latency, current `seq`, a re-measure button, and warnings for Bluetooth-level latency and suspended audio. The help text states explicitly that this measures the clock against the server, not sound against the other phones.

## 8. Known device caveats

- **iOS Safari**: requires the unlock gesture; audio stops when the screen locks; `getOutputTimestamp` may be unavailable on older versions (fallback path).
- **Android Chrome**: timers are throttled aggressively in background tabs; keep the screen on during rehearsal (a wake-lock request is planned).
- **Bluetooth**: 100–250 ms output latency that varies per headset; cannot be compensated reliably → central click.
- **Different output latencies** between phone speakers are typically 10–40 ms and are not compensated yet (see calibration).
- Workers `Date.now()` granularity is ms; sub-ms alignment is not a goal.

## 9. Calibration procedure (to be executed on real phones)

Goal: measure the **acoustic** offset between two devices playing the synced click, decide whether per-device latency compensation is needed, and set honest expectations.

Equipment: two phones (A, B) on the same Wi-Fi running BandSync, a third device recording audio (phone or laptop with a DAW: Audacity, Reaper, GarageBand), a quiet room.

1. Start the API and web app on a laptop (`pnpm dev`), open the LAN URL printed by Vite on both phones, sign in as two members of the same band, join one live session, tap **Enable sound** on both, set click volume to maximum, select the `tick` sound (sharpest transient).
2. Place both phones 30 cm from the recorder microphone, same distance (1 cm ≈ 0.03 ms, so placement is not critical, but keep it equal).
3. On the conductor phone set 120 BPM, 4/4, count-in 1 bar, click mode **synced**. Start recording, press **Start**, let it run 30 s, press **Stop**.
4. Open the recording, zoom to each pair of clicks and measure the time between the onset of phone A's click and phone B's click (positive if B is late). Record at least 10 pairs; compute mean and standard deviation.
5. Note both phones' diagnostics (offset, min RTT, jitter, output latency) at the end of the run.
6. Repeat at 60 and 180 BPM, then once with phone B on Bluetooth headphones (expect a large offset), then once after putting phone B in the background for 10 s and back (expect recovery).
7. Repeat the 120 BPM run with click mode **central** as the reference (one source, no inter-device offset by definition).

Log template (`docs/calibration/` is the suggested place for results):

| Date | Phones (A / B) | Network | BPM | Mode | Mean offset B−A (ms) | Std dev (ms) | A offset/RTT/jitter | B offset/RTT/jitter | A out-lat | B out-lat | Notes |
| ---- | -------------- | ------- | --- | ---- | -------------------- | ------------ | ------------------- | ------------------- | --------- | --------- | ----- |

Acceptance guidance (musical, not absolute):

| Mean inter-device offset   | Verdict                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| ≤ 10 ms, std dev ≤ 5 ms    | Synced mode is usable for rehearsal click                                                                                    |
| 10–25 ms                   | Usable with caution; investigate per-device output latency compensation (subtract `outputLatency()` from the scheduled time) |
| > 25 ms or std dev > 10 ms | Recommend central click; synced mode shows a warning                                                                         |

Follow-ups this procedure will inform: compensating `outputLatency()` per device, a manual per-device offset slider, a screen wake-lock, and tighter quality thresholds. None of these are implemented until measured data justifies them.

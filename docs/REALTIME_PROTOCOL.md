# BandSync — Realtime protocol

The live rehearsal runs over one WebSocket per device, terminated in a Durable Object (`RehearsalSessionDO`, one instance per session). The server is the only authority over the musical state. Clients send commands; the server validates, mutates, increments `seq`, persists and broadcasts the whole state.

Types and Zod schemas live in `packages/shared/src/protocol/rehearsal.ts` and are shared by the Worker and the web app.

## Endpoints

### Creating and listing sessions (REST, Worker)

| Method and path                                                  | Who                               | Effect                                                                                                                 |
| ---------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /api/bands/:bandId/rehearsals`                              | member                            | `{ active, recent }` — the non-ended session (if any) and the last 20                                                  |
| `POST /api/bands/:bandId/rehearsals` `{ repertoireId?, title? }` | member with `canControlRehearsal` | Creates a session (201) or returns the active one (`reused: true`, 200). Inserts the D1 row, then calls the DO `/init` |
| `GET /api/bands/:bandId/rehearsals/:sessionId`                   | member                            | `{ session, live }` where `live` is the DO snapshot (`{ state, serverNow }`) or `null`                                 |
| `GET /api/bands/:bandId/rehearsals/:sessionId/ws`                | member                            | WebSocket upgrade (below). `426` without `Upgrade: websocket`, `409` if the session has ended                          |

### WebSocket hand-off

1. The Worker authenticates the `bs_session` cookie and loads the membership (non-members get 404).
2. It forwards the upgrade to the DO (`idFromName(sessionId)`) adding identity headers:

| Header              | Value                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| `x-bs-user-id`      | user id                                                                          |
| `x-bs-display-name` | URL-encoded display name                                                         |
| `x-bs-instrument`   | band instrument, falling back to the profile's main instrument (omitted if none) |
| `x-bs-avatar`       | URL-encoded avatar URL (optional)                                                |
| `x-bs-admin`        | `1` if the member is a band admin                                                |
| `x-bs-can-control`  | `1` if the member may conduct                                                    |

3. The DO accepts the socket with the Hibernation API (`acceptWebSocket`, tagged by user id), registers the participant, sends a `snapshot` to the new socket and broadcasts a `state` to everyone.

Browsers never call the DO directly. Its internal HTTP surface is:

| Path         | Purpose                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `POST /init` | `{ sessionId, bandId, repertoireId, createdBy }` — creates the initial state (idempotent) and loads the repertoire's song ids |
| `GET /state` | `{ state, serverNow }` for the REST detail route                                                                              |
| `GET /ws`    | the upgrade described above                                                                                                   |

## Session state

```ts
interface SessionState {
  sessionId: string;
  bandId: string;
  status: "created" | "waiting" | "ready" | "counting_in" | "playing" | "paused" | "ended";
  conductorUserId: string | null;
  repertoireId: string | null;
  repertoireSongIds: string[]; // ordered, drives next/prev
  currentSong: {
    songId;
    versionId;
    title;
    artist;
    bpm;
    beatsPerBar;
    beatUnit;
    key;
    repertoireIndex: number | null; // position in repertoireSongIds, or null
  } | null;
  metronome: {
    bpm;
    beatsPerBar;
    beatUnit;
    countInBars;
    subdivision: 1 | 2 | 3 | 4;
    running: boolean;
    anchor: { serverMs; beatIndex; bpm } | null; // see AUDIO_SYNC.md
    startedAtServerMs: number | null;
    clickMode: "synced" | "central";
    centralUserId: string | null;
  };
  participants: {
    userId;
    displayName;
    instrument;
    avatarUrl;
    connected;
    audioEnabled;
    ready;
    isAdmin;
    canControl;
    joinedAt;
    lastSeenAt;
  }[];
  createdAt: number;
  endedAt: number | null;
  seq: number; // monotonic, incremented on every commit
}
```

`status` is recomputed on every commit by `deriveStatus(state, now)`: `ended` sticks; running with the anchor still in the count-in → `counting_in`, otherwise `playing`; a stopped metronome keeps `paused`; no connected participant → `created`; participants but no song → `waiting`; song selected → `ready`. Between commits the **client** re-derives `counting_in`/`playing` locally with the same function and its clock estimate.

## Ordering rules

- Every `state` message carries `state.seq`. A client applies a `state` only if `seq` is strictly greater than the last applied one (`isNewer`). Out-of-order or duplicated messages are dropped.
- A `snapshot` is authoritative and replaces local state regardless of `seq` (it is only sent on connect).
- Commands are not acknowledged individually; the resulting `state` is the acknowledgement. Rejected commands produce an `error` carrying the current `seq`.

## Client → server messages

| `type`                    | Fields                                          | Allowed for        | Effect                                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ping`                    | `t0` (client ms)                                | anyone             | Replies `pong` immediately; no state change                                                                                                                                                                         |
| `set_ready`               | `ready: boolean`                                | anyone (self)      | Sets own `ready`; commit `participant_ready`                                                                                                                                                                        |
| `set_audio`               | `enabled: boolean`                              | anyone (self)      | Sets own `audioEnabled`; commit `participant_audio`. Never affects the timeline                                                                                                                                     |
| `claim_conductor`         | —                                               | `canControl`       | Becomes conductor if there is none or the current one is disconnected; admins may always claim. Else `conductor_connected`                                                                                          |
| `transfer_conductor`      | `userId`                                        | conductor or admin | Target must be a participant with `canControl`; commit `conductor_changed`                                                                                                                                          |
| `end_session`             | —                                               | conductor or admin | Ends the session for everyone (see below)                                                                                                                                                                           |
| `set_repertoire`          | `repertoireId \| null`                          | conductor          | Loads ordered song ids from D1 (`unknown_repertoire` if not found); updates `currentSong.repertoireIndex`                                                                                                           |
| `set_song`                | `songId \| null`                                | conductor          | Loads the song's current version from D1 (`unknown_song` if missing); sets `currentSong`, copies `bpm` (when present), `beatsPerBar`, `beatUnit` into the metronome, stops the metronome, resets everyone's `ready` |
| `next_song` / `prev_song` | —                                               | conductor          | Moves within `repertoireSongIds`; at the edges it is a no-op (no message); with an empty repertoire → `unknown_song`                                                                                                |
| `set_tempo`               | `bpm` (20–400)                                  | conductor          | Sets `bpm`; if running, re-anchors at the next bar boundary ≥ now + 400 ms                                                                                                                                          |
| `set_time_signature`      | `beatsPerBar` (1–32), `beatUnit` ∈ {1,2,4,8,16} | conductor          | Sets meter; if running, stops the metronome (`paused`) so the conductor restarts deliberately                                                                                                                       |
| `set_count_in`            | `bars` (0–4)                                    | conductor          | Sets `countInBars`                                                                                                                                                                                                  |
| `set_subdivision`         | `subdivision` ∈ {1,2,3,4}                       | conductor          | Sets `subdivision` (clicks per beat)                                                                                                                                                                                |
| `set_click_mode`          | `mode: "synced" \| "central"`, `centralUserId?` | conductor          | In central mode `centralUserId` defaults to the conductor                                                                                                                                                           |
| `start`                   | `leadMs?` (300–5000, default 2000)              | conductor          | If not running: `anchor = startAnchor(now + leadMs, bpm, meter)`, `running = true`. Else `already_running`                                                                                                          |
| `stop`                    | —                                               | conductor          | If running: `running = false`, `anchor = null`, status `paused`. Else `not_running`                                                                                                                                 |

Any message that fails schema validation → `error: invalid_message`. Conductor-only commands from someone else → `not_conductor`. Commands after the session ended → `session_ended`.

## Server → client messages

| `type`     | Fields                                                   | When                                                                |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `snapshot` | `state`, `serverNow`, `you: { userId }`                  | Right after the socket is accepted (first join and every reconnect) |
| `state`    | `state`, `serverNow`                                     | After every commit, to every connected socket                       |
| `pong`     | `t0` (echoed), `t1` (server receive), `t2` (server send) | Reply to `ping`                                                     |
| `error`    | `code`, `seq?`                                           | Rejected command or invalid message                                 |
| `ended`    | `serverNow`                                              | Session ended; the server then closes every socket with code 1000   |

Error codes: `not_conductor`, `not_allowed`, `invalid_message`, `unknown_song`, `unknown_repertoire`, `session_ended`, `not_running`, `already_running`, `conductor_connected`.

## Presence and the conductor role

- On join the participant is created or marked `connected`; identity fields (name, instrument, admin, canControl) are refreshed from the headers so permission changes apply at the next connection.
- If there is no conductor and the joining participant `canControl`, they become conductor automatically (the first eligible person to arrive).
- Multiple sockets for the same user are allowed (phone + tablet); a participant is `connected` while at least one socket is open.
- On the last socket closing, `connected = false`, `lastSeenAt = now`, commit `participant_left`. If nobody is connected, `allDisconnectedAt` is recorded.
- A disconnected conductor keeps the role for a **90 s grace period** (`CONDUCTOR_GRACE_MS`). During that time any connected participant with `canControl` may `claim_conductor` immediately; after it the DO alarm clears `conductorUserId` (commit `conductor_released`) so the UI offers the role to everyone eligible.
- Admins may claim or transfer even while a conductor is connected.

## Alarms

The DO schedules a single alarm for the earliest of:

- conductor release at `conductor.lastSeenAt + 90 s` while the conductor is disconnected;
- automatic end at `allDisconnectedAt + 12 h` (`EMPTY_SESSION_TTL_MS`) when everybody has left.

## Ending a session

`end_session` (or the 12 h alarm) sets `status = ended`, `endedAt`, stops the metronome, increments `seq`, persists, sends `ended` to every socket, closes them, deletes the alarm and writes `rehearsal_sessions.status = 'ended'` plus a `session_ended` event to D1. Further upgrade attempts receive `409` from the Worker (`410` from the DO). A new session for the band can then be created.

## Persistence

Every commit writes the full state to DO storage (`state` key) before broadcasting. In `waitUntil`, it appends a `rehearsal_events` row (`seq`, `type`, `payload`, `actorUserId`) and updates `rehearsal_sessions.status`. On DO restart the state is reloaded and connection flags are reconciled against the sockets the runtime still holds.

## Client behaviour (web app)

`RehearsalSocket` (`apps/web/src/lib/realtime/RehearsalSocket.ts`):

- reconnects with exponential backoff (500 ms · 2ⁿ, capped at 10 s, plus jitter) after any non-user close except policy codes 1008/4401/4403/4404/4409 (`rejected`);
- treats `ended` as terminal (no reconnect);
- runs the clock-sync ping cadence described in `AUDIO_SYNC.md` and exposes the `ClockEstimate`;
- while reconnecting, the room page polls the REST detail route every 5 s to detect a session that ended while offline.

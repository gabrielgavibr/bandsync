# AutoArrange 3.0 — Reference link and the recording's pre-arrangement

> Continued in `AUTOARRANGE_3_1.md`: structure analysis v2, section player, limits edited while listening.

The YouTube link is the band's main reference. From it BandSync builds a **pre-arrangement of the
recording** (a map of the whole recording: sections, bars, chords, cues) that the band reviews and
turns into **its own arrangement**, which is what the song page and the live room show.

Flow: add song → paste link → identify (title, channel, thumbnail, official player) → confirm →
**Confirmar e gerar pré-arranjo** → research (MusicBrainz, Deezer) → arrangement page → generate
the map from a source BandSync may process → review/edit → **Salvar versão da banda** → song page
and Ensaio Live.

## 1. Technical investigation

The question for every path: can BandSync legitimately obtain musical information about _this_
recording, and how much? "YouTube does not allow downloading audio" is the conclusion for one row,
not for the feature.

| Technical path                                                                            | What it gives                                                         | Limitations                                                                                        | Compatibility                         | Terms of use                                                                                                                                                             | Cost                | Viability / decision                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **YouTube oEmbed**                                                                        | Title, channel, thumbnail; confirms the video exists                  | No artist/song split, no duration, no audio                                                        | Server (Worker)                       | Public endpoint, no key                                                                                                                                                  | Free                | **Used** — identification (already in production since the reference-link stage).                                                                                                                                  |
| **YouTube IFrame Player API**                                                             | Play, pause, seek; `getDuration()`, `getCurrentTime()` in the browser | No access to audio samples                                                                         | All browsers incl. mobile             | YouTube API Services Terms; embedded player must stay visible and unmodified                                                                                             | Free                | **Used** — official player, video length kept as a fact (`origin = youtube`, method `youtube.iframe_player.getDuration`), playhead on the timeline, "listen from this section", member marks timed by the player.  |
| **YouTube Data API v3** (`videos.list contentDetails`)                                    | Duration, licensing flags                                             | Needs a Google API key (quota 10 000 units/day)                                                    | Server                                | Developer policies; key must be configured                                                                                                                               | Free within quota   | **Not needed now**: the IFrame player already gives the duration without a key. Can be added later for server-side duration.                                                                                       |
| **Capturing the playing tab** (`getDisplayMedia` with audio)                              | The audio the browser is playing                                      | Desktop Chromium only (no iOS/Android, no Safari/Firefox tab audio); a permission prompt each time | Partial                               | YouTube developer policies forbid separating/isolating the audio of content served through the API Services; the user's consent to share a tab does not grant that right | Free                | **Not implemented** for that reason.                                                                                                                                                                               |
| **Downloading the YouTube/Spotify stream** (undocumented endpoints, extractors)           | Full audio                                                            | —                                                                                                  | —                                     | Prohibited by both platforms' terms; circumvents access controls                                                                                                         | —                   | **Not implemented, by design.**                                                                                                                                                                                    |
| **Spotify oEmbed / embed**                                                                | Title, cover, embedded player                                         | No artist split, no duration, no position API in oEmbed                                            | All                                   | Spotify Developer Terms                                                                                                                                                  | Free                | **Used** as the alternative reference (identification and player).                                                                                                                                                 |
| **Spotify Web API audio-features / audio-analysis**                                       | Tempo, key, sections, beats                                           | Closed to new apps since 27 Nov 2024                                                               | Server                                | Spotify Developer Terms                                                                                                                                                  | Free (if available) | **Not available** to BandSync.                                                                                                                                                                                     |
| **Deezer public API** (`/track/isrc:`, `/search`, `/track/{id}`)                          | Published BPM, duration, ISRC of the exact recording                  | BPM only (no key, no structure); BPM 0 for many tracks; versions must be told apart                | Server, no key                        | Deezer API terms (commercial use to be confirmed before production)                                                                                                      | Free                | **Used** as discovery of a published estimate: matched by ISRC, or by title + exact length (±3 s). Stored as `origin = deezer`, **needs review**, never filled in as the band's value. Preview clips are not used. |
| **GetSongBPM API**                                                                        | BPM, key                                                              | Free key required; mandatory backlink; catalogue coverage of Brazilian music unknown               | Server                                | Attribution required                                                                                                                                                     | Free                | **Not configured** (needs a key and a public backlink: a product decision).                                                                                                                                        |
| **Licensed analysis services** (e.g. Cyanite)                                             | Tempo, key, structure, mood                                           | Work on audio the customer uploads; same rights question as any file                               | Server                                | Commercial contract                                                                                                                                                      | **Paid**            | **Not contracted** (no paid services without authorisation).                                                                                                                                                       |
| **MusicBrainz**                                                                           | Recording identity, ISRC, length, work, authors                       | No musical analysis                                                                                | Server, rate-limited gateway          | Data CC0                                                                                                                                                                 | Free                | **Used** (catalogue path and ISRC → Deezer).                                                                                                                                                                       |
| **Authorised file** (own recording, licensed, permission of the owner)                    | The full recording                                                    | The band must hold the right                                                                       | All browsers (decoded by the browser) | The band's declaration is stored with the file                                                                                                                           | Free (R2 storage)   | **Used** — full analysis on the device, any length. The main route for a complete map.                                                                                                                             |
| **Microphone** while the reference plays                                                  | The whole recording as heard in the room                              | Room noise, speaker quality; long captures use memory (limit 8 min)                                | Browsers with `getUserMedia` (HTTPS)  | Audio analysed on the device and discarded                                                                                                                               | Free                | **Used** — "Microfone" mode listens to the whole recording.                                                                                                                                                        |
| **Member marks while listening**                                                          | Section boundaries timed by the official player                       | No harmony; needs a tempo to count bars                                                            | All (YouTube references)              | A person's work                                                                                                                                                          | Free                | **Used** — "Marcar ouvindo": letters only (A, B, C…), bars from the band's or Deezer's BPM.                                                                                                                        |
| **Public annotated datasets** (SALAMI, librosa example audio, Wikimedia Commons CC audio) | Real recordings with known licences / annotations                     | Not the band's songs                                                                               | Tests only                            | CC0 / CC BY / public domain                                                                                                                                              | Free                | **Used for validation** (real recordings in the test suite). Commons was rate-limited (HTTP 429) from this environment during the work.                                                                            |

**Chosen architecture.** Identification and research on the server (cheap HTTP calls, inside the
existing preparation job or the request that reports the player's length). Audio analysis only in
the member's browser (Web Worker), from a file the band may process or from the microphone, so no
heavy processing runs in a Worker request and nothing paid is involved. A link alone gives
identification, playback, length and a published tempo estimate when one exists — the page says so
in the **Análise indisponível** state and lets the band continue with what is verified.

## 2. Modules (`packages/shared/src/autoarrange/pipeline.ts`)

| Module                                | Interface                  | Implementation today                                      |
| ------------------------------------- | -------------------------- | --------------------------------------------------------- |
| Identification                        | `RecordingIdentifier`      | oEmbed of YouTube/Spotify (`identifyReferenceLink`)       |
| Metadata                              | `MetadataProvider`         | MusicBrainz gateway DO; IFrame player duration            |
| Discovery of existing analyses        | `AnalysisDiscovery`        | Deezer (`discoverOnDeezer`, `discoverPublishedTempo`)     |
| Authorised acquisition                | `AnalysableSourceProvider` | declared audio assets (R2), microphone                    |
| Processing                            | `AudioProcessor`           | `prearrange()` in a Web Worker                            |
| Structure detection / pre-arrangement | —                          | `packages/shared/src/analysis/prearrange.ts`              |
| Review and persistence                | REST                       | `POST /prearrangement`, `PUT /arrangement`, review events |

Stages shown to the band (`PreparationStage`): Referência identificada → Procurando informações
musicais → Verificando disponibilidade de análise → Analisando a gravação → Detectando estrutura →
Preparando pré-arranjo → Aguardando revisão → Pronto; or **Análise indisponível**.

## 3. Data (migration `0006_prearrangement.sql`, additive)

- `recording_arrangements`: one immutable row per generated pre-arrangement (source `audio_file` |
  `microphone` | `member_marks`, file, engine and version, the whole map as JSON, who and when).
  A new generation adds a row; old ones stay.
- `song_sections`: `label` (repetition letter kept from the pre-arrangement) and `chords` (one per bar).
- `song_versions`: `arrangement_base_id` (the pre-arrangement the band started from),
  `arrangement_transpose`, `arrangement_updated_by/at`.

The band's arrangement is the song's sections. Saving it never touches `recording_arrangements`;
each save writes a review event (`band_arrangement`) with before/after.

## 4. The engine (`prearrange-v1`)

On the device, from mono audio: beat tracking and tempo (as in `listen-v1`); meter 3 vs 4 from low
accents plus where harmony changes; high-resolution chroma (4096-point window, tuning estimate);
key (Krumhansl–Kessler); one chord per bar (major/minor triad templates, sampled after the beat
attack); a bar-level self-similarity matrix (harmony, timbre in 12 bands, loudness); boundaries
from a checkerboard novelty curve plus lasting loudness steps; repetition letters from section
similarity; functional names (intro, verse, chorus, bridge, outro) **only when something repeats**,
with "medium" confidence at most; cues for stops, entries, drops and texture changes.

Never presented as more than it is: every value is stored as an estimate that needs review;
uncertain sections are "Seção A/B/C"; no instrumental line is transcribed; the bass view shows the
harmonic map with "não é a linha original do baixo".

### Measured on real recordings (`packages/shared/test/prearrange-real.test.ts`, e2e)

| Recording (licence)                           | Reference value (librosa 1.0) | BandSync                                                       |
| --------------------------------------------- | ----------------------------- | -------------------------------------------------------------- |
| Brahms, Hungarian Dance No. 5 (public domain) | 152 BPM, G minor              | ~150 BPM, **G minor**                                          |
| Kevin MacLeod, Vibe Ace (CC BY 4.0)           | 129.2 BPM, E                  | 65 BPM (half), **E**                                           |
| Tchaikovsky, Sugar Plum Fairy (CC BY 4.0)     | 107.7 BPM, E minor            | tempo ok, key **B** (miss: dominant)                           |
| Montage A B A C A of the three (18 s each)    | 4 boundaries, A returns twice | 3 of 4 boundaries within one bar; both returns of A labelled A |
| Vibe Ace X Y X Y X (passages of one song)     | 4 boundaries                  | 2 of 4 (same instrumentation is hard)                          |

About 0.5 s of processing per 4 minutes of audio. The half/double tempo reading is always offered
(matters for reggae). Reggae and MPB recordings with a licence that allows processing could not be
obtained from this environment (Wikimedia Commons returned HTTP 429); CC BY bossa-nova tracks were
located for the next calibration round. The three real songs of the band (Pérola Negra, Esotérico,
O Segundo Sol) have **not** been analysed: no file the band may process was provided, and no result
is shown for them that was not obtained.

## 5. What the three demo songs get today (link only)

| Song                                  | Identification | Verified facts                                                                          | Map                                               |
| ------------------------------------- | -------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Pérola Negra (Natiruts, YouTube link) | oEmbed         | video length from the player; Deezer BPM 130.01 when the ISRC is known (catalogue path) | after an authorised file, the microphone or marks |
| Esotérico (Um Banda Um)               | oEmbed         | Deezer BPM 110.5 once the player reports a matching length (262 s)                      | same                                              |
| O Segundo Sol (Cássia Reggae)         | oEmbed         | Deezer has the recording but no BPM (0) → nothing stored                                | same                                              |

## 6. Editor and views

- Arrangement page `/bands/:bandId/songs/:songId/arrangement`: reference with the official player,
  stage list, verified facts, generation (file / microphone / marks), recording timeline (tap to
  play from a section), section list (start, end, duration, bars, classification and its confidence,
  progression, cues, review state), band arrangement editor (rename, role, bars, chords per bar,
  stop/entry/convention/note cues, reorder, repeat, split, join, remove, transpose ±½ tone, start
  from / restart from the pre-arrangement, save), band values (tempo, key, meter) in a fold.
- Per-instrument views on the song page and in the live room: drums (structure, bars, BPM, cues),
  bass (harmonic map, authorised tabs only), guitar and keys (chords per section, four bars a line),
  vocals (structure, entries, lyrics only when the band added them).

## 7. Tests

- Shared: engine on synthetic forms and on real recordings (89 tests).
- API: pre-arrangement storage, band arrangement save without touching it, member marks,
  player duration, Deezer discovery by ISRC and by length, file of a song with no reference,
  validation and permissions (95 tests).
- Web: editing model (remove intro, repeat chorus, shorten, split, join, reorder, transpose,
  round trip, original untouched) and marks → map (35 tests).
- E2E (`e2e/tests/prearrangement.spec.ts`): YouTube link → generate → **Análise indisponível** →
  map by listening → band version → live room (English, desktop); authorised real recording →
  whole-recording map on the device → editing → original unchanged → mobile → per-instrument view
  (Portuguese, 390 px). The YouTube IFrame script is replaced by a stand-in in tests (no network).

## 8. Known limitations

- Key: dominant/relative confusions on orchestral material; chords are major/minor triads only.
- Structure inside one song with constant instrumentation is detected about half the time.
- Microphone mode depends on the room; the full-length capture uses memory (8 min limit).
- Deezer terms for commercial use must be confirmed before production.
- The live room shows the arrangement; it does not yet follow the playing position bar by bar.

## Sources

- [YouTube API Services — Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube IFrame Player API reference](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube Data API — Videos](https://developers.google.com/youtube/v3/docs/videos)
- [Spotify — Changes to the Web API (27 Nov 2024)](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)
- [Spotify oEmbed](https://developer.spotify.com/documentation/embeds/reference/oembed)
- [Deezer API](https://developers.deezer.com/api)
- [GetSongBPM API](https://getsongbpm.com/api)
- [Cyanite](https://cyanite.ai/)
- [MDN — MediaDevices.getDisplayMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [MusicBrainz data licence](https://musicbrainz.org/doc/About/Data_License)
- [SALAMI annotations](https://github.com/DDMAL/salami-data-public)
- [librosa example data](https://github.com/librosa/data)

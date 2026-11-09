# BandSync — Reference recording

Every song has **one main reference recording**, chosen by a band member by pasting a link. It is
the recording all members study from, and the starting point of the band's arrangement.

This replaces the earlier idea of a song page built around a list of external sources. Catalogue
data, sources and stored links still exist, but only under "Technical details".

## 1. The flow

`Add song → paste the recording's link → identify → confirm → prepare`

1. **Paste.** One field. Accepted: YouTube, YouTube Music, Spotify.
2. **Identify.** The server recognises the platform, rebuilds a clean link from the platform's own
   identifier and asks the platform's official public endpoint what it says about it.
3. **Confirm.** The member sees cover or thumbnail, the title as the platform shows it, the
   channel (YouTube), the platform and the original link, can listen in the official player, and
   confirms or corrects the **song title** and the **artist**.
4. **Prepare.** The recording becomes the song's reference and a workspace is opened per
   instrument.

Still available: "Enter manually" (the plain form) and, for when there is no link at hand,
"Search by title and artist" in the open catalogue (MusicBrainz), which tells versions of the
same song apart. A recording chosen that way has no link yet: its reference is **link pending**.

## 2. Platforms and what they really give

Checked on 2026-11-09 against the live endpoints. Captured answers are in
`packages/shared/test/fixtures/musicbrainz/`.

| Platform      | Links accepted                                                                    | Official endpoint                    | Given                     | **Not** given                                              |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------ | ------------------------- | ---------------------------------------------------------- |
| YouTube       | `youtube.com/watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`, mobile host | oEmbed, no key                       | Title, channel, thumbnail | Duration; artist (a channel is not necessarily the artist) |
| YouTube Music | `music.youtube.com/watch?v=`                                                      | YouTube oEmbed for the same video id | Title, channel, thumbnail | Duration                                                   |
| Spotify       | `open.spotify.com/track/<id>` (also with a locale prefix), `spotify:track:<id>`   | oEmbed, no key                       | Track title, cover        | **Artist**, duration, album                                |

Consequences, stated in the interface instead of hidden:

- **Duration** is unknown for a link-only reference. It appears only when the recording was also
  found in the catalogue.
- **Artist** is never taken from a channel name. It is prefilled only for YouTube's auto-generated
  "… - Topic" channels; otherwise the member types it. For Spotify the app says the platform does
  not name the artist through this endpoint.
- A **video title is not assumed to be the song title**: it is offered as a starting value with a
  note to check it.
- Spotify's Web API would give artist, album and duration, but it needs a registered application
  and credentials. That is **not configured**; the connector is written so it can be added later.

Refused, each with its own state in the interface:

| State                                 | When                                                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid link                          | Not a link, or a scheme other than http(s) (`javascript:`, `data:`, `file:` …), credentials or a port in the address, control characters, over 2000 characters |
| Unsupported platform                  | A real link to a site without a connector (including look-alike hosts such as `youtube.com.example`)                                                           |
| Not one recording                     | A playlist, album, artist, channel, search page or short link (`spotify.link`) of a supported platform                                                         |
| Reference not found                   | The platform does not know that video or track                                                                                                                 |
| Metadata missing / player unavailable | The platform knows it but shares nothing (private video, embedding disabled). The link can still be kept and the details typed                                 |

Adding a platform means adding it to `REFERENCE_PLATFORMS` and to the functions of
`packages/shared/src/autoarrange/reference.ts` (parse, canonical link, player, metadata
endpoint), plus an entry in the source registry (`apps/api/src/autoarrange/connectors.ts`).
Nothing else in the interface names a platform.

## 3. Safety of links

- A pasted link is only ever **parsed**. What is stored and shown is `(platform, id)`; the
  original link, the player address, the metadata request and nothing else are rebuilt from those
  two values. Text typed by a user is never placed in an `iframe`, a request or an `href`.
- Identifiers are checked against the platform's exact shape (11 characters for YouTube, 22 for
  Spotify), again when read back from the database.
- The server only ever requests two fixed hosts (`www.youtube.com`, `open.spotify.com`). A pasted
  link cannot make it call anything else.
- Thumbnails are accepted only over https from the platforms' image hosts; anything else is
  dropped. The player's HTML returned by a platform is ignored.
- Players run in a sandboxed frame from `youtube-nocookie.com` or `open.spotify.com`.

## 4. One reference per band version

The app has one band version per song, so the reference belongs to the song.

- `song_recordings` holds every recording a song has ever pointed at; exactly one is the
  reference (partial unique index). Migration `0004_reference_link.sql` adds the link columns
  (`platform`, `external_id`, `link_url`, `link_title`, `link_author`, `thumbnail_url`,
  `embeddable`, `link_checked_at`), who corrected the metadata and when, and
  `reference_since` / `retired_at`.
- The same recording is stored once per song: the same catalogue id, or the same video/track.
  Pasting the same link again changes nothing.
- **Same recording, another link** (the track on another platform, a better upload) only updates
  the link: analyses, audio and confirmed values stay attached.
- **Same recording** never asks anything: the same catalogue id, or the same video or track
  (a YouTube video and its YouTube Music page count as one). Only the link is updated, and the
  change is recorded.
- **Another recording** while the song already has a reference: the server never replaces it on
  its own. It answers `confirmation_required` (409) with the current reference and what depends on
  it (confirmed tempo/key/meter, sections, ready material, authorised audio, analyses), and the
  interface asks: "This song already has a reference recording. Do you want to replace it? The
  existing musical data will be kept, but may need to be reviewed." with three choices:
  - **Cancel**: nothing happens;
  - **Keep current reference**: the preparation runs with the recording already set
    (`recording: { source: "current" }`); the new link is not used;
  - **Confirm replacement**: the request is sent again with `confirmReplace: true`.
- A song **without** a reference gets the recording with no question.
- Replacing never deletes or changes anything: the previous recording is kept as retired, the
  band's values stay as they are, and confirmations made before the change are **flagged** so the
  band listens again. Every set, replace, link change and correction is recorded in
  `review_events` with who and when.

## 5. Three different things

|                                  | Meaning                                        | How it becomes true                                                                                           |
| -------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Reference identified**         | The app knows the link and the public metadata | A member pasted a link                                                                                        |
| **Audio available for analysis** | The band gave a file it may process            | A member uploads a file and declares the right to use it (own recording, licensed, permission from the owner) |
| **Analysis done**                | Tempo, key, sections… were computed            | An analysis engine ran on that file — **none is configured yet**                                              |

A link never becomes audio: nothing is downloaded or extracted from YouTube or Spotify. The song
page shows the three lines separately ("Preparation status"), plus "Arrangement ready for review"
once the preparation has run. The upload dialog ties the file to the reference recording
(`audio_assets.recording_id`), which is what a future engine or licensed service will read.

## 6. Where the reference appears

| Place          | What                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Song page      | First block: cover, title, artist, platform, "Listen here", "Open original recording", "Change reference", "Fix details" |
| Song list      | Cover next to each song                                                                                                  |
| Repertoire     | One-tap link to the recording on each item                                                                               |
| Live rehearsal | A headphones button opens the reference on that device                                                                   |
| Add-song flow  | Current reference shown while choosing a new one                                                                         |

In the live room each musician opens or plays the reference **on their own device through the
platform**. The session keeps synchronising tempo, meter and devices; it never relays third-party
audio.

## 7. Song page

1. **Reference recording** (above).
2. **Band arrangement**: BPM, key, meter (confirmed by the band, with who and when), section map,
   materials per instrument, notes, preparation status.
3. **Technical details**, collapsed: catalogue data and sources, how the recording was identified,
   what the platform said, previous references, results with origin, the last preparation,
   stored links and the history.

The preparation no longer adds search links to chord and tab sites, and the add-song flow no
longer lists sources. Links stored earlier are kept and shown only under "Technical details".

## 8. API

Under `/api/bands/:bandId/autoarrange`; writes need permission to edit the repertoire.

| Method and path                                              | Purpose                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /reference/identify` `{ url }`                         | Identify a pasted link. Errors: `validation_error` (`invalid_url`, `unsupported_link`), `unsupported_platform` (422), `not_found` (`reference_not_found`)                                                  |
| `POST /prepare`                                              | `recording: { source: "link", title?, artistCredit? }` with `referenceUrl`; also `musicbrainz`, `manual` and `current` (keep the song's reference). `confirmReplace: true` after a `confirmation_required` |
| `PUT /songs/:songId/reference/link` `{ url }`                | Same recording, new or first link                                                                                                                                                                          |
| `PATCH /songs/:songId/reference` `{ title?, artistCredit? }` | Correct what the band sees                                                                                                                                                                                 |
| `GET /songs/:songId`                                         | Adds `preparation`, `dependents` and per-confirmation `beforeReferenceChange`                                                                                                                              |

`SongDto.reference` (song, song list, repertoire items) carries the summary every member sees.

## 9. The real repertoire

`apps/api/scripts/prepare-real-repertoire.mjs` applies what the band decided, through the API:

| Song          | Reference                                                                  | Link                                      |
| ------------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| Pérola Negra  | Natiruts part. especial Luiz Melodia — _Acústico no Rio de Janeiro_ (2012) | Confirmed YouTube link                    |
| Esotérico     | Gilberto Gil — _Um Banda Um_ (1982)                                        | **Pending** (no exact link was confirmed) |
| O Segundo Sol | Gilberto Gil — _Cássia Reggae, Vol. 1_ (2022)                              | **Pending**                               |

The script never picks a video or track for a song without a confirmed link, never changes the
band's values and never forces a replacement the API asks to confirm.

## 10. Error messages and app updates

- The interface never shows an internal key such as `errors.confirmation_required`. Every error
  goes through one helper (`apps/web/src/lib/errors.ts`): a code with a translation shows it, any
  other code shows the generic message in the current language. A test checks that every error
  code the server can send has a sentence in Portuguese and English.
- BandSync is installed as an app (PWA) and keeps the interface it downloaded. A page left open,
  or an installed app brought back from the background, kept running the previous interface
  after a new version was published, against the new server. The app now checks for a new
  version when it comes back to the foreground and every 15 minutes, and when one has taken
  over shows "A new version of BandSync is available" with a Reload button. It never reloads on
  its own, so a live rehearsal is not interrupted.

## 11. Limitations

- No duration from a link; no artist from Spotify; see section 2.
- Whether a player works depends on the owner's settings and on the device reaching the platform.
  A blocked or failing player cannot be detected reliably from the page, so "Open original
  recording" is always offered.
- Short links (`spotify.link`) are refused because resolving them would mean following redirects
  to arbitrary addresses.
- One reference per song; several band versions of one song are not modelled in the interface.
- There is no analysis engine: authorised audio can be uploaded and is reported as "analysis
  pending".

## 12. Tests

- `packages/shared/test/reference.test.ts` — link parsing (valid shapes, dangerous schemes,
  look-alike hosts, non-recording links), player and endpoint addresses, thumbnails, real oEmbed
  answers, hostile answers.
- `apps/api/test/reference.test.ts` — identify (YouTube, YouTube Music, Spotify, restricted,
  refused, unknown), permissions, song from a link, same reference for every member, replacement
  with and without confirmation, link added to a catalogue recording, corrections, history.
- `e2e/tests/autoarrange.spec.ts` — the flow in the browser, a second member on a phone, the
  repertoire, the live room, replacement warning, authorised audio upload, Portuguese on a phone,
  and a dedicated scenario for preparing a song that already has a reference: no question without
  a reference or for the same recording; the translated three-choice dialog; cancel, keep and
  confirm, with the band's data compared before and after; no internal key ever on screen.
- `apps/web/test/errors.test.ts` — every server error code translated in both languages; unknown
  codes fall back to the generic message.
- `e2e/staging/homologation.staging.ts` — the same against the real platforms.

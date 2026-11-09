# Real repertoire for homologation

Three real songs replace the fictional demo for the first rehearsal test, in a repertoire named
**Repertório Real — Primeiro Ensaio**, in this order:

| #   | Song          | Composer     | Reference recording                                                                                                                                |
| --- | ------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pérola Negra  | Luiz Melodia | Natiruts feat. Luiz Melodia, _Natiruts Acústico no Rio de Janeiro_ (2012), official video https://www.youtube.com/watch?v=JZqFoTIAJj8              |
| 2   | Esotérico     | Gilberto Gil | Gilberto Gil, _Um Banda Um_ (1982), chosen by the band. **Link pending**: no exact link was confirmed                                              |
| 3   | O Segundo Sol | Nando Reis   | Gilberto Gil in _Cássia Reggae — Vibrações de Paz e Amor para Cássia Eller_ (2022, Universal Music); not Cássia Eller's original. **Link pending** |

The **main reference recording** of each song (what every member sees first on the song page, in the
repertoire and in the live room) is set by `scripts/prepare-real-repertoire.mjs`; see
`REFERENCE_RECORDING.md` §9. Only Pérola Negra has a confirmed link; the other two keep the reference
"link pending" until someone pastes the exact link.

Source of truth: `apps/api/seed/real-repertoire.json`. Apply with the create-only importer:

```bash
BANDSYNC_URL=http://localhost:8787 BANDSYNC_EMAIL=ana@bandsync.demo BANDSYNC_PASSWORD=bandsync-demo \
  pnpm --filter @bandsync/api import:real-repertoire
```

Running it again creates nothing (songs are matched by `externalId`, links by URL, material slots by
type and instrument, the repertoire by name). It never edits existing data, so the band's own values
(tempo, key, notes, uploaded material) are preserved.

## How facts are recorded

- **Reference recording vs band version.** The song page shows the reference recording and the band
  arrangement as its two main blocks; the side-by-side table of reference and band values is now under
  "Technical details". Reference values carry a
  status: _Not known_, _Estimate, to confirm_ or _Confirmed_. Band values show _Not set by the band_
  until the band enters them.
- **Nothing is invented.** No BPM or key could be read on an authoritative page for any of the three
  reference recordings (see "Research limits"). The reference BPM and key fields are therefore empty;
  the candidate values found are listed under **Sources** with their URL and caveats.
- **Time signature.** No source states it. The band version starts at 4/4 because the metronome needs a
  number, and is flagged _To confirm_ (`meter_confirmed = false`) everywhere, including the live room.
- **Live room tempo.** When a song has no band tempo, the session uses the reference tempo if one is
  recorded and says so; if none is recorded it keeps the current metronome tempo, dims it and shows
  "No tempo recorded for this song; set it manually". A tempo set by the conductor is labelled as such.

## What was found (all unverified: read from search-result summaries, not from the pages)

| Song                             | Candidate BPM                                      | Candidate key                                               | Duration                  | Notes                                                                  |
| -------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| Pérola Negra (Natiruts, 2012)    | 130 (Tunebat, algorithmic; may be double time ≈65) | A♯ minor (Tunebat) vs Fm (Cifra Club) vs G♯ (Cifras.com.br) | 3:29 (Wikipedia, Discogs) | Sources conflict on key                                                |
| Esotérico, Doces Bárbaros (1976) | 96 (Tunebat, recommendation list)                  | E minor                                                     | 4:09 / 4:11               | Track identity unconfirmed                                             |
| Esotérico, Um Banda Um (1982)    | 111 (Musicstax, matched only by length)            | B minor                                                     | 4:22                      | Track identity unconfirmed                                             |
| O Segundo Sol (Gil, 2022)        | not found                                          | not found                                                   | not found                 | Published values (~145 BPM, C) belong to Cássia Eller's 1999 recording |

Time signature and song structure: not found for any reference recording.

## Material per instrument

Each song has one slot per instrument, all **pending**: drums (arrangement map), bass (bass tab),
guitar (chord chart), keys (chord chart / harmonic map), vocals (lyrics and notes). Where a third-party
page exists, the slot links to it. Nothing was transcribed or copied. A band member with the
repertoire permission can open a slot, paste or upload material the band has the right to use, and
switch it to _Ready_. Original demo material may be added if it is marked _Original example_.

## Third-party sites

| Site          | Use in BandSync                                                                                   | Why                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| MusicBrainz   | Links; core data is CC0 and could be imported via API later (1 request/s, identifying User-Agent) | https://musicbrainz.org/doc/About/Data_License                                           |
| Cifra Club    | Links only                                                                                        | Terms forbid data extraction and framing (https://www.cifraclub.com.br/aviso-legal.html) |
| Cifras.com.br | Links only                                                                                        | Content for personal use; copying needs written consent                                  |
| Songsterr     | Links only                                                                                        | Commercial use or embedding needs permission                                             |
| YouTube       | Links (embedding via the official player would be allowed)                                        | YouTube ToS and developer policies                                                       |

No scraping or downloading is implemented.

## Research limits

The research ran in an environment that could not open musicbrainz.org, tunebat.com, cifraclub.com.br,
youtube.com or universalmusic.com.br directly; only search-engine summaries were available. Every
value and link above should be checked by a person, and the reference BPM/key confirmed by ear before
being entered. Two YouTube links and one Spotify link for _O Segundo Sol_ are marked as candidates
because their channel and provenance were not verified.

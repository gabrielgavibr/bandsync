# Real recordings used in tests

Copied unmodified from the librosa example-data repository
(https://github.com/librosa/data, commit 38f4b06556fa0ff1acda5e677d8ba05d1bc0fff0), which records
each file's source and licence. Only permissively licensed files are kept here.

| File | Work | Credit | Licence | Source |
| --- | --- | --- | --- | --- |
| `vibe-ace.ogg` | Vibe Ace | Kevin MacLeod | CC BY 4.0 | https://freemusicarchive.org/music/Kevin_MacLeod/Jazz_Sampler/Vibe_Ace |
| `sugar-plum-fairy.ogg` | Dance of the Sugar Plum Fairy | P. I. Tchaikovsky (composer), Kevin MacLeod (arranger) | CC BY 4.0 | https://freemusicarchive.org/music/Kevin_MacLeod/Classical_Sampler/Dance_of_the_Sugar_Plum_Fairy |
| `hungarian-dance-5.ogg` | Hungarian Dance no. 5 | Johannes Brahms (composer), US Army Strings (performer) | Public Domain Mark 1.0 | https://musopen.org/music/43805-hungarian-dance-no-5-in-f-sharp-minor-woo-1-string-orch |

"Let's Go Fishin'" (Karissa Hobbs) and "Sweet Waltz" (setuniman) were also measured during
development but are not stored here: their licences are non-commercial (and the Fishin' entry is
listed with two different licences), so they are only used by the local evaluation script.

## Reference values

No human annotation exists for these recordings. The tests compare BandSync with values that are
known independently of any algorithm, or with an independent implementation:

- Key of *Dance of the Sugar Plum Fairy*: E minor (Tchaikovsky's score).
- Key of this orchestral *Hungarian Dance no. 5*: G minor (the orchestral versions are in G minor;
  the title's "F sharp minor" is the original piano duet key). librosa 1.0 agrees (G minor).
- Tempo and key estimates of librosa 1.0.0 (`beat.beat_track`, Krumhansl–Kessler on `chroma_cqt`):
  Vibe Ace 129.2 BPM / E; Sugar Plum Fairy 107.7 BPM / Em; Hungarian Dance 152.0 BPM / Gm.

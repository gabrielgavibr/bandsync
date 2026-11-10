# AutoArrange 3.1 — Structure analysis v2, section player, limits edited while listening

Follows `AUTOARRANGE_3.md`. Nothing was rebuilt: the engine's structure stage was replaced, the
arrangement page got a player and time editing, and the link research no longer waits for the
player.

## 1. Diagnosis: why v1 over-segmented

Case study: a real own composition uploaded on staging ("Meu Velho", 3:45, declared as the band's
own recording). v1 returned **20 sections with 11 different letters**.

Measured on that file (the audio stays private and is not in the repository):

- The chords are **one loop of eight bars** (Gm Gm Dm Dm Eb Eb Bb F) played 15 times: 120 bars.
  Bar-to-bar harmony similarity is 0.987 at a lag of 8 bars and ~0.96 at every other lag.
- Timbre alternates between the first and the second half of each loop.
- v1's novelty kernel compares **four bars with the next four**: exactly half a loop. Every half
  loop therefore looks like a change (different chords, different timbre).
- v1's threshold was **relative to the strongest peak** (40 %). In a song where nothing changes
  much, all peaks are small and alike, so nearly all of them passed.
- v1 labelled sections by aligning them bar by bar from their first bar, so two sections that
  start at different places of the loop looked unrelated: 11 letters.

The defect reproduces on synthetic audio (`test/structure-compare.test.ts`): one 8-bar loop with
only arrangement changes gives 22 sections in v1 (truth: 6); the same loop with nothing changing
gives 15 (truth: 1).

## 2. Structure analysis v2 (`packages/shared/src/analysis/structure.ts`)

1. **Harmonic loop.** The shortest lag (2, 3, 4, 6, 8, 12, 16 bars) whose harmony similarity is
   close to the best one. None when no lag stands out. The unit of comparison is one loop (two or
   more of a very short loop), or four bars when nothing loops.
2. **Change at the scale of the loop.** For every bar: mean harmony, timbre and loudness of the
   loop before against the loop after. Inside a steady loop this does not move, wherever in the
   loop the bar is. Without a loop, two scales are combined (four bars and two bars).
3. **Short passages and edges.** Where a whole loop does not fit, bars are compared with the bars
   at the same place one loop away, so a partial loop is never compared with a different partial
   loop.
4. **Absolute support, weakest first.** A boundary stands only if the two sections around it
   differ in absolute terms (one clear difference in harmony, timbre or level, or several
   moderate ones), at the scale of one loop or of two. Boundaries below that are dropped one at a
   time, weakest first; passages shorter than half a loop need more. Two candidates less than a
   loop apart both stay only when each is strong on its own.
5. **Loop grid.** Between two nearly equal neighbouring candidates, the one where loops start
   wins (a pickup or a fill does not move the boundary).
6. **Repetition by content.** Sections are grouped by what they contain (not by where in the
   loop they start); the same material gets the same letter wherever it returns; neighbours that
   turn out to be the same material are merged.
7. **Events are not sections.** What is left of a dropped boundary stays inside its section as an
   event (entry, drop, texture change, stop) or, when it was close to standing, as a **possible
   division** shown dashed on the timeline.
8. **Function names from evidence only.** A chorus is named only against another repeated part;
   one repeated part alone stays "Seção B". Intro and ending need to be unique, short and at the
   edge. Pre-chorus, solo, instrumental passage and interlude are **not** estimated (there is no
   reliable vocal/solo detection); the band names them in the editor.
9. **Chords from the loop.** Bars at the same place of the loop, in sections with the same
   material, are pooled before reading the chord, so one unclear bar does not hide a chord the
   loop plays every time. A bar keeps its own reading when it clearly disagrees.

Silence before the first note or after the last one is not a section.

## 3. v1 against v2

Same audio, known answer (`pnpm --filter @bandsync/shared test`, printed by
`structure-compare.test.ts`; boundaries count as found within one bar):

| Audio                                                  | Engine | Sections (truth) | Boundaries found | False boundaries | Boundary F | Same-material F |
| ------------------------------------------------------ | ------ | ---------------- | ---------------- | ---------------- | ---------- | --------------- |
| Synthetic: one 8-bar loop, 6 parts, fills every 8 bars | v1     | 22 (6)           | 3/5              | 18               | 0.23       | 0.51            |
|                                                        | **v2** | **6 (6)**        | **5/5**          | **0**            | **1.00**   | **0.99**        |
| Synthetic: one loop, nothing changes                   | v1     | 15 (1)           | –                | 14               | 0.00       | 0.58            |
|                                                        | **v2** | **1 (1)**        | –                | **0**            | **1.00**   | **1.00**        |
| Synthetic: verse / chorus / bridge                     | v1     | 8 (8)            | 7/7              | 0                | 1.00       | 1.00            |
|                                                        | v2     | 8 (8)            | 7/7              | 0                | 1.00       | 1.00            |
| Real: three recordings, A B A C A                      | v1     | 4 (5)            | 3/4              | 0                | 0.86       | 0.78            |
|                                                        | **v2** | **5 (5)**        | **4/4**          | **0**            | **1.00**   | **0.94**        |
| Real: two passages of one recording, X Y X Y X         | v1     | 5 (5)            | 2/4              | 2                | 0.50       | 0.65            |
|                                                        | v2     | 5 (5)            | 2/4              | 2                | 0.50       | **0.80**        |

The test asserts that v2 never finds fewer true boundaries than v1, never more false ones, and
that fewer sections are not obtained by losing real ones.

Own recordings on staging (no annotated answer; measured locally, counts only):

| Recording                                   | v1                      | v2                                                                                                                                                                                 |
| ------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Meu Velho" (120 bars, loop of 8)           | 20 sections, 11 letters | **7 sections, 5 letters**: intro 8 · B 32 · C 8 · B 32 · D 8 · B 24 · ending 8, every boundary on the loop grid, one possible division flagged, chords read as the loop throughout |
| "Quebrando o Sistema" (103 bars, loop of 4) | 7 sections, 7 letters   | 6 sections, 4 letters: intro 7 · B 16 · C 6 · B 41 · C 23 · ending 10, with possible divisions flagged inside the long B                                                           |

Whether these maps match what the composer hears is for the band to confirm by listening — which
is what the player below is for. No structure was assumed in advance.

## 4. Section player

- The file endpoint serves **byte ranges** (`206`, `416`, `Accept-Ranges`), with band membership
  checked on every request. Needed for seeking, and for audio to play at all on iOS.
- One transport per page (`features/arrangement/transport.ts`): the band's uploaded file through
  a single `<audio>` element (created once, released when leaving the page), or the official
  YouTube player when the map was not made from a file. A map made from a file is always
  reviewed on that file; YouTube is not involved.
- Player bar (stays at the bottom of the screen): play/pause, position, current time and
  duration, back/forward 5 s, previous/next section, **loop section**, **carry on to the next**,
  volume where the platform lets a page set it (not iOS).
- Tapping a section on the timeline or in the list plays **that section** and stops at its end;
  the sounding section is highlighted on both timelines and in the editor.

## 5. Limits corrected while listening

In the band's arrangement (the recording's pre-arrangement is never changed):

- start and end of each section: "aqui" (the playback position), or half a second earlier/later;
- the limit between two neighbours dragged on the band timeline (pointer or arrow keys; Shift
  for a whole second) — both sections move at once;
- split at the playback position; join with the next; remove; rename; role; notes;
- bars follow the new length when the bar length is known; chords are cut or carried on in the
  section's own cycle.

## 6. Link research without waiting for the player

When a link is prepared and no length is known yet, the Deezer search runs anyway and the
version is decided from **the platform's own title** (`pickDeezerVersion`):

- the title must name the song and an artist of the candidate;
- live / acoustic must agree between the title and the candidate (track and album titles);
- qualifiers of a candidate ("Primeira versão", "Regravação Take 01") must appear in the title;
- several versions left: the title's words must single one out by album/track title (at least
  two words, two more than the runner-up); otherwise **nothing is taken**.

Real answers: the YouTube title of Pérola Negra ("… Acústico Ao Vivo no Rio de Janeiro …")
matches the only Deezer version (track 429918992: BPM 130, 212 s, ISRC BR4W41200009), stored as
`origin = deezer`, **needs review**, with the match evidence, ISRC and album; "Gilberto Gil -
Esotérico" matches nothing (seven versions). Catalogue data never counts as an analysis, and
nothing is filled in on the song. Deezer publishes no key; none is shown.

## 7. Tests

- Shared (99): engine v1/v2 comparison, loop song, flat song, real recordings, Deezer version
  matching on real answers.
- API (96): range requests and their permissions, link research by title, existing suites.
- Web (41): time-editing model (shared limits, clamping, split at a moment, join back).
- E2E (15): section player on a real recording (play a section, pause, loop, stop at the end,
  next), limits moved by keyboard on the band timeline, "start here", split at the playhead,
  save, pre-arrangement unchanged, audio released on leaving; mobile, pt-BR and en.
- Staging checks are split (`e2e/staging/`): **Sala 3 is read only** (the check fails if it
  makes any non-GET request); everything that writes runs in a QA band of its own and removes
  what it created.

## 8. Limitations

- Verse and chorus that share harmony, instrumentation and level are one section (with possible
  divisions flagged when there is some evidence). Telling them apart needs melody/vocal analysis.
- Pre-chorus, solo, interlude and instrumental passages are not named automatically.
- Tempo octave: a song may be counted at double tempo (bars half as long); both readings are
  shown and the band's BPM decides, but bar counts follow the engine's reading.
- Chords are major/minor triads, one per bar.
- No annotated reggae/MPB recordings were available; the band's own two recordings were measured
  without a reference structure.
- Volume cannot be set from a page on iOS (hardware buttons); the control is hidden there.
- A pre-arrangement already stored (v1) is not rewritten: generate a new one from the same file
  ("Gerar outro pré-arranjo" → "Gerar a partir deste arquivo").

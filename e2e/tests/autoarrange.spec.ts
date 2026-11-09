import { devices, expect, type Page, test } from "@playwright/test";
import {
  contextFor,
  createBand,
  createRepertoire,
  inviteCode,
  join,
  registerUser,
  type User,
} from "./helpers";

/**
 * The band's main reference recording is chosen by pasting a link. External services are the
 * local stub replaying real captured answers (e2e/stubs/music-services.ts).
 */
const YT_ID = "JZqFoTIAJj8";
const YT = `https://www.youtube.com/watch?v=${YT_ID}`;
const YT_TITLE =
  "Natiruts - Pérola Negra (Natiruts Acústico Ao Vivo no Rio de Janeiro) ft. Luiz Melodia";
const SPOTIFY_ID = "4cOdK2wGLETKBW3PvgPWqT";
const SPOTIFY = `https://open.spotify.com/track/${SPOTIFY_ID}`;
const SEGUNDO_SOL_GIL = "790c0007-1df2-4d2e-bd34-8a772894e800";

async function identify(
  page: Page,
  link: string,
  labels = { link: "Recording link", go: "Identify" },
) {
  await page.getByLabel(labels.link).fill(link);
  await page.getByRole("button", { name: labels.go }).click();
}

/** Prepares a song through the API (the same call the wizard makes) and waits for the job. */
async function prepareViaApi(user: User, bandId: string, body: Record<string, unknown>) {
  const res = await user.api.post(`/api/bands/${bandId}/autoarrange/prepare`, { data: body });
  expect(res.status(), await res.text()).toBe(201);
  const out = await res.json();
  await expect
    .poll(
      async () =>
        (await (await user.api.get(`/api/bands/${bandId}/autoarrange/jobs/${out.job.id}`)).json())
          .job.status,
      { timeout: 20_000 },
    )
    .toBe("awaiting_review");
  return out.song.id as string;
}

test("add a song by pasting a link; every member finds the same reference, also in the live room", async ({
  browser,
}) => {
  const ana = await registerUser("Ana Drums", "drums");
  const bruno = await registerUser("Bruno Bass", "bass");
  const bandId = await createBand(ana, `Reference Band ${Date.now()}`);
  await join(bruno, await inviteCode(ana, bandId, "bass"));
  // Bruno plays but does not manage the repertoire.
  await ana.api.patch(`/api/bands/${bandId}/members/${bruno.id}`, {
    data: { permissions: { canEditRepertoire: false } },
  });
  await createRepertoire(ana, bandId, "Thursday", []);

  const { page, context } = await contextFor(browser, ana);
  await page.goto(`/bands/${bandId}/songs`);
  await page.getByRole("link", { name: "Add song" }).first().click();
  await expect(page.getByRole("heading", { name: "Add song", level: 1 })).toBeVisible();
  // The entry point is one field, not a catalogue of sources.
  await expect(page.getByText("Accepts YouTube, YouTube Music and Spotify links.")).toBeVisible();
  await expect(page.getByText(/MusicBrainz|Cifra Club|Songsterr|Discogs/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Enter manually" })).toBeVisible();

  // 1. Links that are refused, each with its own state.
  const problem = page.getByTestId("link-problem");
  await identify(page, "javascript:alert(1)");
  await expect(problem).toHaveAttribute("data-state", "invalid_url");
  await identify(page, "https://vimeo.com/76979871");
  await expect(problem).toHaveAttribute("data-state", "unsupported_platform");
  await expect(problem).toContainText("Unsupported platform");
  await identify(page, "https://www.youtube.com/playlist?list=PLabc123");
  await expect(problem).toHaveAttribute("data-state", "unsupported_link");
  await identify(page, "https://www.youtube.com/watch?v=AAAAAAAAAAA");
  await expect(problem).toHaveAttribute("data-state", "reference_not_found");
  await expect(problem).toContainText("Reference not found");
  await expect(page.getByTestId("reference-preview")).toHaveCount(0);
  await page.screenshot({ path: "test-results/ref-01-not-found.png", fullPage: true });

  // 2. A valid YouTube link is identified through the platform.
  await identify(page, `https://youtu.be/${YT_ID}?si=share-tracking&t=42`);
  const preview = page.getByTestId("reference-preview");
  await expect(preview).toHaveAttribute("data-platform", "youtube");
  await expect(preview).toHaveAttribute("data-metadata", "complete");
  await expect(preview).toContainText(YT_TITLE);
  await expect(preview).toContainText("Channel: NatirutsVEVO");
  await expect(preview).toContainText("Reference identified");
  await expect(preview.getByRole("link", { name: YT })).toHaveAttribute("href", YT);
  await expect(problem).toHaveCount(0);
  // The video's name is offered, not assumed: the member corrects title and artist.
  await expect(page.getByLabel("Song title")).toHaveValue(YT_TITLE);
  await expect(page.getByText("a video's name is not always the song's name")).toBeVisible();
  await expect(page.getByLabel("Artist")).toHaveValue(""); // a channel is not presented as the artist
  await page.getByLabel("Song title").fill("Pérola Negra");
  await page.getByLabel("Artist").fill("Natiruts feat. Luiz Melodia");
  await preview.getByRole("button", { name: "Listen to check" }).click();
  await expect(preview.getByTestId("reference-player").locator("iframe")).toHaveAttribute(
    "src",
    `https://www.youtube-nocookie.com/embed/${YT_ID}`,
  );
  await page.screenshot({ path: "test-results/ref-02-identified.png", fullPage: true });

  // 3. Confirm and prepare: a known link is not audio, and nothing is analysed.
  await page.getByRole("button", { name: "Confirm and prepare song" }).click();
  const states = page.getByTestId("preparation-state");
  await expect(states.locator('[data-item="arrangement"]')).toHaveAttribute(
    "data-state",
    "ready_for_review",
    { timeout: 20_000 },
  );
  await expect(states.locator('[data-item="reference"]')).toHaveAttribute(
    "data-state",
    "identified",
  );
  await expect(states.locator('[data-item="audio"]')).toHaveAttribute("data-state", "none");
  await expect(states.locator('[data-item="audio"]')).toContainText(
    "Audio not available for analysis",
  );
  await expect(states.locator('[data-item="analysis"]')).toHaveAttribute(
    "data-state",
    "not_possible",
  );
  await expect(states).toContainText("Arrangement ready for review");
  await expect(page.getByRole("spinbutton", { name: "Band BPM" })).toHaveValue(""); // nothing invented

  // 4. The band's own values, the repertoire, and the end of the review.
  await page.getByRole("spinbutton", { name: "Band BPM" }).fill("72");
  await page.getByRole("button", { name: "Confirm Band BPM" }).click();
  await expect(page.getByText(/Confirmed by Ana Drums on/).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm Band time signature" }).click();
  await expect(page.getByText(/Confirmed by Ana Drums on/)).toHaveCount(2);
  await page.getByLabel("Repertoire").selectOption({ label: "Thursday" });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Added to “Thursday”")).toBeVisible();
  await page.getByRole("button", { name: "Finish review" }).click();
  await expect(states.locator('[data-item="arrangement"]')).toHaveAttribute(
    "data-state",
    "reviewed",
  );
  await page.screenshot({ path: "test-results/ref-03-prepared.png", fullPage: true });

  // 5. The song sheet: reference recording first, band arrangement second, sources tucked away.
  await page.getByRole("link", { name: "Open song sheet" }).click();
  await expect(page.getByRole("heading", { name: "Pérola Negra", level: 1 })).toBeVisible();
  const block = page.getByTestId("reference-block");
  await expect(block).toHaveAttribute("data-state", "identified");
  await expect(block).toContainText("Pérola Negra");
  await expect(block).toContainText("Natiruts feat. Luiz Melodia");
  await expect(block.locator('[data-platform="youtube"]')).toHaveText("YouTube");
  await expect(block.getByRole("link", { name: "Open original recording" })).toHaveAttribute(
    "href",
    YT,
  );
  await expect(block.getByRole("button", { name: "Change reference" })).toBeVisible();
  await block.getByRole("button", { name: "Listen here" }).click();
  await expect(block.getByTestId("reference-player").locator("iframe")).toHaveAttribute(
    "src",
    `https://www.youtube-nocookie.com/embed/${YT_ID}`,
  );
  const arrangement = page.getByTestId("band-arrangement");
  await expect(arrangement.getByRole("heading", { name: "Band arrangement" })).toBeVisible();
  await expect(arrangement.getByTestId("materials-overview")).toContainText(
    "Bass tab · Bass · Pending",
  );
  const technical = page.getByTestId("technical-details");
  await expect(technical).not.toHaveAttribute("open", "");
  await expect(page.getByText("Title on the platform")).toBeHidden();
  await technical.locator("summary").first().click();
  await expect(technical).toContainText("Identified by");
  await expect(technical).toContainText(YT_TITLE);
  await expect(technical).toContainText("NatirutsVEVO");
  await page.screenshot({ path: "test-results/ref-04-song-sheet.png", fullPage: true });
  // The link persists.
  await page.reload();
  await expect(page.getByTestId("reference-block")).toHaveAttribute("data-state", "identified");
  const songUrl = page.url();

  // 6. Another member, on a phone, sees the same reference and cannot change it.
  const member = await contextFor(browser, bruno, { ...devices["iPhone 13"] });
  await member.page.goto(songUrl);
  const theirs = member.page.getByTestId("reference-block");
  await expect(theirs).toContainText("Pérola Negra");
  await expect(theirs).toContainText("Natiruts feat. Luiz Melodia");
  await expect(theirs.getByRole("link", { name: "Open original recording" })).toHaveAttribute(
    "href",
    YT,
  );
  await expect(theirs.getByRole("button", { name: "Change reference" })).toHaveCount(0);
  await expect(member.page.getByTestId("band-values")).toContainText("72");
  const overflow = await member.page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await member.page.screenshot({ path: "test-results/ref-05-member-mobile.png", fullPage: true });
  // In the repertoire, the reference is one tap away.
  await member.page.goto(`/bands/${bandId}/repertoires`);
  await member.page.getByRole("link", { name: /Thursday/ }).click();
  await expect(member.page.getByTestId("reference-open")).toHaveAttribute("href", YT);

  // 7. Live rehearsal: tempo and devices are synchronised; the reference is opened locally.
  await page.goto(`/bands/${bandId}/rehearsal`);
  await page.getByLabel("Repertoire for this session").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/rehearsal\/[0-9a-f-]+$/);
  const room = page.url();
  await page.getByRole("button", { name: "Enable sound" }).click();
  await member.page.goto(room);
  await member.page.getByRole("button", { name: "Enable sound" }).click();
  await page.getByRole("button", { name: "Choose song" }).click();
  await page.getByRole("button", { name: /Pérola Negra/ }).click();
  await expect(member.page.getByText("Pérola Negra").first()).toBeVisible();
  await expect(member.page.getByText("72", { exact: true }).first()).toBeVisible();
  await expect(member.page.getByTestId("tempo-source")).toHaveCount(0); // confirmed by the band
  await expect(member.page.getByText("Bass tab · Bass").first()).toBeVisible();
  await member.page.getByTestId("room-reference").click();
  const panel = member.page.getByTestId("room-reference-panel");
  await expect(panel).toContainText("Natiruts feat. Luiz Melodia");
  await expect(panel.getByRole("link", { name: "Open original recording" })).toHaveAttribute(
    "href",
    YT,
  );
  await expect(panel).toContainText("Plays on this device only");
  await member.page.screenshot({ path: "test-results/ref-06-room-mobile.png" });
  await member.page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(member.page.getByText("Playing").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Stop" }).click();
  await member.context.close();
  await context.close();
});

test("changing the reference asks before replacing; a new link for the same recording keeps everything", async ({
  browser,
}) => {
  const ana = await registerUser("Ana Drums", "drums");
  const bandId = await createBand(ana, `Change Band ${Date.now()}`);
  const songId = await prepareViaApi(ana, bandId, {
    newSong: { title: "Never Gonna Give You Up" },
    recording: { source: "link", title: "Never Gonna Give You Up", artistCredit: "A live video" },
    referenceUrl: YT,
  });
  await ana.api.post(`/api/bands/${bandId}/autoarrange/songs/${songId}/review`, {
    data: { target: "band_bpm", bpm: 113 },
  });

  const { page, context } = await contextFor(browser, ana);
  await page.goto(`/bands/${bandId}/songs/${songId}`);
  const block = page.getByTestId("reference-block");
  await expect(block.locator('[data-platform="youtube"]')).toBeVisible();

  // 1. Authorised audio is a separate thing from the link, and still not an analysis.
  const states = page.getByTestId("preparation-state");
  await states.getByRole("button", { name: "Upload authorised audio" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "our-take.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00]),
  });
  await expect(dialog.getByRole("button", { name: "Upload" })).toBeDisabled(); // no declaration yet
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Upload" }).click();
  await expect(states.locator('[data-item="audio"]')).toHaveAttribute("data-state", "available");
  await expect(states.locator('[data-item="audio"]')).toContainText("our-take.mp3");
  await expect(states.locator('[data-item="analysis"]')).toHaveAttribute("data-state", "pending");
  await expect(states).toContainText("Analysis pending");
  await expect(page.locator('[data-kind="bpm"]')).toHaveCount(0);

  // 2. A Spotify link for another recording.
  await block.getByRole("button", { name: "Change reference" }).click();
  await expect(
    page.getByRole("heading", { name: "Change the reference recording", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("current-reference")).toContainText("A live video");
  await identify(page, `https://open.spotify.com/intl-pt/track/${SPOTIFY_ID}?si=abc`);
  const preview = page.getByTestId("reference-preview");
  await expect(preview).toHaveAttribute("data-platform", "spotify");
  await expect(preview).toHaveAttribute("data-metadata", "partial");
  await expect(preview).toContainText("Never Gonna Give You Up");
  await expect(preview.getByRole("link", { name: SPOTIFY })).toHaveAttribute("href", SPOTIFY);
  await expect(page.getByText("Spotify does not name the artist")).toBeVisible();
  await page.getByLabel("Artist").fill("Rick Astley");
  await expect(page.getByRole("radio", { name: /Another recording/ })).toBeChecked();
  await page.getByRole("button", { name: "Confirm and prepare song" }).click();

  // 3. Confirmed tempo and audio depend on the current recording: the app asks first.
  const warning = page.getByTestId("replace-warning");
  await expect(warning).toContainText("Band BPM confirmed");
  await expect(warning).toContainText("1 audio file");
  await expect(warning).toContainText("The existing musical data will be kept");
  await page.screenshot({ path: "test-results/ref-07-replace-warning.png" });
  await warning.getByRole("button", { name: "Cancel" }).click();
  // Cancelled: nothing changed.
  const before = (await (await ana.api.get(`/api/bands/${bandId}/songs/${songId}`)).json()).song;
  expect(before.reference.url).toBe(YT);
  await page.getByRole("button", { name: "Confirm and prepare song" }).click();
  await page.getByRole("button", { name: "Confirm replacement" }).click();
  await expect(
    page.getByTestId("preparation-state").locator('[data-item="arrangement"]'),
  ).toHaveAttribute("data-state", "ready_for_review", { timeout: 20_000 });
  // The tempo the band confirmed is kept, and flagged as older than the reference.
  await expect(page.getByRole("spinbutton", { name: "Band BPM" })).toHaveValue("113");
  await expect(page.locator('[data-stale="true"]')).toContainText("check again");

  await page.getByRole("link", { name: "Open song sheet" }).click();
  await expect(block.locator('[data-platform="spotify"]')).toHaveText("Spotify");
  await expect(block).toContainText("Rick Astley");
  await block.getByRole("button", { name: "Listen here" }).click();
  await expect(block.getByTestId("reference-player").locator("iframe")).toHaveAttribute(
    "src",
    `https://open.spotify.com/embed/track/${SPOTIFY_ID}`,
  );
  const technical = page.getByTestId("technical-details");
  await technical.locator("summary").first().click();
  await expect(technical.getByTestId("previous-references")).toContainText("A live video");
  await expect(technical.getByTestId("previous-references")).toContainText("YouTube");
  await expect(technical.getByTestId("history").locator('[data-target="reference"]')).toHaveCount(
    2,
  );
  await page.screenshot({ path: "test-results/ref-08-after-replace.png", fullPage: true });
  const after = (await (await ana.api.get(`/api/bands/${bandId}/songs/${songId}`)).json()).song;
  expect(after.version.bpm).toBe(113);
  expect(after.reference).toMatchObject({ platform: "spotify", url: SPOTIFY });

  // 4. A recording identified without a link: adding the link keeps the recording and its data.
  const pendingId = await prepareViaApi(ana, bandId, {
    newSong: { title: "O Segundo Sol" },
    recording: { source: "musicbrainz", mbid: SEGUNDO_SOL_GIL },
  });
  await page.goto(`/bands/${bandId}/songs/${pendingId}`);
  await expect(block).toHaveAttribute("data-state", "link_pending");
  await expect(block).toContainText("Link pending");
  await expect(block).toContainText("No other recording is chosen automatically");
  await expect(block).toContainText("Cássia Reggae, Vol. 1");
  await expect(
    page.getByTestId("preparation-state").locator('[data-item="reference"]'),
  ).toHaveAttribute("data-state", "link_pending");
  await block.getByRole("button", { name: "Add link" }).click();
  await identify(page, YT);
  await expect(page.getByRole("radio", { name: /The same reference recording/ })).toBeChecked();
  await page.getByRole("button", { name: "Save link" }).click();
  await expect(page).toHaveURL(new RegExp(`/songs/${pendingId}$`));
  await expect(block).toHaveAttribute("data-state", "identified");
  await expect(block).toContainText("O segundo sol");
  await expect(block).toContainText("4:18"); // the catalogue's duration is still attached
  await context.close();
});

test("an existing song gets its reference in Portuguese on a phone, and the catalogue search still works", async ({
  browser,
}) => {
  const ana = await registerUser("Ana Drums", "drums", "pt-BR");
  const bandId = await createBand(ana, `Referência PT ${Date.now()}`);
  const created = await ana.api.post(`/api/bands/${bandId}/songs`, {
    data: {
      title: "O Segundo Sol",
      artist: "Gilberto Gil",
      composer: "Nando Reis",
      version: { bpm: 90, key: "A", beatsPerBar: 4, beatUnit: 4 },
    },
  });
  const songId = (await created.json()).song.id as string;
  const pt = { link: "Link da gravação", go: "Identificar" };

  const { page, context } = await contextFor(browser, ana, { ...devices["iPhone 13"] });
  await page.goto(`/bands/${bandId}/songs/${songId}`);
  const block = page.getByTestId("reference-block");
  await expect(block).toHaveAttribute("data-state", "none");
  await expect(block).toContainText("Nenhuma gravação de referência definida.");
  await expect(page.getByTestId("preparation-state")).toContainText("Referência não definida");
  await block.getByRole("button", { name: "Definir referência" }).click();
  await expect(
    page.getByRole("heading", { name: "Definir gravação de referência", level: 1 }),
  ).toBeVisible();

  // States in Portuguese.
  const problem = page.getByTestId("link-problem");
  await identify(page, "https://soundcloud.com/artista/faixa", pt);
  await expect(problem).toContainText("Plataforma não suportada");
  await identify(page, "https://open.spotify.com/track/0000000000000000000000", pt);
  await expect(problem).toContainText("Referência não encontrada");
  // A video whose owner does not allow embedding: the link is kept, the limits are stated.
  await identify(page, "https://www.youtube.com/watch?v=RESTRICTED1", pt);
  const preview = page.getByTestId("reference-preview");
  await expect(preview).toHaveAttribute("data-metadata", "missing");
  await expect(preview).toContainText("Metadados ausentes");
  await expect(preview).toContainText("Player indisponível");
  await expect(preview.getByTestId("reference-player")).toHaveCount(0);
  await page.screenshot({ path: "test-results/ref-09-mobile-pt-restricted.png", fullPage: true });

  await identify(page, `spotify:track:${SPOTIFY_ID}`, pt);
  await expect(preview).toHaveAttribute("data-platform", "spotify");
  await expect(preview).toContainText("Referência identificada");
  // The song keeps its own title; only the artist of the recording is asked.
  await expect(page.getByLabel("Título da música")).toHaveCount(0);
  await expect(page.getByLabel("Artista")).toHaveValue("Gilberto Gil");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/ref-10-mobile-pt.png", fullPage: true });
  await page.getByRole("button", { name: "Confirmar e preparar música" }).click();
  const states = page.getByTestId("preparation-state");
  await expect(states).toContainText("Arranjo pronto para revisão", { timeout: 20_000 });
  await expect(states).toContainText("Referência identificada");
  await expect(states).toContainText("Áudio não disponível para análise");
  await expect(states).toContainText("Análise não realizada");

  // The band's own values and the composer it had typed are untouched.
  const after = (await (await ana.api.get(`/api/bands/${bandId}/songs/${songId}`)).json()).song;
  expect(after.composer).toBe("Nando Reis");
  expect(after.version.bpm).toBe(90);
  expect(after.version.key).toBe("A");
  expect(after.reference).toMatchObject({ platform: "spotify", artist: "Gilberto Gil" });

  // Without a link at hand, the open catalogue still tells versions apart.
  await page.goto(`/bands/${bandId}/songs/add`);
  await page.getByRole("button", { name: "Buscar por título e artista" }).click();
  await page.getByLabel("Título da música").fill("Esotérico");
  await page.getByLabel("Artista (opcional)").fill("Gilberto Gil");
  await page.getByRole("button", { name: "Buscar" }).click();
  const results = page.getByTestId("recording-results");
  await expect(results.locator("li")).toHaveCount(22);
  const umBandaUm = results.locator('[data-mbid="8379142a-fe4e-4da2-8edf-fb493665a54f"]');
  await expect(umBandaUm).toContainText("Um Banda Um");
  await umBandaUm.getByRole("button", { name: "Selecionar" }).click();
  await expect(page.getByTestId("recording-preview")).toContainText(
    "A fonte não informa quem compôs esta gravação",
  );
  await page.getByRole("button", { name: "Preparar música" }).click();
  await expect(page.getByTestId("preparation-state")).toContainText("Link da referência pendente", {
    timeout: 20_000,
  });
  await page.getByRole("link", { name: "Abrir ficha da música" }).click();
  const sheet = page.getByTestId("reference-block");
  await expect(sheet).toHaveAttribute("data-state", "link_pending");
  await expect(sheet).toContainText("Um Banda Um");
  await expect(sheet).toContainText("4:22");
  await context.close();
});

test("preparing a song that already has a reference: no raw error, three clear choices, nothing lost", async ({
  browser,
}) => {
  const ana = await registerUser("Ana Drums", "drums", "pt-BR");
  const bandId = await createBand(ana, `Confirmação ${Date.now()}`);
  const { page, context } = await contextFor(browser, ana, { ...devices["iPhone 13"] });
  // An internal key must never reach the screen, whatever happens below.
  const noRawKeys = async () => expect(page.getByText(/\berrors\.[a-z_]+/)).toHaveCount(0);
  const pt = { link: "Link da gravação", go: "Identificar" };

  // 1. A song with no reference: the video is attached with no question.
  const created = await ana.api.post(`/api/bands/${bandId}/songs`, {
    data: {
      title: "Esotérico",
      artist: "Gilberto Gil",
      version: { bpm: 96, key: "D", beatsPerBar: 4, beatUnit: 4 },
    },
  });
  const songId = (await created.json()).song.id as string;
  await page.goto(`/bands/${bandId}/songs/add?song=${songId}`);
  await identify(page, YT, pt);
  await page.getByRole("button", { name: "Confirmar e preparar música" }).click();
  const states = page.getByTestId("preparation-state");
  await expect(states).toContainText("Arranjo pronto para revisão", { timeout: 20_000 });
  await expect(page.getByTestId("replace-warning")).toHaveCount(0);
  await noRawKeys();

  // Pasting that same video for another song warns that it already belongs to Esotérico.
  const other = await ana.api.post(`/api/bands/${bandId}/songs`, {
    data: { title: "Outra música", version: { beatsPerBar: 4, beatUnit: 4 } },
  });
  const otherId = (await other.json()).song.id as string;
  await page.goto(`/bands/${bandId}/songs/add?song=${otherId}`);
  await identify(page, `https://youtu.be/${YT_ID}`, pt);
  await expect(page.getByTestId("link-used-by")).toContainText(
    "já é a gravação de referência de “Esotérico”",
  );
  await page.screenshot({ path: "test-results/confirm-00-used-by-pt.png" });

  // Work done on that recording: a ready material.
  const material = await ana.api.post(`/api/bands/${bandId}/songs/${songId}/materials`, {
    data: {
      type: "chords",
      instrument: "guitar",
      title: "Nossa cifra",
      body: "D  G  A",
      status: "ready",
    },
  });
  expect(material.status()).toBe(201);
  const state = async () => {
    const d = await (await ana.api.get(`/api/bands/${bandId}/songs/${songId}`)).json();
    return {
      reference: d.song.reference?.url ?? null,
      bpm: d.song.version.bpm,
      key: d.song.version.key,
      materials: d.materials
        .map((m: { title: string; status: string }) => `${m.title}:${m.status}`)
        .sort(),
    };
  };
  expect(await state()).toMatchObject({ reference: YT, bpm: 96, key: "D" });

  // 2. The same recording again (YouTube Music page of the same video): no question.
  await page.goto(`/bands/${bandId}/songs/add?song=${songId}`);
  await identify(page, `https://music.youtube.com/watch?v=${YT_ID}`, pt);
  await page.getByRole("radio", { name: /Outra gravação/ }).check();
  await page.getByRole("button", { name: "Confirmar e preparar música" }).click();
  await expect(states).toContainText("Arranjo pronto para revisão", { timeout: 20_000 });
  await expect(page.getByTestId("replace-warning")).toHaveCount(0);
  await noRawKeys();
  // Same recording, so only its link was updated; everything else is as it was.
  const before = await state();
  expect(before).toMatchObject({
    reference: `https://music.youtube.com/watch?v=${YT_ID}`,
    bpm: 96,
    key: "D",
  });
  expect(before.materials).toContain("Nossa cifra:ready");

  // 3. Another recording: a translated question with three choices.
  await page.goto(`/bands/${bandId}/songs/add?song=${songId}`);
  await identify(page, SPOTIFY, pt);
  await page.getByRole("radio", { name: /Outra gravação/ }).check();
  await page.getByRole("button", { name: "Confirmar e preparar música" }).click();
  const warning = page.getByTestId("replace-warning");
  await expect(warning).toContainText(
    "Esta música já possui uma gravação de referência. Deseja substituí-la? Os dados musicais existentes serão preservados, mas poderão precisar de revisão.",
  );
  await expect(warning.getByTestId("replace-current")).toContainText("YouTube");
  await expect(warning).toContainText("1 material pronto");
  await expect(warning.getByRole("button", { name: "Cancelar" })).toBeVisible();
  await expect(warning.getByRole("button", { name: "Manter referência atual" })).toBeVisible();
  await expect(warning.getByRole("button", { name: "Confirmar substituição" })).toBeVisible();
  await noRawKeys();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/confirm-01-dialog-pt.png" });

  // 3a. Cancel: the dialog closes and nothing changed.
  await warning.getByRole("button", { name: "Cancelar" }).click();
  await expect(warning).toHaveCount(0);
  expect(await state()).toEqual(before);

  // 3b. Keep the current reference: preparation runs with it, nothing changed.
  await page.getByRole("button", { name: "Confirmar e preparar música" }).click();
  await warning.getByRole("button", { name: "Manter referência atual" }).click();
  await expect(states).toContainText("Arranjo pronto para revisão", { timeout: 20_000 });
  await expect(page.getByTestId("prepared")).toContainText("YouTube Music");
  expect(await state()).toEqual(before);
  await noRawKeys();

  // 3c. Confirm the replacement: the new recording is the reference, the band's data is intact.
  await page.goto(`/bands/${bandId}/songs/add?song=${songId}`);
  await identify(page, SPOTIFY, pt);
  await page.getByRole("radio", { name: /Outra gravação/ }).check();
  await page.getByRole("button", { name: "Confirmar e preparar música" }).click();
  await warning.getByRole("button", { name: "Confirmar substituição" }).click();
  await expect(states).toContainText("Arranjo pronto para revisão", { timeout: 20_000 });
  await noRawKeys();
  const after = await state();
  expect(after).toEqual({ ...before, reference: SPOTIFY });
  await page.screenshot({ path: "test-results/confirm-02-after-replace-pt.png", fullPage: true });
  await page.getByRole("link", { name: "Abrir ficha da música" }).click();
  await expect(
    page.getByTestId("reference-block").locator('[data-platform="spotify"]'),
  ).toBeVisible();
  await context.close();
});

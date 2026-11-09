import { devices, expect, test } from "@playwright/test";
import {
  contextFor,
  createBand,
  createRepertoire,
  inviteCode,
  join,
  registerUser,
} from "./helpers";

const PEROLA = "0dea3c9a-ef6b-4707-90d8-685b2f4a2cd8";
const UM_BANDA_UM = "8379142a-fe4e-4da2-8edf-fb493665a54f";
const DOCES_BARBAROS = "d72d41dd-fb12-4775-8188-d95c1fdabfe3";
const SEGUNDO_SOL_GIL = "790c0007-1df2-4d2e-bd34-8a772894e800";

test("AutoArrange: find the exact recording, prepare, review and rehearse", async ({ browser }) => {
  const ana = await registerUser("Ana Drums", "drums");
  const bruno = await registerUser("Bruno Bass", "bass");
  const bandId = await createBand(ana, `Arrange Band ${Date.now()}`);
  await join(bruno, await inviteCode(ana, bandId, "bass"));
  await createRepertoire(ana, bandId, "Thursday", []);

  const { page, context } = await contextFor(browser, ana);
  await page.goto(`/bands/${bandId}/songs`);
  await page.getByRole("link", { name: "Add song" }).first().click();
  await expect(page.getByRole("heading", { name: "Add song", level: 1 })).toBeVisible();
  // The source registry says what may be done with each site.
  await expect(page.getByText("Sources and how BandSync may use them")).toBeVisible();
  await expect(page.getByText("Link only").first()).toBeVisible();

  // 1. One composition, many recordings: each version is its own result.
  await page.getByLabel("Song title").fill("Esotérico");
  await page.getByLabel("Artist (optional)").fill("Gilberto Gil");
  await page.getByRole("button", { name: "Search" }).click();
  const results = page.getByTestId("recording-results");
  await expect(results.locator("li")).toHaveCount(22);
  await expect(results.locator(`[data-mbid="${UM_BANDA_UM}"]`)).toContainText("Um Banda Um");
  await expect(results.locator(`[data-mbid="${UM_BANDA_UM}"]`)).toContainText("4:22");
  await expect(results.locator(`[data-mbid="${DOCES_BARBAROS}"]`)).toContainText("4:11");
  await expect(results.locator(`[data-mbid="${DOCES_BARBAROS}"]`)).toContainText("Maria Bethânia");
  await page.screenshot({ path: "test-results/aa-01-versions.png", fullPage: true });

  // The source does not say who wrote this recording: the app says so instead of guessing.
  await results
    .locator(`[data-mbid="${UM_BANDA_UM}"]`)
    .getByRole("button", { name: "Select" })
    .click();
  await expect(page.getByTestId("recording-preview")).toContainText(
    "The source does not say who wrote this recording",
  );
  await page.getByRole("button", { name: "Change recording" }).click();

  // 2. The reference recording of Pérola Negra, with composer, ISRC and release.
  await page.getByLabel("Song title").fill("Pérola Negra");
  await page.getByLabel("Artist (optional)").fill("Natiruts");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(results.locator("li")).toHaveCount(2);
  await results.locator(`[data-mbid="${PEROLA}"]`).getByRole("button", { name: "Select" }).click();
  const preview = page.getByTestId("recording-preview");
  await expect(preview).toContainText("Natiruts Part. Especial Luiz Melodia");
  await expect(preview).toContainText("Mirante Dona Marta");
  await expect(preview).toContainText("Luiz Melodia");
  await expect(preview).toContainText("BR4W41200009");
  await expect(preview).toContainText("3:30");
  await expect(page.getByLabel("Release")).toContainText("Acústico no Rio de Janeiro (2012-09-17)");

  // 3. YouTube reference: validated, played only through the official player.
  await page.getByLabel("YouTube link").fill("https://www.youtube.com/watch?v=AAAAAAAAAAA");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("This link is not an available YouTube video.")).toBeVisible();
  await page.getByLabel("YouTube link").fill("https://youtu.be/JZqFoTIAJj8");
  await page.getByRole("button", { name: "Check" }).click();
  const yt = page.getByTestId("youtube-preview");
  await expect(yt).toContainText("Channel: NatirutsVEVO");
  await expect(yt.locator("iframe")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/JZqFoTIAJj8",
  );
  await expect(yt).toContainText("does not download or extract audio");

  // 4. Prepare.
  await page.getByLabel("Title in the band").fill("Pérola Negra");
  await page.screenshot({ path: "test-results/aa-02-selected.png", fullPage: true });
  await page.getByRole("button", { name: "Prepare song" }).click();
  const progress = page.getByTestId("job-progress");
  await expect(progress).toHaveAttribute("data-status", "awaiting_review", { timeout: 20_000 });
  await expect(progress.locator('[data-step="searching_references"]')).toHaveAttribute(
    "data-outcome",
    "done",
  );
  await expect(progress.locator('[data-step="analyzing_audio"]')).toContainText(
    "No authorised audio file was provided.",
  );
  await expect(progress.locator('[data-step="detecting_structure"]')).toHaveAttribute(
    "data-outcome",
    "skipped",
  );
  await expect(progress.locator('[data-step="preparing_materials"]')).toContainText(
    "5 workspaces opened",
  );

  // 5. What was found, with origin and review state; nothing analysed is claimed.
  await expect(page.locator('[data-kind="duration"]')).toContainText("3:30");
  await expect(page.locator('[data-kind="duration"]')).toContainText("MusicBrainz");
  await expect(page.locator('[data-kind="duration"]')).toContainText("Not reviewed");
  await expect(page.locator('[data-kind="composer"]')).toContainText("Luiz Melodia");
  await expect(page.locator('[data-kind="bpm"]')).toHaveCount(0);
  await expect(page.getByText("were not analysed")).toBeVisible();

  // 6. Human review: the band confirms its own tempo and meter.
  await page.getByRole("spinbutton", { name: "Band BPM" }).fill("72");
  await page.getByRole("button", { name: "Confirm Band BPM" }).click();
  await expect(page.getByText(/Confirmed by Ana Drums on/).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm Band time signature" }).click();
  await expect(page.getByText(/Confirmed by Ana Drums on/)).toHaveCount(2);

  // 7. Into the repertoire, then finish the review.
  await page.getByLabel("Repertoire").selectOption({ label: "Thursday" });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Added to “Thursday”")).toBeVisible();
  await page.screenshot({ path: "test-results/aa-03-review.png", fullPage: true });
  await page.getByRole("button", { name: "Finish review" }).click();
  await expect(progress).toHaveAttribute("data-status", "completed");

  // 8. The song sheet shows verified data, the reference recording and the player.
  await page.getByRole("link", { name: "Open song sheet" }).click();
  await expect(page.getByRole("heading", { name: "Pérola Negra", level: 1 })).toBeVisible();
  await expect(page.getByText("Acústico no Rio de Janeiro (2012)")).toBeVisible();
  const panel = page.getByTestId("autoarrange-panel");
  await expect(panel).toContainText("Reference recording");
  await expect(panel).toContainText("Natiruts Part. Especial Luiz Melodia");
  await panel.getByRole("button", { name: "Listen to the reference" }).click();
  await expect(panel.locator("iframe")).toHaveAttribute(
    "src",
    /youtube-nocookie\.com\/embed\/JZqFoTIAJj8/,
  );
  await expect(page.getByText("Bass tab · Bass").first()).toBeVisible();
  await page.screenshot({ path: "test-results/aa-04-song-sheet.png", fullPage: true });

  // 9. Live rehearsal uses the confirmed tempo and meter as the band's values.
  await page.goto(`/bands/${bandId}/rehearsal`);
  await page.getByLabel("Repertoire for this session").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/rehearsal\/[0-9a-f-]+$/);
  const room = page.url();
  await page.getByRole("button", { name: "Enable sound" }).click();
  const member = await contextFor(browser, bruno, { ...devices["iPhone 13"] });
  await member.page.goto(room);
  await member.page.getByRole("button", { name: "Enable sound" }).click();
  await page.getByRole("button", { name: "Choose song" }).click();
  await page.getByRole("button", { name: /Pérola Negra/ }).click();
  await expect(member.page.getByText("Pérola Negra").first()).toBeVisible();
  await expect(member.page.getByText("72", { exact: true }).first()).toBeVisible();
  await expect(member.page.getByTestId("tempo-source")).toHaveCount(0); // confirmed: no warning
  await expect(member.page.getByText("Bass tab · Bass").first()).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(member.page.getByText("Playing").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Stop" }).click();
  await member.context.close();
  await context.close();
});

test("AutoArrange on an existing song keeps the band's data, in Portuguese and on a phone", async ({
  browser,
}) => {
  const ana = await registerUser("Ana Drums", "drums", "pt-BR");
  const bandId = await createBand(ana, `Arrange PT ${Date.now()}`);
  const created = await ana.api.post(`/api/bands/${bandId}/songs`, {
    data: {
      title: "O Segundo Sol",
      artist: "Gilberto Gil",
      composer: "Nando Reis",
      version: { bpm: 90, key: "A", beatsPerBar: 4, beatUnit: 4 },
    },
  });
  const songId = (await created.json()).song.id as string;

  const { page, context } = await contextFor(browser, ana, { ...devices["iPhone 13"] });
  await page.goto(`/bands/${bandId}/songs/${songId}`);
  const panel = page.getByTestId("autoarrange-panel");
  await expect(panel).toContainText("Nenhuma gravação identificada ainda.");
  await panel.getByRole("link", { name: "Identificar gravação" }).click();
  await expect(page.getByRole("heading", { name: "Identificar gravação", level: 1 })).toBeVisible();
  // Title and artist come from the song.
  await expect(page.getByLabel("Título da música")).toHaveValue("O Segundo Sol");
  await expect(page.getByLabel("Artista (opcional)")).toHaveValue("Gilberto Gil");
  await page.getByRole("button", { name: "Buscar" }).click();
  const results = page.getByTestId("recording-results");
  await expect(results.locator("li")).toHaveCount(2);
  await expect(results.locator(`[data-mbid="${SEGUNDO_SOL_GIL}"]`)).toContainText(
    "Cássia Reggae, Vol. 1",
  );
  // Phone layout: nothing overflows sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/aa-05-mobile-pt.png", fullPage: true });

  await results
    .locator(`[data-mbid="${SEGUNDO_SOL_GIL}"]`)
    .getByRole("button", { name: "Selecionar" })
    .click();
  await expect(page.getByTestId("recording-preview")).toContainText(
    "A fonte não informa quem compôs esta gravação",
  );
  await page.getByRole("button", { name: "Preparar música" }).click();
  const progress = page.getByTestId("job-progress");
  await expect(progress).toHaveAttribute("data-status", "awaiting_review", { timeout: 20_000 });
  await expect(progress).toContainText("Aguardando revisão");
  await expect(progress.locator('[data-step="analyzing_audio"]')).toContainText(
    "Nenhum arquivo de áudio autorizado foi fornecido.",
  );
  await expect(page.getByText("Nenhum valor é inventado")).toBeVisible();
  await expect(page.locator('[data-kind="duration"]')).toContainText("4:18");
  await expect(page.locator('[data-kind="composer"]')).toHaveCount(0);

  // The band's own values and the composer it had typed are untouched.
  const after = (await (await ana.api.get(`/api/bands/${bandId}/songs/${songId}`)).json()).song;
  expect(after.composer).toBe("Nando Reis");
  expect(after.version.bpm).toBe(90);
  expect(after.version.key).toBe("A");
  expect(after.referenceRecording).toBe("Cássia Reggae, Vol. 1");
  expect(after.referenceYear).toBe(2022);
  expect(after.durationSeconds).toBe(258);
  await context.close();
});

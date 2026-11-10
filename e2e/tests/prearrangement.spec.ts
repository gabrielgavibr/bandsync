import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { encodeWav } from "../../packages/shared/src/analysis/synth";
import { concat, decodeFixture, SR } from "../../packages/shared/test/real-audio";
import { contextFor, createBand, createRepertoire, registerUser } from "./helpers";

/**
 * "Gerar pré-arranjo" end to end.
 *
 * The official YouTube IFrame API script is replaced by a small stand-in with the same methods
 * (no network in tests). Its duration is a test value, not a fact about the real video.
 *
 * The audio analysis runs on real recordings that may be processed: a montage of three
 * public-domain / Creative Commons recordings (see packages/shared/test/fixtures/audio/
 * ATTRIBUTION.md), uploaded as the band's authorised file for a test song named for what it is.
 */
const YT_ID = "JZqFoTIAJj8";
const YT = `https://www.youtube.com/watch?v=${YT_ID}`;
const FAKE_DURATION = 212;

const FAKE_YT_API = `
(() => {
  window.__yt = { time: 0, playing: false, duration: ${FAKE_DURATION}, players: 0 };
  class Player {
    constructor(el, opts) {
      this.opts = opts;
      const box = document.createElement("div");
      box.setAttribute("data-testid", "fake-yt");
      box.setAttribute("data-video", opts.videoId);
      box.textContent = "YouTube player (test stand-in) " + opts.videoId;
      el.replaceWith(box);
      window.__yt.players += 1;
      setTimeout(() => opts.events && opts.events.onReady && opts.events.onReady(), 50);
    }
    getDuration() { return window.__yt.duration; }
    getCurrentTime() { return window.__yt.time; }
    getPlayerState() { return window.__yt.playing ? 1 : 2; }
    seekTo(s) { window.__yt.time = s; }
    playVideo() {
      window.__yt.playing = true;
      this.opts.events && this.opts.events.onStateChange && this.opts.events.onStateChange({ data: 1 });
    }
    pauseVideo() {
      window.__yt.playing = false;
      this.opts.events && this.opts.events.onStateChange && this.opts.events.onStateChange({ data: 2 });
    }
    destroy() {}
  }
  window.YT = { Player };
  if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
})();
`;

async function fakeYouTube(context: BrowserContext) {
  await context.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_YT_API }),
  );
}

/** A B A C A, 18 s each, from three real recordings that may be processed. */
const MONTAGE = join(tmpdir(), `bandsync-montage-${process.pid}.wav`);
test.beforeAll(() => {
  const A = decodeFixture("hungarian-dance-5.ogg", 2, 18);
  const B = decodeFixture("sugar-plum-fairy.ogg", 40, 18);
  const C = decodeFixture("vibe-ace.ogg", 9, 18);
  writeFileSync(MONTAGE, encodeWav(concat(A, B, A, C, A), SR));
});

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("YouTube link: identify, generate, analysis unavailable, map by listening, band version, live room", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ana = await registerUser("Ana Drums", "drums");
  const bandId = await createBand(ana, `Pre-arrangement ${Date.now()}`);
  const { page, context } = await contextFor(browser, ana);
  await fakeYouTube(context);

  // 1. Paste the link, confirm the recording, generate the pre-arrangement.
  await page.goto(`/bands/${bandId}/songs/add`);
  await page.getByLabel("Recording link").fill(YT);
  await page.getByRole("button", { name: "Identify" }).click();
  await expect(page.getByTestId("reference-preview")).toHaveAttribute("data-platform", "youtube");
  await page.getByLabel("Song title").fill("Pérola Negra");
  await page.getByLabel("Artist").fill("Natiruts feat. Luiz Melodia");
  await page.getByRole("button", { name: "Confirm and generate pre-arrangement" }).click();
  const next = page.getByTestId("prearrange-next");
  await expect(next).toContainText("The link lets the band play the recording, not analyse it");
  await next.getByRole("button", { name: "Generate pre-arrangement" }).click();
  await expect(page).toHaveURL(/\/songs\/[^/]+\/arrangement$/);
  const songId = page.url().split("/songs/")[1]!.split("/")[0]!;

  // 2. The official player is mounted for the reference video; its length is kept as a fact.
  await expect(page.getByTestId("fake-yt")).toHaveAttribute("data-video", YT_ID);
  const card = page.getByTestId("prearrangement-card");
  await expect(card).toHaveAttribute("data-stage", "analysis_unavailable");
  const steps = page.getByTestId("stage-list");
  await expect(steps.locator('[data-step="reference_identified"]')).toHaveAttribute(
    "data-state",
    "done",
  );
  await expect(steps.locator('[data-step="analysing_recording"]')).toHaveAttribute(
    "data-state",
    "unavailable",
  );
  await expect(steps).toContainText("Analysis unavailable");
  await expect(page.getByTestId("prearrangement-unavailable")).toContainText(
    "does not allow downloading or processing its audio",
  );
  const facts = page.getByTestId("verified-facts");
  await expect(facts.locator('[data-kind="duration"][data-origin="youtube"]')).toContainText(
    "3:32",
  );
  await expect(facts).toContainText("official YouTube player");
  // Nothing analysed is shown: no tempo, key or sections were invented.
  await expect(page.getByTestId("prearrangement")).toHaveCount(0);
  await expect(page.getByTestId("recording-timeline")).toHaveCount(0);
  await page.screenshot({ path: "test-results/pre-01-unavailable.png", fullPage: true });

  // 3. Map the recording by listening: the member marks where each part starts.
  await page.getByRole("radio", { name: "Mark while listening" }).click();
  const marks = page.getByTestId("marks-way");
  await marks.getByRole("button", { name: "Play from the start" }).click();
  for (const at of [16, 47.5, 80, 176]) {
    await page.evaluate((s) => {
      (window as unknown as { __yt: { time: number } }).__yt.time = s;
    }, at);
    await marks.getByRole("button", { name: "New section here" }).click();
  }
  await expect(page.getByTestId("marks").locator("li")).toHaveCount(4);
  await marks.getByLabel("Tempo to count bars (BPM)").fill("130");
  await marks.getByRole("button", { name: "Create map from marks" }).click();
  const pre = page.getByTestId("prearrangement");
  await expect(pre).toHaveAttribute("data-source", "member_marks");
  await expect(card).toHaveAttribute("data-stage", "awaiting_review");
  await expect(pre.getByTestId("pre-sections").locator("li")).toHaveCount(5);
  // Letters only: a person marked where things change, not what they are.
  await expect(pre.getByTestId("pre-sections")).toContainText("Section A");
  await expect(pre.getByTestId("pre-sections")).not.toContainText("Chorus");
  await expect(pre.getByTestId("recording-timeline").locator("button")).toHaveCount(5);
  // Tapping a section plays it from its start in the official player.
  await pre.getByTestId("recording-timeline").locator('button[data-label="C"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __yt: { time: number } }).__yt.time))
    .toBe(47.5);

  // 4. The band's own version, edited from it.
  const editor = page.getByTestId("arrangement-editor");
  await editor.getByRole("button", { name: "Start from the pre-arrangement" }).click();
  const rows = editor.getByTestId("arrangement-section");
  await expect(rows).toHaveCount(5);
  await editor.getByLabel("Name of section 1").fill("Intro");
  await editor.getByLabel("Name of section 2").fill("Verso");
  await editor.getByLabel("Name of section 3").fill("Refrão");
  await rows.nth(2).getByRole("button", { name: "Repeat" }).click();
  await expect(rows).toHaveCount(6);
  await rows.nth(5).getByRole("button", { name: "Remove" }).click();
  await editor.getByTestId("save-arrangement").click();
  await expect(page.getByText("Band arrangement saved")).toBeVisible();
  await expect(card).toHaveAttribute("data-stage", "ready");
  await expect(pre).toContainText("Reviewed by the band");

  // Saved for everyone; the recording's pre-arrangement is unchanged.
  await page.reload();
  await expect(page.getByTestId("arrangement-section")).toHaveCount(5);
  await expect(page.getByLabel("Name of section 4")).toHaveValue("Refrão");
  const o = await (await ana.api.get(`/api/bands/${bandId}/autoarrange/songs/${songId}`)).json();
  expect(o.prearrangement.data.sections.map((s: { label: string }) => s.label)).toEqual([
    "A",
    "B",
    "C",
    "D",
    "E",
  ]);
  expect(o.song.sections.map((s: { name: string }) => s.name)).toEqual([
    "Intro",
    "Verso",
    "Refrão",
    "Refrão",
    "Section D",
  ]);
  // The player's duration was reported once.
  expect(
    o.results.filter(
      (r: { kind: string; origin: string }) => r.kind === "duration" && r.origin === "youtube",
    ),
  ).toHaveLength(1);

  // 5. Live rehearsal: the arrangement is there for each instrument.
  await createRepertoire(ana, bandId, "Thursday", [songId]);
  await page.goto(`/bands/${bandId}/rehearsal`);
  await page.getByLabel("Repertoire for this session").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("button", { name: "Enable sound" }).click();
  await page.getByRole("button", { name: "Choose song" }).click();
  await page.getByRole("button", { name: /Pérola Negra/ }).click();
  const live = page.getByTestId("live-arrangement");
  await expect(live).toContainText("Intro 9");
  await live.locator("summary").click();
  const view = live.getByTestId("instrument-view");
  await expect(view).toHaveAttribute("data-view", "drums");
  await expect(view.getByTestId("view-section")).toHaveCount(5);
  await view.getByRole("radio", { name: "Bass" }).click();
  await expect(view).toContainText("not the original bass line");
  await page.screenshot({ path: "test-results/pre-02-live.png", fullPage: true });
  await context.close();
});

test("authorised real recording: whole-recording map on the device, editing, original kept, mobile, pt-BR", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const ana = await registerUser("Ana Baixo", "bass", "pt-BR");
  const bandId = await createBand(ana, `Arquivo ${Date.now()}`);
  const created = await ana.api.post(`/api/bands/${bandId}/songs`, {
    data: { title: "Montagem de gravações CC (teste)" },
  });
  expect(created.status()).toBe(201);
  const songId = (await created.json()).song.id as string;
  const { page, context } = await contextFor(browser, ana, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "pt-BR",
  });
  await fakeYouTube(context);

  // The song page leads to the editor.
  await page.goto(`/bands/${bandId}/songs/${songId}`);
  await page.getByTestId("open-arrangement").click();
  await expect(page).toHaveURL(new RegExp(`/songs/${songId}/arrangement$`));
  // No reference: only the band's own file can be mapped (no player, no microphone, no marks).
  const panel = page.getByTestId("generate-panel");
  await expect(panel.getByRole("radio")).toHaveCount(0);
  await panel.getByTestId("prearrange-file").setInputFiles(MONTAGE);
  await panel.getByLabel("Base do direito de uso").selectOption("licensed");
  await panel
    .getByRole("checkbox", { name: "Declaro que a banda tem o direito de processar este arquivo." })
    .check();
  await panel.getByRole("button", { name: "Enviar e gerar pré-arranjo" }).click();

  // The whole recording, analysed on this device.
  const pre = page.getByTestId("prearrangement");
  await expect(pre).toHaveAttribute("data-source", "audio_file", { timeout: 60_000 });
  const card = page.getByTestId("prearrangement-card");
  await expect(card).toHaveAttribute("data-stage", "awaiting_review");
  await expect(pre).toContainText("Estimado · aguardando revisão");
  const labels = await pre
    .getByTestId("pre-sections")
    .locator("li")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-label")));
  expect(labels.length).toBeGreaterThanOrEqual(4);
  // The returning passage (A) is recognised as the same letter.
  expect(labels.filter((l) => l === labels[0]).length).toBeGreaterThanOrEqual(2);
  await expect(pre.getByTestId("recording-timeline")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: "test-results/pre-03-file-mobile.png", fullPage: true });

  const before = await (
    await ana.api.get(`/api/bands/${bandId}/autoarrange/songs/${songId}`)
  ).json();
  expect(before.prearrangement.audioAssetId).toBeTruthy();
  expect(before.prearrangement.recordingId).toBeNull();
  const results = before.results.filter((r: { origin: string }) => r.origin === "audio_analysis");
  expect(results.map((r: { kind: string }) => r.kind).sort()).toEqual(
    ["bpm", "key", "sections", "time_signature"].sort(),
  );
  expect(results.every((r: { reviewStatus: string }) => r.reviewStatus === "needs_review")).toBe(
    true,
  );

  // Edit the band's version: drop the first part, write chords, add a stop, transpose, save.
  const editor = page.getByTestId("arrangement-editor");
  await editor.getByRole("button", { name: "Começar a partir do pré-arranjo" }).click();
  const rows = editor.getByTestId("arrangement-section");
  const count = await rows.count();
  await rows.first().getByRole("button", { name: "Remover" }).click();
  await expect(rows).toHaveCount(count - 1);
  await editor.getByLabel("Nome da seção 1").fill("Parte lenta");
  const chords = rows.first().getByTestId("section-chords");
  await chords.fill("Am Dm E Am");
  await chords.blur();
  await expect(rows.first()).toContainText("Progressão: Am → Dm → E → Am");
  await rows.first().getByRole("button", { name: "Adicionar marcação" }).click();
  await expect(rows.first().getByTestId("section-cues")).toContainText("Parada");
  await editor.getByRole("button", { name: "Transpor +½ tom" }).click();
  // Spelled for the key the arrangement lands in.
  await expect(rows.first()).toContainText(/Progressão: (A#m|Bbm) → (D#m|Ebm) → F → (A#m|Bbm)/);
  await editor.getByTestId("save-arrangement").click();
  await expect(page.getByText("Arranjo da banda salvo")).toBeVisible();
  await expect(card).toHaveAttribute("data-stage", "ready");

  await page.reload();
  await expect(page.getByLabel("Nome da seção 1")).toHaveValue("Parte lenta");
  const after = await (
    await ana.api.get(`/api/bands/${bandId}/autoarrange/songs/${songId}`)
  ).json();
  // The recording's pre-arrangement is exactly as it was generated.
  expect(after.prearrangement).toEqual(before.prearrangement);
  expect(after.song.version.arrangementBaseId).toBe(before.prearrangement.id);
  expect(after.song.version.arrangementTranspose).toBe(1);
  expect(after.song.sections[0].chords.slice(0, 4).join(" ")).toMatch(
    /^(A#m|Bbm) (D#m|Ebm) F (A#m|Bbm)$/,
  );
  expect(after.song.sections[0].cues[0]).toMatchObject({ type: "stop" });
  expect(await noHorizontalScroll(page)).toBe(true);

  // The song page shows it per instrument; the bass view never passes chords off as the bass line.
  await page.goto(`/bands/${bandId}/songs/${songId}`);
  const views = page.getByTestId("instrument-views");
  await expect(views.getByTestId("instrument-view")).toHaveAttribute("data-view", "bass");
  await expect(views).toContainText("não é a linha original do baixo");
  await expect(views).toContainText(/(A#m|Bbm) → (D#m|Ebm) → F → (A#m|Bbm)/);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: "test-results/pre-04-song-mobile.png", fullPage: true });
  await context.close();
});

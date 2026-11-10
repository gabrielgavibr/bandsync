import { devices, expect, type Page, test } from "@playwright/test";
import {
  contextFor,
  createBand,
  createRepertoire,
  createSong,
  inviteCode,
  join,
  registerUser,
} from "./helpers";

/**
 * Live rehearsal on a phone: the music is what the screen is for. The controls are a sheet at
 * the bottom (one row, pulled up in two steps), and the material can take the whole screen.
 */
const IPHONE = devices["iPhone 13"];
const LYRICS = Array.from({ length: 60 }, (_, i) => `Verso ${i + 1}: la la la, meu velho`).join(
  "\n",
);

const fits = (page: Page) =>
  page.evaluate(
    (w) => window.innerWidth <= w + 1 && document.documentElement.scrollWidth <= w + 1,
    page.viewportSize()!.width,
  );
/** Share of the screen's height the material takes. */
const materialShare = async (page: Page) => {
  const box = (await page.getByTestId("room-material").boundingBox())!;
  return box.height / page.viewportSize()!.height;
};

test("phone: bottom sheet in three states, drag, focus mode, transport, click, credit", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ana = await registerUser("Ana Voz", "vocals");
  const bruno = await registerUser("Bruno Baixo", "bass", "pt-BR");
  const bandId = await createBand(ana, `Phone Band ${Date.now()}`);
  await join(bruno, await inviteCode(ana, bandId, "bass"));
  const songA = await createSong(ana, bandId, "Song Alpha", 100, [
    { type: "lyrics", instrument: null, body: LYRICS },
    { type: "chords", instrument: null, body: "C   G   Am   F\nla la la" },
    { type: "bass_tab", instrument: "bass", body: "BASS: G|---3---|" },
  ]);
  const songB = await createSong(ana, bandId, "Song Beta", 140, [
    { type: "lyrics", instrument: null, body: "BETA: outra letra" },
  ]);
  await createRepertoire(ana, bandId, "Thursday", [songA, songB]);

  // The conductor is on a phone too.
  const { page, context } = await contextFor(browser, ana, { ...IPHONE });

  // The credit sits at the bottom of the app's pages, out of the way.
  await page.goto("/bands");
  await expect(page.getByTestId("credit")).toHaveText("Developed by Gabriel Gavinelli");

  await page.goto(`/bands/${bandId}/rehearsal`);
  await page.getByLabel("Repertoire for this session").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/rehearsal\/[0-9a-f-]+$/);
  const sessionUrl = page.url();
  await page.getByRole("button", { name: "Enable sound" }).click();

  // 1. Minimised by default: one row, and nothing of the old tall panel.
  const sheet = page.getByTestId("control-sheet");
  await expect(sheet).toHaveAttribute("data-level", "mini");
  await expect(page.getByRole("button", { name: "Tap" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Choose song" })).toBeHidden();
  const miniHeight = (await sheet.boundingBox())!.height;
  expect(miniHeight).toBeLessThanOrEqual(96);

  // 2. Everything open: choose the song; a tap on the music puts the sheet away.
  await page.getByTestId("sheet-toggle").tap();
  await expect(sheet).toHaveAttribute("data-level", "mid");
  await expect(page.getByRole("button", { name: "Tap" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "BPM" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next song" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose song" })).toBeHidden();
  await page.getByTestId("sheet-toggle").tap();
  await expect(sheet).toHaveAttribute("data-level", "full");
  await expect(page.getByRole("button", { name: "Conductor controls" })).toBeVisible();
  await page.getByRole("button", { name: "Choose song" }).tap();
  await page.getByRole("button", { name: /Song Alpha/ }).tap();
  await expect(page.getByTestId("sheet-summary")).toContainText("Song Alpha");
  await expect(page.getByTestId("sheet-bpm")).toHaveText("100 BPM");
  await page.screenshot({ path: "test-results/live-phone-01-full.png" });
  await page.getByTestId("sheet-backdrop").tap({ position: { x: 20, y: 80 } });
  await expect(sheet).toHaveAttribute("data-level", "mini");

  // 3. The music has the screen: the lyrics take most of it and scroll.
  await expect(page.getByText("Verso 1: la la la, meu velho")).toBeVisible();
  const share = await materialShare(page);
  expect(share, `material takes ${(share * 100).toFixed(0)} % of the screen`).toBeGreaterThan(0.72);
  const material = page.getByTestId("room-material");
  await material.evaluate((el) => el.scrollTo(0, 400));
  expect(await material.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
  await material.evaluate((el) => el.scrollTo(0, 0));
  expect(await fits(page)).toBe(true);
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/live-phone-02-mini.png" });

  // 4. Play and stop from the minimised row; the click switch too.
  const transport = page.getByTestId("sheet-transport");
  await transport.tap();
  await expect(transport).toHaveAttribute("data-running", "true");
  await transport.tap();
  await expect(transport).toHaveAttribute("data-running", "false");
  const click = page.getByTestId("sheet-click");
  await expect(click).toHaveAttribute("aria-pressed", "true");
  await click.tap();
  await expect(click).toHaveAttribute("aria-pressed", "false");
  await expect(click).toHaveAccessibleName("Click off");
  await click.tap();
  await expect(click).toHaveAttribute("aria-pressed", "true");

  // 5. Dragging the handle: up one step, up again, then a long pull down to the smallest.
  const handle = page.getByTestId("sheet-handle");
  const pull = async (dy: number) => {
    await page.waitForTimeout(350); // let the previous transition finish: the handle moves
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy / 2, { steps: 4 });
    await page.mouse.move(x, y + dy, { steps: 4 });
    await page.mouse.up();
  };
  await pull(-90);
  await expect(sheet).toHaveAttribute("data-level", "mid");
  await pull(-90);
  await expect(sheet).toHaveAttribute("data-level", "full");
  await pull(260);
  await expect(sheet).toHaveAttribute("data-level", "mini");
  await handle.tap();
  await expect(sheet).toHaveAttribute("data-level", "mid");

  // 6. Intermediate: tempo and song navigation.
  await page.getByRole("button", { name: "+1 BPM" }).tap();
  await expect(page.getByTestId("sheet-bpm")).toHaveText("101 BPM");
  await page.getByRole("button", { name: "Next song" }).tap();
  await expect(page.getByTestId("sheet-summary")).toContainText("Song Beta");
  await expect(page.getByText("BETA: outra letra")).toBeVisible();
  await page.getByRole("button", { name: "Previous song" }).tap();
  await expect(page.getByTestId("sheet-summary")).toContainText("Song Alpha");
  await page.screenshot({ path: "test-results/live-phone-03-mid.png" });
  await pull(120);
  await expect(sheet).toHaveAttribute("data-level", "mini");

  // 7. Focus: the material alone. A small pill brings the controls back.
  await page.getByTestId("focus-enter").tap();
  await expect(page.locator("[data-focus=true]")).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("banner")).toBeHidden();
  expect(await materialShare(page)).toBeGreaterThan(0.97);
  await expect(page.getByText("Verso 1: la la la, meu velho")).toBeVisible();
  const size = () =>
    page.getByText("Verso 1: la la la, meu velho").evaluate((el) => getComputedStyle(el).fontSize);
  const before = Number.parseFloat(await size());
  await page.getByTestId("focus-tools").getByRole("button", { name: "Larger" }).tap();
  await page.getByTestId("focus-tools").getByRole("button", { name: "Larger" }).tap();
  expect(Number.parseFloat(await size())).toBeGreaterThan(before);
  await material.evaluate((el) => el.scrollTo(0, 600));
  expect(await material.evaluate((el) => el.scrollTop)).toBeGreaterThan(500);
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: "test-results/live-phone-04-focus.png" });
  await page.getByTestId("focus-handle").tap();
  await expect(sheet).toHaveAttribute("data-level", "mini");
  await expect(page.getByRole("banner")).toBeVisible();

  // 8. A musician's phone (pt-BR): ready from the row, the conductor named when opened.
  const b = await contextFor(browser, bruno, { ...IPHONE });
  await b.page.goto(sessionUrl);
  await b.page.getByRole("button", { name: "Ativar som" }).click();
  const bSheet = b.page.getByTestId("control-sheet");
  await expect(bSheet).toHaveAttribute("data-level", "mini");
  await expect(b.page.getByText("BASS: G|---3---|")).toBeVisible();
  await expect(b.page.getByTestId("sheet-transport")).toHaveCount(0);
  const ready = b.page.getByTestId("sheet-ready");
  await expect(ready).toHaveAttribute("aria-pressed", "false");
  await ready.tap();
  await expect(ready).toHaveAttribute("aria-pressed", "true");
  await b.page.getByTestId("sheet-toggle").tap();
  await b.page.getByTestId("sheet-toggle").tap();
  await expect(bSheet).toHaveAttribute("data-level", "full");
  await expect(bSheet).toContainText("Regente: Ana Voz");
  await expect(bSheet.getByRole("button", { name: "Tela cheia" })).toBeVisible();
  expect(await fits(b.page)).toBe(true);
  // The conductor starts: the musician's row shows it without opening anything.
  await transport.tap();
  await expect(b.page.getByText(/Contagem|Tocando/).first()).toBeVisible();
  await transport.tap();
  await b.page.goto("/bands");
  await expect(b.page.getByTestId("credit")).toHaveText("Desenvolvido por Gabriel Gavinelli");

  // 9. Ending the session is still there, under the conductor's controls.
  await page.getByTestId("sheet-toggle").tap();
  await page.getByTestId("sheet-toggle").tap();
  await page.getByRole("button", { name: "Conductor controls" }).tap();
  await page.getByRole("button", { name: "End session" }).tap();
  await page.getByRole("button", { name: "Confirm" }).tap();
  await expect(page.getByRole("heading", { name: /ended/i })).toBeVisible();
  await b.context.close();
  await context.close();
});

test("larger screens keep the full panel", async ({ browser }) => {
  const ana = await registerUser("Ana Desk", "keys");
  const bandId = await createBand(ana, `Desk Band ${Date.now()}`);
  const song = await createSong(ana, bandId, "Song Alpha", 100, [
    { type: "lyrics", instrument: null, body: "LYRICS" },
  ]);
  await createRepertoire(ana, bandId, "Thursday", [song]);
  const { page, context } = await contextFor(browser, ana);
  await page.goto(`/bands/${bandId}/rehearsal`);
  await page.getByLabel("Repertoire for this session").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("button", { name: "Enable sound" }).click();
  await expect(page.getByTestId("control-sheet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose song" })).toBeVisible();
  // Focus mode is offered here as well.
  await page.getByRole("button", { name: "Choose song" }).click();
  await page.getByRole("button", { name: /Song Alpha/ }).click();
  await page.getByTestId("focus-enter").click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeHidden();
  await page.getByTestId("focus-exit").click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await context.close();
});

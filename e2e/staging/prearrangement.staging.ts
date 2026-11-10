import { readFileSync } from "node:fs";
import { devices, expect, test } from "@playwright/test";

/**
 * AutoArrange 3.0 on staging, with the real repertoire and the real official player. Creates
 * nothing: it opens the arrangement page of Pérola Negra (whose link is confirmed), checks the
 * stages and what is verified, and the mobile layout. Opening the page lets the official player
 * report the video's length, as it does for any member.
 */
function credentials() {
  const text = readFileSync(
    process.env.STAGING_CREDENTIALS ?? "../apps/api/.staging/credentials.txt",
    "utf8",
  );
  const key = /Access key[^:]*:\s*(\S+)/.exec(text)?.[1];
  const ana = /ana@bandsync\.demo\s+(\S+)/.exec(text)?.[1];
  if (!key || !ana) throw new Error("credentials not found");
  return { key, ana };
}

const SHOTS = "../test-results/staging";

for (const mobile of [false, true]) {
  test(`pre-arrangement page of Pérola Negra (${mobile ? "mobile" : "desktop"})`, async ({
    browser,
  }) => {
    const { key, ana } = credentials();
    const context = await browser.newContext(
      mobile ? { ...devices["Pixel 7"], locale: "pt-BR" } : { locale: "pt-BR" },
    );
    const page = await context.newPage();
    await page.goto("/");
    await page.locator("input[name=key]").fill(key);
    await page.locator("button[type=submit]").click();
    await expect(page).toHaveURL(/\/login/);
    await page.locator("input[name=email]").fill("ana@bandsync.demo");
    await page.locator("input[name=password]").fill(ana);
    await page.locator("form button[type=submit]").click();
    await expect(page.getByRole("heading", { name: "Minhas bandas" })).toBeVisible({
      timeout: 30_000,
    });
    await page
      .getByRole("link", { name: /Sala 3/ })
      .first()
      .click();
    await page.getByRole("link", { name: "Músicas" }).first().click();
    await page
      .getByRole("link", { name: /^Pérola Negra/ })
      .first()
      .click();
    await page.getByTestId("open-arrangement").click();
    await expect(page).toHaveURL(/\/arrangement$/);

    const card = page.getByTestId("prearrangement-card");
    await expect(card).toBeVisible();
    const stage = await card.getAttribute("data-stage");
    await expect(
      page.getByTestId("stage-list").locator('[data-step="reference_identified"]'),
    ).toHaveAttribute("data-state", "done");
    // The real official player for the confirmed video.
    const player = page.getByTestId("youtube-player");
    await expect(player).toBeVisible();
    const iframe = player.locator("iframe");
    const loaded = await iframe
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (loaded)
      await expect(iframe).toHaveAttribute("src", /youtube(-nocookie)?\.com\/embed\/JZqFoTIAJj8/);
    // Nothing is presented as an analysis of this recording unless one was generated.
    if (stage === "analysis_unavailable")
      await expect(page.getByTestId("prearrangement")).toHaveCount(0);
    await expect(page.getByText(/\berrors\.[a-z_]+/)).toHaveCount(0);
    if (mobile)
      expect(
        await page.evaluate(
          (w) => window.innerWidth <= w + 1 && document.documentElement.scrollWidth <= w + 1,
          page.viewportSize()!.width,
        ),
      ).toBe(true);
    // Give the player a moment to report the length before the screenshot.
    if (loaded)
      await expect(page.getByTestId("verified-facts").locator('[data-origin="youtube"]'))
        .toBeVisible({ timeout: 20_000 })
        .catch(() => undefined);
    await page.screenshot({
      path: `${SHOTS}/20-pre-arranjo-perola-${mobile ? "celular" : "desktop"}.png`,
      fullPage: true,
    });
    console.log(JSON.stringify({ mobile, stage, playerLoaded: loaded }));
    await context.close();
  });
}

import { devices, expect, test } from "@playwright/test";
import { api, credentials, fits, login, SHOTS, throughGate } from "./support";

/**
 * The band people use, READ ONLY. No live session is entered, no setting is toggled, no page
 * that records anything is opened (the arrangement page of a YouTube reference stores the
 * player's duration, so only songs mapped from an uploaded file are opened here), and every
 * request this check makes to the API is verified to be a GET (apart from logging in).
 */
for (const mobile of [false, true]) {
  test(`Sala 3, read only (${mobile ? "celular" : "desktop"})`, async ({ browser }) => {
    const { context, page } = await throughGate(browser, mobile ? devices["Pixel 7"] : {});
    const writes: string[] = [];
    page.on("request", (r) => {
      const path = new URL(r.url()).pathname;
      if (r.method() !== "GET" && path.startsWith("/api/") && path !== "/api/auth/login")
        writes.push(`${r.method()} ${path}`);
    });
    // The well-known local demo password must not work here.
    const bad = await api(page, "POST", "/api/auth/login", {
      email: "ana@bandsync.demo",
      password: "bandsync-demo",
    });
    expect(bad.status).toBe(401);
    await login(page, "ana@bandsync.demo", credentials().ana);
    await page
      .getByRole("link", { name: /Sala 3/ })
      .first()
      .click();
    await page.getByRole("link", { name: "Músicas" }).first().click();
    for (const title of ["Pérola Negra", "Esotérico", "O Segundo Sol"])
      await expect(page.getByRole("link", { name: new RegExp(`^${title}`) }).first()).toBeVisible();

    // A song mapped from the band's own uploaded file: its page plays that file, by section.
    const own = page.getByRole("link", { name: /^Meu Velho/ }).first();
    if (await own.isVisible()) {
      await own.click();
      await page.getByTestId("open-arrangement").click();
      await expect(page).toHaveURL(/\/arrangement$/);
      const pre = page.getByTestId("prearrangement");
      await expect(pre).toHaveAttribute("data-source", "audio_file");
      await expect(page.getByTestId("player-bar")).toHaveAttribute("data-kind", "file");
      const sections = await pre.getByTestId("pre-sections").locator("li").count();
      console.log(JSON.stringify({ song: "Meu Velho", sectionsShown: sections, mobile }));
      await expect(page.getByText(/\b(errors|autoarrange|common)\.[a-z_.]+/i)).toHaveCount(0);
      if (mobile) expect(await fits(page)).toBe(true);
      await page.screenshot({
        path: `${SHOTS}/30-meu-velho-${mobile ? "celular" : "desktop"}.png`,
        fullPage: !mobile,
      });
    }
    expect(writes, "this check must not write to Sala 3").toEqual([]);
    await context.close();
  });
}

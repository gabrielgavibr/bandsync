import { readFileSync } from "node:fs";
import { type Browser, devices, expect, type Page, test } from "@playwright/test";

/** Reads the git-ignored credentials file produced by apps/api/scripts/staging-credentials.mjs. */
function credentials() {
  const path = process.env.STAGING_CREDENTIALS ?? "../apps/api/.staging/credentials.txt";
  const text = readFileSync(path, "utf8");
  const key = /Access key[^:]*:\s*(\S+)/.exec(text)?.[1];
  const pw = (email: string) =>
    new RegExp(`${email.replace(/\./g, "\\.")}\\s+(\\S+)`).exec(text)?.[1];
  if (!key) throw new Error("access key not found in credentials file");
  return { key, ana: pw("ana@bandsync.demo")!, bruno: pw("bruno@bandsync.demo")! };
}

const SHOTS = "../test-results/staging";

async function enter(
  browser: Browser,
  key: string,
  opts: Parameters<Browser["newContext"]>[0] = {},
) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/__access/);
  await page.locator("input[name=key]").fill(key);
  await page.locator("button[type=submit]").click();
  return { context, page };
}

/**
 * Turns the sound on in the live room. The staging session is long-lived and shared with human
 * testers, so a musician's click may have been left off; returns whether it was, so the check
 * can put it back the way it found it.
 */
async function enableSound(page: Page): Promise<boolean> {
  // The musician's own click switch in the bottom bar (the sound prompt has a similar label).
  const toggle = page.locator("footer button[aria-pressed]").first();
  await expect(toggle).toBeVisible();
  const wasOff = (await toggle.getAttribute("aria-pressed")) === "false";
  if (wasOff) {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }
  // The browser's audio still has to be unlocked by a tap, unless it already is.
  const enable = page.getByRole("button", { name: "Ativar som" }).first();
  if (await enable.isVisible()) await enable.click();
  return wasOff;
}

async function restoreClickOff(page: Page) {
  const toggle = page.locator("footer button[aria-pressed]").first();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
}

async function login(page: Page, email: string, password: string) {
  await expect(page).toHaveURL(/\/login/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("input[name=password]").fill(password);
  await page.locator("form button[type=submit]").click();
}

test("homologation: gate, two accounts, languages, desktop + mobile, live rehearsal", async ({
  browser,
}) => {
  const c = credentials();

  // Wrong access key is refused.
  const probe = await browser.newContext();
  const pp = await probe.newPage();
  await pp.goto("/__access");
  await pp.locator("input[name=key]").fill("NOPE-NOPE-NOPE-NOPE");
  await pp.locator("button[type=submit]").click();
  await expect(pp.locator(".err")).toBeVisible();
  // The well-known local demo password must not work here.
  // Sent from inside the page so it uses the same network path as a real browser.
  const status = await pp.evaluate(async () => {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ana@bandsync.demo", password: "bandsync-demo" }),
    });
    return r.status;
  });
  expect(status).toBe(403); // blocked by the gate before even reaching login
  await probe.close();

  // Conductor on desktop. Ana's account prefers pt-BR.
  const ana = await enter(browser, c.key, { viewport: { width: 1280, height: 800 } });
  await login(ana.page, "ana@bandsync.demo", c.ana);
  await expect(ana.page.getByRole("heading", { name: "Minhas bandas" })).toBeVisible();
  await ana.page.screenshot({ path: `${SHOTS}/01-desktop-bandas-pt.png` });

  // Language switch to English and back, without reload.
  await ana.page.getByRole("link", { name: "Perfil" }).first().click();
  await ana.page.getByRole("radio", { name: "English" }).click();
  await expect(ana.page.getByRole("heading", { name: "Profile & preferences" })).toBeVisible();
  await ana.page.screenshot({ path: `${SHOTS}/02-desktop-profile-en.png` });
  await ana.page.getByRole("radio", { name: "Português (Brasil)" }).click();
  await expect(ana.page.getByRole("heading", { name: "Perfil e preferências" })).toBeVisible();

  // Band pages: the real repertoire and a real song sheet.
  const REAL = "Repertório Real — Primeiro Ensaio";
  await ana.page.getByRole("link", { name: "Bandas" }).first().click();
  await ana.page.getByRole("link", { name: /Sala 3/ }).click();
  await expect(ana.page.getByRole("heading", { name: "Sala 3" })).toBeVisible();
  await expect(ana.page.getByRole("link", { name: "Repertórios" }).last()).toBeVisible();
  await ana.page.screenshot({ path: `${SHOTS}/03-desktop-dashboard.png` });
  await ana.page.getByRole("link", { name: "Repertórios" }).first().click();
  await ana.page.getByRole("link", { name: new RegExp(REAL) }).click();
  const rows = ana.page.locator("ol > li");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Pérola Negra");
  await expect(rows.nth(1)).toContainText("Esotérico");
  await expect(rows.nth(2)).toContainText("O Segundo Sol");
  await ana.page.screenshot({ path: `${SHOTS}/04-desktop-repertorio-real.png` });
  await ana.page.getByRole("link", { name: /Pérola Negra/ }).click();
  // Two blocks: the reference recording and the band's arrangement. Sources are tucked away.
  await expect(ana.page.getByRole("heading", { name: "Gravação de referência" })).toBeVisible();
  await expect(ana.page.getByRole("heading", { name: "Arranjo da banda" })).toBeVisible();
  await expect(ana.page.getByTestId("reference-block")).toContainText("Luiz Melodia");
  await expect(ana.page.getByText("Links de referência")).toBeHidden();
  await ana.page.screenshot({ path: `${SHOTS}/04b-desktop-ficha-perola.png`, fullPage: true });

  // Start (or rejoin) a live session.
  await ana.page.getByRole("link", { name: "Ensaio ao vivo" }).first().click();
  const join = ana.page.getByRole("button", { name: "Entrar na sessão" });
  const startBtn = ana.page.getByRole("button", { name: "Iniciar sessão" });
  await expect(join.or(startBtn)).toBeVisible();
  if (await join.isVisible()) {
    await join.click();
  } else {
    const select = ana.page.getByLabel("Repertório desta sessão");
    const value = await select.locator("option", { hasText: REAL }).getAttribute("value");
    await select.selectOption(value!);
    await ana.page.getByRole("button", { name: "Iniciar sessão" }).click();
  }
  await expect(ana.page).toHaveURL(/\/rehearsal\/[0-9a-f-]+$/);
  const roomUrl = new URL(ana.page.url()).pathname;
  const anaClickWasOff = await enableSound(ana.page);

  // Bassist on a phone.
  const bruno = await enter(browser, c.key, { ...devices["iPhone 13"] });
  await login(bruno.page, "bruno@bandsync.demo", c.bruno);
  await expect(bruno.page.getByRole("heading", { name: "Minhas bandas" })).toBeVisible();
  await bruno.page.screenshot({ path: `${SHOTS}/05-mobile-bandas.png` });
  await bruno.page.getByRole("link", { name: /Sala 3/ }).click();
  await bruno.page.getByRole("link", { name: "Repertórios" }).first().click();
  await expect(bruno.page.getByText(REAL)).toBeVisible();
  await bruno.page.screenshot({ path: `${SHOTS}/05b-mobile-repertorios.png` });
  await bruno.page.goto(roomUrl);
  const brunoClickWasOff = await enableSound(bruno.page);
  await expect(bruno.page.getByText("Regente: Ana Ribeiro")).toBeVisible();

  // Conductor switches the session to the real repertoire and picks Pérola Negra.
  await ana.page.getByRole("button", { name: "Escolher música" }).click();
  const repSelect = ana.page.getByLabel("Repertório", { exact: true });
  const repValue = await repSelect.locator("option", { hasText: REAL }).getAttribute("value");
  await repSelect.selectOption(repValue!);
  await ana.page.getByRole("button", { name: /Pérola Negra/ }).click();
  await expect(bruno.page.getByText("Pérola Negra").first()).toBeVisible();
  await expect(bruno.page.getByText("1 de 3")).toBeVisible();
  // Each musician gets their own slot, clearly pending.
  await expect(bruno.page.getByText("Tablatura de baixo · Baixo").first()).toBeVisible();
  await expect(bruno.page.getByText("Este material ainda não foi adicionado.")).toBeVisible();
  await expect(ana.page.getByText("Mapa de arranjo · Bateria").first()).toBeVisible();
  await expect(bruno.page.getByTestId("tempo-source")).toBeVisible();
  // The reference is one tap away in the room, opened on each device through the platform.
  await bruno.page.getByTestId("room-reference").click();
  await expect(
    bruno.page
      .getByTestId("room-reference-panel")
      .getByRole("link", { name: "Abrir gravação original" }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=JZqFoTIAJj8");
  await bruno.page.screenshot({ path: `${SHOTS}/06a-mobile-room-referencia.png` });
  await bruno.page.getByRole("button", { name: "Fechar" }).click();

  // The conductor sets a tempo and runs the click.
  await ana.page.getByRole("spinbutton", { name: "BPM" }).fill("70");
  await expect(bruno.page.getByText("70", { exact: true }).first()).toBeVisible();
  await ana.page.getByRole("button", { name: "Iniciar", exact: true }).click();
  await expect(bruno.page.getByText("Executando").first()).toBeVisible({ timeout: 15_000 });
  await bruno.page.getByRole("button", { name: "Qualidade da sincronização" }).click();
  await expect(bruno.page.getByText(/Boa|Razoável|Ruim/).first()).toBeVisible({ timeout: 15_000 });
  await bruno.page.screenshot({ path: `${SHOTS}/06-mobile-room-sync.png` });
  await bruno.page.getByRole("button", { name: "Fechar" }).click();
  await ana.page.screenshot({ path: `${SHOTS}/07-desktop-room-conductor.png` });
  await ana.page.getByRole("button", { name: "Parar" }).click();
  await expect(bruno.page.getByText("Parada").first()).toBeVisible();
  const slider = bruno.page.getByRole("slider", { name: "Volume do clique" });
  expect((await slider.boundingBox())!.width).toBeGreaterThan(200);
  await bruno.page.screenshot({ path: `${SHOTS}/08-mobile-room-perola.png` });

  // Next songs reach the phone.
  await ana.page.getByRole("button", { name: "Próxima música" }).click();
  await expect(bruno.page.getByText("Esotérico").first()).toBeVisible();
  await expect(bruno.page.getByText("2 de 3")).toBeVisible();
  await expect(bruno.page.getByText("Tablatura de baixo · Baixo").first()).toBeVisible();
  await expect(bruno.page.getByText("Este material ainda não foi adicionado.")).toBeVisible();
  await bruno.page.screenshot({ path: `${SHOTS}/09-mobile-room-esoterico.png` });
  await ana.page.getByRole("button", { name: "Próxima música" }).click();
  await expect(bruno.page.getByText("O Segundo Sol").first()).toBeVisible();
  await expect(bruno.page.getByText("3 de 3")).toBeVisible();
  await expect(bruno.page.getByText("Tablatura de baixo · Baixo").first()).toBeVisible();
  await expect(bruno.page.getByText("Este material ainda não foi adicionado.")).toBeVisible();
  await bruno.page.screenshot({ path: `${SHOTS}/10-mobile-room-segundo-sol.png` });

  // Leave the session running so testers find it, with each musician's click as it was found.
  if (brunoClickWasOff) await restoreClickOff(bruno.page);
  if (anaClickWasOff) await restoreClickOff(ana.page);
  await ana.context.close();
  await bruno.context.close();
});

/**
 * Reference recordings against the real platforms. Read-only for the band: it checks what each
 * real song shows and identifies links in the add-song flow without confirming anything.
 */
test("homologation: reference recordings with real platforms", async ({ browser }) => {
  const c = credentials();
  const YT = "https://www.youtube.com/watch?v=JZqFoTIAJj8";
  const ana = await enter(browser, c.key, { viewport: { width: 1280, height: 900 } });
  await login(ana.page, "ana@bandsync.demo", c.ana);
  await ana.page.getByRole("link", { name: /Sala 3/ }).click();
  const openSong = async (title: RegExp) => {
    await ana.page.getByRole("link", { name: "Músicas" }).first().click();
    await ana.page.getByRole("link", { name: title }).first().click();
  };
  const block = ana.page.getByTestId("reference-block");
  const states = ana.page.getByTestId("preparation-state");

  // 1. Pérola Negra: the confirmed link is the band's main reference.
  await openSong(/Pérola Negra/);
  await expect(block).toHaveAttribute("data-state", "identified");
  await expect(block).toContainText("Natiruts Part. Especial Luiz Melodia");
  await expect(block).toContainText("Acústico no Rio de Janeiro");
  await expect(block.locator('[data-platform="youtube"]')).toHaveText("YouTube");
  await expect(block.getByRole("link", { name: "Abrir gravação original" })).toHaveAttribute(
    "href",
    YT,
  );
  await block.getByRole("button", { name: "Ouvir aqui" }).click();
  await expect(block.getByTestId("reference-player").locator("iframe")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/JZqFoTIAJj8",
  );
  await block.getByRole("button", { name: "Fechar player" }).click();
  // A known link is not audio and not an analysis.
  await expect(states.locator('[data-item="reference"]')).toHaveAttribute(
    "data-state",
    "identified",
  );
  await expect(states.locator('[data-item="audio"]')).toHaveAttribute("data-state", "none");
  await expect(states.locator('[data-item="analysis"]')).toHaveAttribute(
    "data-state",
    "not_possible",
  );
  // Sources, catalogue data and links are kept under "Detalhes técnicos", closed by default.
  const technical = ana.page.getByTestId("technical-details");
  await expect(ana.page.getByText("Links de referência")).toBeHidden();
  await ana.page.screenshot({ path: `${SHOTS}/11-referencia-perola.png`, fullPage: true });
  await technical.locator("summary").first().click();
  await expect(technical.locator('[data-kind="duration"]')).toContainText("3:30");
  await expect(technical.locator('[data-kind="composer"]')).toContainText("Luiz Melodia");
  await expect(technical.locator('[data-kind="bpm"]')).toHaveCount(0);
  await expect(technical.locator('[data-kind="key"]')).toHaveCount(0);
  await expect(technical).toContainText("NatirutsVEVO");
  await expect(technical.getByText("Links de referência")).toBeVisible();
  await ana.page.screenshot({ path: `${SHOTS}/11b-detalhes-tecnicos-perola.png`, fullPage: true });

  // 2. No confirmed link: the recording is known, the link stays pending, nothing is guessed.
  await openSong(/Esotérico/);
  await expect(block).toHaveAttribute("data-state", "link_pending");
  await expect(block).toContainText("Um Banda Um");
  await expect(block).toContainText("Link pendente");
  await expect(block.getByTestId("reference-player")).toHaveCount(0);
  await ana.page.screenshot({ path: `${SHOTS}/12-referencia-esoterico.png`, fullPage: true });
  await openSong(/O Segundo Sol/);
  await expect(block).toHaveAttribute("data-state", "link_pending");
  await expect(block).toContainText("Cássia Reggae, Vol. 1");

  // 3. The add-song flow identifies real links (and refuses the rest) without saving anything.
  await ana.page.getByRole("link", { name: "Músicas" }).first().click();
  await ana.page.getByRole("link", { name: "Adicionar música" }).first().click();
  await expect(ana.page.getByRole("heading", { name: "Adicionar música", level: 1 })).toBeVisible();
  await expect(ana.page.getByText(/MusicBrainz|Cifra Club|Songsterr|Discogs/)).toHaveCount(0);
  const identify = async (link: string) => {
    await ana.page.getByLabel("Link da gravação").fill(link);
    await ana.page.getByRole("button", { name: "Identificar" }).click();
  };
  const problem = ana.page.getByTestId("link-problem");
  await identify("https://vimeo.com/76979871");
  await expect(problem).toContainText("Plataforma não suportada");
  await identify("https://www.youtube.com/watch?v=AAAAAAAAAAA");
  await expect(problem).toContainText("Referência não encontrada", { timeout: 30_000 });
  const preview = ana.page.getByTestId("reference-preview");
  await identify("https://youtu.be/JZqFoTIAJj8?si=compartilhado");
  await expect(preview).toHaveAttribute("data-platform", "youtube", { timeout: 30_000 });
  await expect(preview).toContainText("Canal: NatirutsVEVO");
  await expect(preview.getByRole("link", { name: YT })).toHaveAttribute("href", YT);
  await ana.page.screenshot({ path: `${SHOTS}/13-adicionar-por-link-youtube.png`, fullPage: true });
  await identify("https://music.youtube.com/watch?v=JZqFoTIAJj8");
  await expect(preview).toHaveAttribute("data-platform", "youtube_music", { timeout: 30_000 });
  // A real Spotify track: the public endpoint gives title and cover, not the artist.
  await identify("https://open.spotify.com/intl-pt/track/4cOdK2wGLETKBW3PvgPWqT?si=abc");
  await expect(preview).toHaveAttribute("data-platform", "spotify", { timeout: 30_000 });
  await expect(preview).toHaveAttribute("data-metadata", "partial");
  await expect(preview).toContainText("Never Gonna Give You Up");
  await expect(ana.page.getByText("O Spotify não informa o artista")).toBeVisible();
  await preview.getByRole("button", { name: "Ouvir para conferir" }).click();
  await expect(preview.getByTestId("reference-player").locator("iframe")).toHaveAttribute(
    "src",
    "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT",
  );
  await ana.page.screenshot({ path: `${SHOTS}/14-adicionar-por-link-spotify.png`, fullPage: true });
  // Left without confirming: no song is created by this check.
  await ana.context.close();
});

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
  const res = await pp.request.post("/api/auth/login", {
    data: { email: "ana@bandsync.demo", password: "bandsync-demo" },
  });
  expect(res.status()).toBe(403); // blocked by the gate before even reaching login
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

  // Band pages.
  await ana.page.getByRole("link", { name: "Bandas" }).first().click();
  await ana.page.getByRole("link", { name: /Sala 3/ }).click();
  await expect(ana.page.getByRole("heading", { name: "Sala 3" })).toBeVisible();
  await expect(ana.page.getByRole("link", { name: "Repertórios" }).last()).toBeVisible();
  await ana.page.screenshot({ path: `${SHOTS}/03-desktop-dashboard.png` });
  await ana.page.getByRole("link", { name: "Músicas" }).first().click();
  await ana.page.getByRole("link", { name: /Luz da Garagem/ }).click();
  await expect(ana.page.getByText("Mapa de bateria").first()).toBeVisible();
  await expect(ana.page.getByText("Mapa de arranjo").first()).toBeVisible();
  await ana.page.screenshot({ path: `${SHOTS}/04-desktop-song.png` });

  // Start (or rejoin) a live session with the Thursday repertoire.
  await ana.page.getByRole("link", { name: "Ensaio ao vivo" }).first().click();
  const join = ana.page.getByRole("button", { name: "Entrar na sessão" });
  if (await join.isVisible().catch(() => false)) {
    await join.click();
  } else {
    await ana.page.getByLabel("Repertório desta sessão").selectOption({ index: 1 });
    await ana.page.getByRole("button", { name: "Iniciar sessão" }).click();
  }
  await expect(ana.page).toHaveURL(/\/rehearsal\/[0-9a-f-]+$/);
  const roomUrl = new URL(ana.page.url()).pathname;
  await ana.page.getByRole("button", { name: "Ativar som" }).click();

  // Bassist on a phone, English UI (Bruno's account prefers pt-BR; switch it in profile first).
  const bruno = await enter(browser, c.key, { ...devices["iPhone 13"] });
  await login(bruno.page, "bruno@bandsync.demo", c.bruno);
  await expect(bruno.page.getByRole("heading", { name: "Minhas bandas" })).toBeVisible();
  await bruno.page.screenshot({ path: `${SHOTS}/05-mobile-bandas.png` });
  // Mobile navigation through the band pages.
  await bruno.page.getByRole("link", { name: /Sala 3/ }).click();
  await bruno.page.getByRole("link", { name: "Repertórios" }).first().click();
  await expect(bruno.page.getByText("Ensaio de quinta")).toBeVisible();
  await bruno.page.screenshot({ path: `${SHOTS}/05b-mobile-repertorios.png` });
  await bruno.page.goto(roomUrl);
  await bruno.page.getByRole("button", { name: "Ativar som" }).click();
  await expect(bruno.page.getByText("Regente: Ana Ribeiro")).toBeVisible();

  // Conductor selects a song; the phone follows and shows the bass material.
  await ana.page.getByRole("button", { name: "Escolher música" }).click();
  await ana.page.getByRole("button", { name: /Luz da Garagem/ }).click();
  await expect(bruno.page.getByText("Luz da Garagem").first()).toBeVisible();
  await expect(
    bruno.page
      .getByText("Linha de baixo", { exact: false })
      .or(bruno.page.getByText("A|-3-3-3-3"))
      .first(),
  ).toBeVisible();
  await expect(ana.page.getByText("Intro (4)").first()).toBeVisible(); // drum map on the conductor

  // Start the click: both devices go through count-in into playing.
  await ana.page.getByRole("button", { name: "Iniciar", exact: true }).click();
  await expect(bruno.page.getByText("Executando").first()).toBeVisible({ timeout: 15_000 });
  await bruno.page.getByRole("button", { name: "Qualidade da sincronização" }).click();
  await expect(bruno.page.getByText(/Boa|Razoável|Ruim/).first()).toBeVisible({ timeout: 15_000 });
  await bruno.page.screenshot({ path: `${SHOTS}/06-mobile-room-sync.png` });
  await bruno.page.getByRole("button", { name: "Fechar" }).click();
  await ana.page.screenshot({ path: `${SHOTS}/07-desktop-room-conductor.png` });
  await ana.page.getByRole("button", { name: "Parar" }).click();
  await expect(bruno.page.getByText("Parada").first()).toBeVisible();
  // The member's volume slider must be usable on a phone (full row, real width).
  const slider = bruno.page.getByRole("slider", { name: "Volume do clique" });
  expect((await slider.boundingBox())!.width).toBeGreaterThan(200);
  await bruno.page.screenshot({ path: `${SHOTS}/08-mobile-room-member.png` });

  // Leave the session running so testers find it; just close the browsers.
  await ana.context.close();
  await bruno.context.close();
});

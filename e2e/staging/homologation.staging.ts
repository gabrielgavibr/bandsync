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
  await expect(ana.page.getByRole("heading", { name: "Ficha da música" })).toBeVisible();
  await expect(ana.page.getByText("Luiz Melodia").first()).toBeVisible();
  await expect(ana.page.getByText("Não definido pela banda").first()).toBeVisible();
  await expect(ana.page.getByText("Links de referência")).toBeVisible();
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
  await ana.page.getByRole("button", { name: "Ativar som" }).click();

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
  await bruno.page.getByRole("button", { name: "Ativar som" }).click();
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

  // Leave the session running so testers find it; just close the browsers.
  await ana.context.close();
  await bruno.context.close();
});

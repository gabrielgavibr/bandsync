import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";

/**
 * Staging checks are split in two so that the band people actually use is never changed:
 *  - "Sala 3" (the real repertoire, live sessions, members' settings) is only READ;
 *  - everything that writes happens in a band of its own, owned by a QA account that exists
 *    only for these checks ("QA automático"), and what a run creates there is removed at the end.
 */
const DIR = process.env.STAGING_DIR ?? "../apps/api/.staging";

export function credentials() {
  const text = readFileSync(process.env.STAGING_CREDENTIALS ?? `${DIR}/credentials.txt`, "utf8");
  const key = /Access key[^:]*:\s*(\S+)/.exec(text)?.[1];
  const ana = /ana@bandsync\.demo\s+(\S+)/.exec(text)?.[1];
  if (!key || !ana) throw new Error("staging credentials not found");
  return { key, ana };
}

/** Opens a context that has passed the access gate (not logged in to BandSync yet). */
export async function throughGate(
  browser: Browser,
  opts: Parameters<Browser["newContext"]>[0] = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "pt-BR", ...opts });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/__access/);
  await page.locator("input[name=key]").fill(credentials().key);
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(/\/login/);
  return { context, page };
}

export async function login(page: Page, email: string, password: string) {
  await page.locator("input[name=email]").fill(email);
  await page.locator("input[name=password]").fill(password);
  await page.locator("form button[type=submit]").click();
  await expect(page.getByRole("heading", { name: "Minhas bandas" })).toBeVisible({
    timeout: 30_000,
  });
}

export const QA_BAND = "QA automático (testes)";

/**
 * The QA account: created on first use with a random password kept in the git-ignored staging
 * folder, reused afterwards. Returns the page logged in and the id of the QA band.
 */
export async function qaSession(page: Page): Promise<{ bandId: string }> {
  const file = `${DIR}/qa-account.json`;
  let account: { email: string; password: string };
  if (existsSync(file)) {
    account = JSON.parse(readFileSync(file, "utf8"));
    const res = await page.request.post("/api/auth/login", { data: account });
    expect(res.status(), await res.text()).toBe(200);
  } else {
    account = {
      email: `qa-auto-${randomBytes(4).toString("hex")}@bandsync.test`,
      password: randomBytes(18).toString("base64url"),
    };
    const res = await page.request.post("/api/auth/register", {
      data: {
        ...account,
        displayName: "QA automático",
        primaryInstrument: "keys",
        locale: "pt-BR",
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    writeFileSync(file, JSON.stringify(account, null, 1), { mode: 0o600 });
  }
  const bands = (await (await page.request.get("/api/bands")).json()).bands as {
    id: string;
    name: string;
  }[];
  let band = bands.find((b) => b.name === QA_BAND);
  if (!band) {
    const res = await page.request.post("/api/bands", { data: { name: QA_BAND } });
    expect(res.status(), await res.text()).toBe(201);
    band = (await res.json()).band as { id: string; name: string };
  }
  // The QA account must never be a member of the band people use.
  expect(bands.some((b) => b.name === "Sala 3")).toBe(false);
  return { bandId: band.id };
}

export const fits = (page: Page) =>
  page.evaluate(
    (w) => window.innerWidth <= w + 1 && document.documentElement.scrollWidth <= w + 1,
    page.viewportSize()!.width,
  );

export const SHOTS = "../test-results/staging";

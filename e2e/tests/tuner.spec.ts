import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devices, expect, test } from "@playwright/test";
import { encodeWav } from "../../packages/shared/src/analysis/synth";
import { contextFor, registerUser } from "./helpers";

/**
 * The tuner in the browser, fed by Chromium's fake microphone with a weak note: the A string of
 * a guitar (110 Hz) at about -56 dBFS, which the previous tuner (fixed cut-off at -40 dBFS)
 * could not read at all.
 */
const SR = 48_000;
const LEVEL_DB = -56;
function weakA2(): Float32Array {
  const seconds = 4;
  const out = new Float32Array(seconds * SR);
  const partials = [1, 0.6, 0.35, 0.2];
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    let v = 0;
    partials.forEach((a, k) => {
      v += a * Math.exp(-t * 0.35 * (1 + 0.3 * k)) * Math.sin(2 * Math.PI * 110 * (k + 1) * t);
    });
    // Fade the ends so the loop does not click.
    out[i] = v * Math.min(1, t / 0.02) * Math.min(1, (seconds - t) / 0.05);
  }
  let s = 0;
  for (let i = 0; i < SR; i += 1) s += out[i]! ** 2;
  const g = 10 ** (LEVEL_DB / 20) / Math.sqrt(s / SR);
  for (let i = 0; i < out.length; i += 1) out[i]! *= g;
  return out;
}
const MIC_WAV = join(tmpdir(), `bandsync-tuner-mic-${process.pid}.wav`);
writeFileSync(MIC_WAV, encodeWav(weakA2(), SR));

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${MIC_WAV}`,
    ],
  },
});

test("tuner on a phone: a weak note is read, sensitivity really changes what is read, settings are kept", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const ana = await registerUser("Ana Violao", "guitar", "pt-BR");
  const { page, context } = await contextFor(browser, ana, {
    ...devices["iPhone 13"],
    permissions: ["microphone"],
  });
  await page.goto("/tools?tool=tuner");
  const tuner = page.getByTestId("tuner");
  await expect(tuner).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("tuner-status")).toHaveText("Toque em “Começar a ouvir”");
  await expect(page.getByRole("radio", { name: "Normal" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("tuner-reading")).toContainText("Lá 4 = 440 Hz");

  // 1. Normal sensitivity reads the weak note: A2, close to in tune, with its frequency.
  await page.getByRole("button", { name: "Começar a ouvir" }).click();
  await expect(tuner).toHaveAttribute("data-state", "note", { timeout: 15_000 });
  await expect(page.getByTestId("tuner-note")).toHaveText("A2");
  const freq = Number(await page.getByTestId("tuner-freq").textContent());
  expect(Math.abs(freq - 110)).toBeLessThan(1);
  const cents = Number.parseInt((await page.getByTestId("tuner-cents").textContent()) ?? "99", 10);
  expect(Math.abs(cents)).toBeLessThanOrEqual(8);
  // The meter is about level, and says it is enough.
  await expect(tuner).toHaveAttribute("data-zone", "good");
  await expect(page.getByTestId("tuner-zone")).toHaveText("Sinal adequado");
  await page.screenshot({ path: "test-results/tuner-01-nota.png" });

  // 2. Low sensitivity does not read it, and says why: the signal is weak.
  await page.getByRole("radio", { name: "Baixa" }).click();
  await expect(tuner).toHaveAttribute("data-state", "weak", { timeout: 10_000 });
  await expect(page.getByTestId("tuner-note")).toHaveText("—");
  await expect(page.getByTestId("tuner-status")).toHaveText("Sinal fraco");
  await expect(page.getByTestId("tuner-zone")).toHaveText("Sinal fraco");
  await expect(page.getByTestId("tuner-meter")).toContainText("aumente a sensibilidade");
  await page.screenshot({ path: "test-results/tuner-02-fraco.png" });

  // 3. High sensitivity reads it again, and the note does not jump about.
  await page.getByRole("radio", { name: "Alta" }).click();
  await expect(tuner).toHaveAttribute("data-state", "note", { timeout: 15_000 });
  const seen = new Set<string>();
  for (let i = 0; i < 20; i += 1) {
    const n = (await page.getByTestId("tuner-note").textContent()) ?? "";
    if (n !== "—") seen.add(n);
    await page.waitForTimeout(100);
  }
  expect([...seen]).toEqual(["A2"]);

  // 4. Fine adjustment and the reference pitch, behind "Ajustes".
  await page.getByRole("button", { name: "Ajustes do microfone" }).click();
  await expect(page.getByTestId("tuner-sensitivity-value")).toHaveText("80");
  await page.getByRole("button", { name: "Subir a referência em 1 Hz" }).click();
  await page.getByRole("button", { name: "Subir a referência em 1 Hz" }).click();
  await expect(page.getByTestId("tuner-a4")).toHaveText("442 Hz");
  // 110 Hz against A4 = 442 is about 8 cents flat.
  await expect
    .poll(async () =>
      Number.parseInt((await page.getByTestId("tuner-cents").textContent()) ?? "0", 10),
    )
    .toBeLessThan(-4);
  expect(
    await page.evaluate(
      (w) => document.documentElement.scrollWidth <= w + 1,
      page.viewportSize()!.width,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/tuner-03-ajustes.png", fullPage: true });

  // 5. Stop; the settings are this person's and come back after a reload.
  await page.getByRole("button", { name: "Parar" }).click();
  await expect(tuner).toHaveAttribute("data-state", "idle");
  await expect
    .poll(async () => (await (await ana.api.get("/api/me")).json()).preferences)
    .toMatchObject({ tunerSensitivity: 80, tunerA4: 442 });
  await page.reload();
  await expect(page.getByRole("radio", { name: "Alta" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("tuner-reading")).toContainText("Lá 4 = 442 Hz");
  await context.close();
});

test("tuner without a microphone permission says so", async ({ browser }) => {
  const ana = await registerUser("Ana Sem Mic", "guitar", "pt-BR");
  const context = await browser.newContext({ ...devices["iPhone 13"], permissions: [] });
  const { cookies } = await ana.api.storageState();
  await context.addCookies(
    cookies.map((c) => ({
      ...c,
      url: "http://localhost:5173",
      domain: undefined,
      path: undefined,
    })),
  );
  const page = await context.newPage();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await page.goto("/tools?tool=tuner");
  await page.getByRole("button", { name: "Começar a ouvir" }).click();
  await expect(page.getByTestId("tuner")).toHaveAttribute("data-state", "denied");
  await expect(page.getByTestId("tuner-status")).toContainText("Microfone indisponível");
  await context.close();
});

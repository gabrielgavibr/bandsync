import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { CHORDS, encodeWav, synthTrack } from "../../packages/shared/src/analysis/synth";
import { contextFor, createBand, registerUser } from "./helpers";

/**
 * "Ouvir pelo microfone" end to end. Chromium's fake microphone plays a synthesised groove with a
 * known answer (96 BPM, 4/4, A minor), the app listens, analyses on the device, saves estimates
 * marked "needs review", and the band confirms a value from the suggestions.
 */
const MIC_BPM = 96;
const mic = synthTrack({
  bpm: MIC_BPM,
  beatsPerBar: 4,
  bars: 40,
  chords: [CHORDS.Am, CHORDS.Dm, CHORDS.E, CHORDS.Am],
  sampleRate: 48_000,
});
const MIC_WAV = join(tmpdir(), `bandsync-fake-mic-${process.pid}.wav`);
writeFileSync(MIC_WAV, encodeWav(mic.samples, mic.sampleRate));

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

const YT = "https://www.youtube.com/watch?v=JZqFoTIAJj8";

test("listens to the reference through the microphone and the band confirms an estimate", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ana = await registerUser("Ana Drums", "drums", "pt-BR");
  const bandId = await createBand(ana, `Ouvir ${Date.now()}`);
  const prepared = await ana.api.post(`/api/bands/${bandId}/autoarrange/prepare`, {
    data: {
      newSong: { title: "Pérola Negra" },
      recording: { source: "link", title: "Pérola Negra", artistCredit: "Natiruts" },
      referenceUrl: YT,
    },
  });
  expect(prepared.status()).toBe(201);
  const songId = (await prepared.json()).song.id as string;

  const { page, context } = await contextFor(browser, ana);
  await page.goto(`/bands/${bandId}/songs/${songId}`);
  const states = page.getByTestId("preparation-state");
  await expect(states.locator('[data-item="analysis"]')).toHaveAttribute(
    "data-state",
    "not_possible",
  );
  // Nothing estimated yet: no suggestion is offered.
  await expect(page.getByTestId("suggest-bpm")).toHaveCount(0);

  await states.getByRole("button", { name: "Ouvir pelo microfone" }).click();
  const dialog = page.getByTestId("listen-dialog");
  await expect(dialog).toContainText("Nada é gravado nem enviado");
  await dialog.getByRole("button", { name: "Começar a ouvir" }).click();
  await expect(dialog).toHaveAttribute("data-step", "listening");
  // Stopping is only allowed after 15 s of audio.
  await expect(dialog.getByRole("button", { name: /Continue tocando/ })).toBeDisabled();
  const stop = dialog.getByRole("button", { name: "Parar e analisar" });
  await expect(stop).toBeEnabled({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/listen-01-listening.png" });
  await stop.click();
  await expect(dialog).toHaveAttribute("data-step", "done", { timeout: 30_000 });
  const report = dialog.getByTestId("listen-report");
  await expect(report.locator('[data-kind="key"]')).toContainText("Am");
  await expect(report.locator('[data-kind="time_signature"]')).toContainText("4/4");
  const bpmText = ((await report.locator('[data-kind="bpm"]').textContent()) ?? "").replace(
    ",",
    ".",
  );
  const heard = Number(/[\d.]+/.exec(bpmText)?.[0]);
  expect(Math.abs(heard - MIC_BPM), bpmText).toBeLessThanOrEqual(1);
  await expect(report).toContainText("Revisão necessária");
  await page.screenshot({ path: "test-results/listen-02-result.png" });
  await dialog.getByRole("button", { name: "Revisar" }).click();

  // The estimate is offered; nothing is filled in by itself.
  await expect(states.locator('[data-item="analysis"]')).toContainText(
    "Análise realizada (pelo microfone)",
  );
  const bpmField = page.getByRole("spinbutton", { name: "BPM da banda" });
  await expect(bpmField).toHaveValue("");
  const suggestion = page.getByTestId("suggest-bpm").getByRole("button").first();
  await expect(suggestion).toHaveText(`${MIC_BPM} BPM`);
  await expect(page.getByTestId("suggest-key")).toContainText("Am");
  await expect(page.getByTestId("suggest-meter")).toContainText("4/4");
  let song = (await (await ana.api.get(`/api/bands/${bandId}/songs/${songId}`)).json()).song;
  expect(song.version.bpm).toBeNull();
  await suggestion.click();
  await expect(bpmField).toHaveValue(String(MIC_BPM));
  await page.getByRole("button", { name: "Confirmar BPM da banda" }).click();
  await expect(page.getByText(/Confirmado por Ana Drums/).first()).toBeVisible();
  await page.screenshot({ path: "test-results/listen-03-confirmed.png", fullPage: true });

  song = (await (await ana.api.get(`/api/bands/${bandId}/songs/${songId}`)).json()).song;
  expect(song.version.bpm).toBe(MIC_BPM);
  const overview = await (
    await ana.api.get(`/api/bands/${bandId}/autoarrange/songs/${songId}`)
  ).json();
  const bpm = overview.results.find((r: { kind: string }) => r.kind === "bpm");
  expect(bpm).toMatchObject({
    input: "microphone",
    reviewStatus: "confirmed",
    createdByName: "Ana Drums",
  });
  // The key estimate was not confirmed, so it is still waiting for a person.
  expect(overview.results.find((r: { kind: string }) => r.kind === "key").reviewStatus).toBe(
    "needs_review",
  );
  expect(song.version.key).toBeNull();
  await context.close();
});

test("analyses an authorised audio file right after it is uploaded", async ({ browser }) => {
  test.setTimeout(120_000);
  const ana = await registerUser("Ana Drums", "drums", "pt-BR");
  const bandId = await createBand(ana, `Arquivo ${Date.now()}`);
  const prepared = await ana.api.post(`/api/bands/${bandId}/autoarrange/prepare`, {
    data: {
      newSong: { title: "Valsa da banda" },
      recording: { source: "link", title: "Valsa da banda" },
      referenceUrl: YT,
    },
  });
  const songId = (await prepared.json()).song.id as string;
  // The band's own rehearsal take: a waltz in G at 120 BPM.
  const take = synthTrack({
    bpm: 120,
    beatsPerBar: 3,
    bars: 24,
    chords: [CHORDS.G, CHORDS.C, CHORDS.D, CHORDS.G],
    sampleRate: 44_100,
  });
  const { page, context } = await contextFor(browser, ana);
  await page.goto(`/bands/${bandId}/songs/${songId}`);
  const states = page.getByTestId("preparation-state");
  await states.getByRole("button", { name: "Enviar áudio autorizado" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "ensaio-valsa.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(encodeWav(take.samples, take.sampleRate)),
  });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Enviar" }).click();
  await expect(states.locator('[data-item="analysis"]')).toContainText(
    "Análise realizada (arquivo de áudio)",
    { timeout: 30_000 },
  );
  await expect(states.locator('[data-item="audio"]')).toContainText("ensaio-valsa.wav");
  await expect(page.getByTestId("suggest-meter")).toContainText("3/4");
  await expect(page.getByTestId("suggest-key")).toContainText("G");
  await expect(page.getByTestId("suggest-bpm").getByRole("button").first()).toHaveText("120 BPM");
  await page.screenshot({ path: "test-results/listen-04-file.png", fullPage: true });
  await context.close();
});

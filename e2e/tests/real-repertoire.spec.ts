import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { devices, expect, test } from "@playwright/test";
import {
  contextFor,
  createBand,
  inviteCode,
  join as joinBand,
  PASSWORD,
  registerUser,
} from "./helpers";

const IMPORTER = join(
  import.meta.dirname,
  "..",
  "..",
  "apps",
  "api",
  "scripts",
  "import-real-repertoire.mjs",
);
const API_URL = process.env.E2E_API_URL ?? "http://localhost:8787";

function importRepertoire(email: string, band: string) {
  const out = execFileSync("node", [IMPORTER], {
    env: {
      ...process.env,
      BANDSYNC_URL: API_URL,
      BANDSYNC_EMAIL: email,
      BANDSYNC_PASSWORD: PASSWORD,
      BANDSYNC_BAND: band,
    },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

test("real repertoire: idempotent import, song sheet, pending material per instrument and live switching", async ({
  browser,
}) => {
  const ana = await registerUser("Ana Drums", "drums");
  const bruno = await registerUser("Bruno Bass", "bass");
  const bandName = `Real Band ${Date.now()}`;
  const bandId = await createBand(ana, bandName);
  await joinBand(bruno, await inviteCode(ana, bandId, "bass"));

  // Import twice: the second run must not create anything.
  const first = importRepertoire(ana.email, bandName);
  expect(first.repertoire).toBe("created");
  expect(first.repertoireOrder).toEqual(["Pérola Negra", "Esotérico", "O Segundo Sol"]);
  const second = importRepertoire(ana.email, bandName);
  expect(second.repertoire).toBe("existing");
  for (const s of Object.values(second.songs) as {
    song: string;
    referencesAdded: number;
    materialsAdded: number;
  }[]) {
    expect(s).toEqual({ song: "existing", referencesAdded: 0, materialsAdded: 0 });
  }
  const songs = (await (await ana.api.get(`/api/bands/${bandId}/songs`)).json()).songs as {
    title: string;
  }[];
  expect(songs.map((s) => s.title).sort()).toEqual(["Esotérico", "O Segundo Sol", "Pérola Negra"]);

  // Repertoire and song sheet (desktop, English).
  const conductor = await contextFor(browser, ana);
  const page = conductor.page;
  await page.goto(`/bands/${bandId}/repertoires`);
  await page.getByRole("link", { name: /Repertório Real — Primeiro Ensaio/ }).click();
  const rows = page.locator("ol > li");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Pérola Negra");
  await expect(rows.nth(1)).toContainText("Esotérico");
  await expect(rows.nth(2)).toContainText("O Segundo Sol");

  await page.getByRole("link", { name: /Pérola Negra/ }).click();
  await expect(page.getByRole("heading", { name: "Pérola Negra", level: 1 })).toBeVisible();
  // Imported with a link the band typed, not yet identified: no recording is assumed.
  const block = page.getByTestId("reference-block");
  await expect(block).toHaveAttribute("data-state", "none");
  await expect(block).toContainText("No reference recording set.");
  await expect(block.getByRole("link", { name: /Link given earlier/ })).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=JZqFoTIAJj8",
  );
  const arrangement = page.getByTestId("band-arrangement");
  await expect(arrangement.getByRole("heading", { name: "Band arrangement" })).toBeVisible();
  await expect(arrangement.getByTestId("materials-overview")).toContainText(
    "Arrangement map · Drums · Pending",
  );
  await expect(arrangement.getByTestId("preparation-state")).toContainText("Reference not set");
  // Sources and links are kept, out of the way.
  const technical = page.getByTestId("technical-details");
  await expect(page.getByRole("heading", { name: "Song sheet" })).toBeHidden();
  await technical.locator("summary").first().click();
  await expect(technical.getByRole("heading", { name: "Song sheet" })).toBeVisible();
  await expect(technical.getByText("Luiz Melodia").first()).toBeVisible();
  await expect(technical.getByText("Natiruts Acústico no Rio de Janeiro (2012)")).toBeVisible();
  await expect(technical.getByText("To confirm").first()).toBeVisible();
  await expect(technical.getByText(/Sources \(\d+\)/)).toBeVisible();
  await expect(
    technical.getByRole("link", { name: /Pérola Negra \(feat\. Luiz Melodia\)/ }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=JZqFoTIAJj8");
  await expect(page.getByText("Arrangement map · Drums").first()).toBeVisible();
  await page.screenshot({ path: "test-results/real-song-sheet-en.png", fullPage: true });

  // Portuguese labels, proper names untouched.
  await page.getByRole("link", { name: "Profile" }).first().click();
  await page.getByRole("radio", { name: "Português (Brasil)" }).click();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Gravação de referência" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Arranjo da banda" })).toBeVisible();
  await expect(page.getByTestId("reference-block")).toContainText(
    "Nenhuma gravação de referência definida.",
  );
  await expect(page.getByRole("heading", { name: "Pérola Negra" })).toBeVisible();
  await page.getByRole("link", { name: "Perfil" }).first().click();
  await page.getByRole("radio", { name: "English" }).click();

  // Live rehearsal across two devices.
  await page.goto(`/bands/${bandId}/rehearsal`);
  await page.getByLabel("Repertoire for this session").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/rehearsal\/[0-9a-f-]+$/);
  const room = page.url();
  await page.getByRole("button", { name: "Enable sound" }).click();

  const member = await contextFor(browser, bruno, { ...devices["iPhone 13"] });
  await member.page.goto(room);
  await member.page.getByRole("button", { name: "Enable sound" }).click();
  await expect(member.page.getByText("Conductor: Ana Drums")).toBeVisible();

  // 1. Pérola Negra
  await page.getByRole("button", { name: "Choose song" }).click();
  await page.getByRole("button", { name: /Pérola Negra/ }).click();
  await expect(member.page.getByText("Pérola Negra").first()).toBeVisible();
  await expect(member.page.getByText("Bass tab · Bass").first()).toBeVisible();
  await expect(
    member.page
      .getByText("Pending material")
      .or(member.page.getByText("This material has not been added yet."))
      .first(),
  ).toBeVisible();
  await expect(page.getByText("This material has not been added yet.")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Arrangement map" }).first(),
  ).toBeVisible();
  // No tempo is recorded: the room says so instead of inventing one.
  await expect(member.page.getByTestId("tempo-source")).toContainText("No tempo recorded");
  await expect(member.page.getByTestId("tempo-source")).toContainText(
    "Time signature not yet confirmed",
  );
  await member.page.screenshot({ path: "test-results/real-live-member-perola.png" });

  // Conductor sets a tempo by ear and starts the click.
  const bpm = page.getByRole("spinbutton", { name: "BPM" });
  await bpm.fill("70");
  await expect(member.page.getByText("70", { exact: true }).first()).toBeVisible();
  await expect(member.page.getByTestId("tempo-source")).toContainText("Tempo set by the conductor");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(member.page.getByText("Playing").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(member.page.getByText("Stopped").first()).toBeVisible();

  // 2. Esotérico, 3. O Segundo Sol
  await page.getByRole("button", { name: "Next song" }).click();
  await expect(member.page.getByText("Esotérico").first()).toBeVisible();
  await expect(member.page.getByText("2 of 3")).toBeVisible();
  await expect(member.page.getByRole("link", { name: /songsterr\.com/ })).toBeVisible();
  await page.getByRole("button", { name: "Next song" }).click();
  await expect(member.page.getByText("O Segundo Sol").first()).toBeVisible();
  await expect(member.page.getByText("3 of 3")).toBeVisible();
  await expect(member.page.getByText("This material has not been added yet.")).toBeVisible();
  await page.screenshot({ path: "test-results/real-live-conductor-segundo-sol.png" });

  // Mobile layout: the member's controls stay inside the viewport.
  const width = member.page.viewportSize()!.width;
  const box = await member.page.getByRole("button", { name: /Click (on|off)/ }).boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);

  await member.context.close();
  await conductor.context.close();
});

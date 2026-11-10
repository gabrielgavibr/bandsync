import { devices, expect, test } from "@playwright/test";
import {
  contextFor,
  createBand,
  createRepertoire,
  createSong,
  inviteCode,
  join,
  registerUser,
} from "./helpers";

test.describe("live rehearsal", () => {
  test("two devices share song selection, see different materials and start a synchronised count-in", async ({
    browser,
  }) => {
    const ana = await registerUser("Ana Drums", "drums");
    const bruno = await registerUser("Bruno Bass", "bass");
    const bandId = await createBand(ana, "Sync Band");
    await join(bruno, await inviteCode(ana, bandId, "bass"));
    const songA = await createSong(ana, bandId, "Song Alpha", 100, [
      { type: "drum_map", instrument: "drums", body: "DRUMS: kick on 1 and 3" },
      { type: "bass_tab", instrument: "bass", body: "BASS: G|---3---|" },
      { type: "lyrics", instrument: null, body: "LYRICS: la la la" },
    ]);
    const songB = await createSong(ana, bandId, "Song Beta", 140, [
      { type: "chords", instrument: null, body: "C   G   Am   F" },
    ]);
    await createRepertoire(ana, bandId, "Thursday", [songA, songB]);

    // Conductor on a desktop, bassist on a phone.
    const conductor = await contextFor(browser, ana);
    const bassist = await contextFor(browser, bruno, { ...devices["iPhone 13"] });

    await conductor.page.goto(`/bands/${bandId}/rehearsal`);
    await conductor.page.getByLabel("Repertoire for this session").selectOption({ index: 1 });
    await conductor.page.getByRole("button", { name: "Start session" }).click();
    await expect(conductor.page).toHaveURL(/\/rehearsal\/[0-9a-f-]+$/);
    const sessionUrl = conductor.page.url();

    // Audio gate: enable sound on the conductor device.
    await conductor.page.getByRole("button", { name: "Enable sound" }).click();
    await expect(conductor.page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    await bassist.page.goto(sessionUrl);
    await bassist.page.getByRole("button", { name: "Enable sound" }).click();
    // On the phone the controls are a sheet: one row until opened.
    const sheet = bassist.page.getByTestId("control-sheet");
    const openSheet = async () => {
      while ((await sheet.getAttribute("data-level")) !== "full")
        await bassist.page.getByTestId("sheet-toggle").click();
    };
    const closeSheet = async () => {
      if ((await sheet.getAttribute("data-level")) !== "mini")
        await bassist.page.getByTestId("sheet-backdrop").click({ position: { x: 20, y: 70 } });
      await expect(sheet).toHaveAttribute("data-level", "mini");
    };
    await expect(sheet).toHaveAttribute("data-level", "mini");
    await openSheet();
    await expect(sheet).toContainText("Conductor: Ana Drums");
    await closeSheet();
    await expect(bassist.page.getByRole("main").getByText("No song selected")).toBeVisible();
    // Both show two connected musicians.
    await expect(conductor.page.getByRole("button", { name: "Musicians" })).toHaveText(/2/);

    // Conductor picks the first song; the bassist's device follows without reload.
    await conductor.page.getByRole("button", { name: "Choose song" }).click();
    await conductor.page.getByRole("button", { name: /Song Alpha/ }).click();
    await expect(conductor.page.getByText("Song Alpha").first()).toBeVisible();
    await expect(bassist.page.getByText("Song Alpha").first()).toBeVisible();
    // BPM and meter come from the band version.
    await expect(conductor.page.getByText("100", { exact: true }).first()).toBeVisible();
    await expect(bassist.page.getByTestId("sheet-bpm")).toHaveText("100 BPM");
    // Each musician sees the material for their own instrument.
    await expect(conductor.page.getByText("DRUMS: kick on 1 and 3")).toBeVisible();
    await expect(bassist.page.getByText("BASS: G|---3---|")).toBeVisible();
    await expect(bassist.page.getByText("DRUMS: kick on 1 and 3")).toHaveCount(0);

    // Local navigation on one device does not leak to the other.
    await bassist.page.getByRole("button", { name: "Lyrics" }).click();
    await expect(bassist.page.getByText("LYRICS: la la la")).toBeVisible();
    await expect(conductor.page.getByText("DRUMS: kick on 1 and 3")).toBeVisible();
    await bassist.page.getByRole("button", { name: "Larger" }).click();
    await expect(conductor.page.locator("pre").first()).toHaveCSS("font-size", "16px");

    // Bassist mutes their own click; the shared state keeps running later.
    await bassist.page.getByRole("button", { name: "Click on" }).click();
    await expect(bassist.page.getByRole("button", { name: "Click off" })).toBeVisible();
    await conductor.page.getByRole("button", { name: "Musicians" }).click();
    await expect(conductor.page.getByText("click muted")).toBeVisible();
    await conductor.page.getByRole("button", { name: "Close" }).click();

    // Start: the server schedules a future start; both devices enter the count-in then play.
    await conductor.page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(conductor.page.getByText(/Count-in|Playing/).first()).toBeVisible();
    await expect(bassist.page.getByText(/Count-in|Playing/).first()).toBeVisible();
    await expect(conductor.page.getByText("Playing").first()).toBeVisible({ timeout: 10_000 });
    await expect(bassist.page.getByText("Playing").first()).toBeVisible({ timeout: 10_000 });
    await expect(conductor.page.getByRole("button", { name: "Stop" })).toBeVisible();

    // Sync diagnostics are measured and shown on the member device.
    await bassist.page.getByRole("button", { name: "Sync quality" }).click();
    await expect(bassist.page.getByText("Clock offset")).toBeVisible();
    await expect(bassist.page.getByText(/Samples/)).toBeVisible();
    await expect(bassist.page.getByText(/Good|Fair|Poor/).first()).toBeVisible({ timeout: 10_000 });
    await bassist.page.screenshot({ path: "test-results/member-mobile.png" });
    await bassist.page.getByRole("button", { name: "Close" }).click();

    // Next song: new tempo propagates, metronome stops because the song changed.
    await conductor.page.getByRole("button", { name: "Next song" }).click();
    await expect(bassist.page.getByText("Song Beta").first()).toBeVisible();
    await expect(bassist.page.getByTestId("sheet-bpm")).toHaveText("140 BPM");
    await expect(conductor.page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
    await conductor.page.screenshot({ path: "test-results/conductor-desktop.png" });

    // Conductor disconnects: the bassist (who may conduct) is offered the take-over and claims it.
    await conductor.context.close();
    await expect(bassist.page.getByText("The conductor is offline")).toBeVisible({
      timeout: 10_000,
    });
    await bassist.page.getByRole("button", { name: "Take over as conductor" }).click();
    await expect(bassist.page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    // Reconnection: a reload rejoins with the full state (song, tempo) and the role is kept.
    await bassist.page.reload();
    await expect(bassist.page.getByText("Song Beta").first()).toBeVisible();
    await expect(bassist.page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    // End the session: new visitors see the ended screen.
    await openSheet();
    await bassist.page.getByRole("button", { name: "Conductor controls" }).click();
    await bassist.page.getByRole("button", { name: "End session" }).click();
    await bassist.page.getByRole("button", { name: "Confirm" }).click();
    await expect(bassist.page.getByRole("heading", { name: "Session ended" })).toBeVisible();
    await bassist.context.close();
  });

  test("a member without conducting permission cannot start a session", async ({ browser }) => {
    const ana = await registerUser("Ana Drums", "drums");
    const carla = await registerUser("Carla Voice", "vocals");
    const bandId = await createBand(ana, "Perm Band");
    await join(carla, await inviteCode(ana, bandId));
    const res = await ana.api.patch(`/api/bands/${bandId}/members/${carla.id}`, {
      data: { permissions: { canControlRehearsal: false } },
    });
    expect(res.status()).toBe(200);
    const { page, context } = await contextFor(browser, carla);
    await page.goto(`/bands/${bandId}/rehearsal`);
    await expect(
      page.getByText("Only members allowed to conduct can start a session."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Start session" })).toHaveCount(0);
    await context.close();
  });
});

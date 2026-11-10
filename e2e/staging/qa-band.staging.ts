import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { api, fits, QA_BAND, qaSession, SHOTS, throughGate } from "./support";

/**
 * Everything that writes, in the QA band only: link research against the real services,
 * a pre-arrangement from an uploaded recording that may be processed, the section player,
 * limits corrected while listening, the live room. What the run creates is removed at the end.
 */
const YT = "https://www.youtube.com/watch?v=JZqFoTIAJj8";
const FIX = "../packages/shared/test/fixtures/audio";
const MONTAGE = join(tmpdir(), `bandsync-qa-montage-${process.pid}.ogg`);

test.beforeAll(() => {
  // A B A C A from three public-domain / CC BY recordings (ATTRIBUTION.md), 18 s each.
  const part = (file: string, from: number) => [
    "-ss",
    String(from),
    "-t",
    "18",
    "-i",
    `${FIX}/${file}`,
  ];
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    ...part("hungarian-dance-5.ogg", 2),
    ...part("sugar-plum-fairy.ogg", 40),
    ...part("hungarian-dance-5.ogg", 2),
    ...part("vibe-ace.ogg", 9),
    ...part("hungarian-dance-5.ogg", 2),
    "-filter_complex",
    "[0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1,aresample=22050,aformat=channel_layouts=mono",
    "-c:a",
    "libvorbis",
    "-q:a",
    "4",
    MONTAGE,
  ]);
});

test("QA band: link research, map from an uploaded recording, section player, editing, live room", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { context, page } = await throughGate(browser);
  const { bandId } = await qaSession(page);
  const base = `/api/bands/${bandId}`;
  const created: string[] = [];
  const files: string[] = [];
  try {
    // 1. A pasted link is researched without waiting for the player: the video's own title
    //    names the version, and Deezer's data for exactly that recording is kept as an estimate.
    const prep = await api(page, "POST", `${base}/autoarrange/prepare`, {
      newSong: { title: "Pérola Negra" },
      recording: {
        source: "link",
        title: "Pérola Negra",
        artistCredit: "Natiruts feat. Luiz Melodia",
      },
      referenceUrl: YT,
    });
    expect(prep.status, prep.text).toBe(201);
    const linkSong = prep.json.song.id as string;
    created.push(linkSong);
    const jobId = prep.json.job.id as string;
    await expect
      .poll(
        async () => (await api(page, "GET", `${base}/autoarrange/jobs/${jobId}`)).json.job.status,
        {
          timeout: 60_000,
        },
      )
      .toBe("awaiting_review");
    const o = (await api(page, "GET", `${base}/autoarrange/songs/${linkSong}`)).json;
    const deezer = o.results.filter((r: { origin: string }) => r.origin === "deezer");
    console.log(
      JSON.stringify({
        linkResearch: deezer.map((r: { kind: string; value: unknown }) => [r.kind, r.value]),
      }),
    );
    expect(deezer.find((r: { kind: string }) => r.kind === "bpm")?.value).toMatchObject({
      match: "title_version",
      deezerTrackId: 429918992,
    });
    expect(o.preparation.analysis).toBe("not_possible"); // catalogue data is not an analysis
    await page.goto(`/bands/${bandId}/songs/${linkSong}/arrangement`);
    await expect(page.getByTestId("prearrangement-card")).toHaveAttribute(
      "data-stage",
      "analysis_unavailable",
    );
    await expect(
      page.getByTestId("verified-facts").locator('[data-origin="deezer"]').first(),
    ).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/40-qa-link.png`, fullPage: true });

    // 2. A recording that may be processed: mapped on the device, heard section by section.
    const song = await api(page, "POST", `${base}/songs`, {
      title: "Montagem CC (teste automático)",
    });
    const songId = song.json.song.id as string;
    created.push(songId);
    await page.goto(`/bands/${bandId}/songs/${songId}/arrangement`);
    const panel = page.getByTestId("generate-panel");
    await panel.getByTestId("prearrange-file").setInputFiles(MONTAGE);
    await panel.getByLabel("Base do direito de uso").selectOption("licensed");
    await panel.getByRole("checkbox", { name: /Declaro que a banda tem o direito/ }).check();
    await panel.getByRole("button", { name: "Enviar e gerar pré-arranjo" }).click();
    const pre = page.getByTestId("prearrangement");
    await expect(pre).toHaveAttribute("data-source", "audio_file", { timeout: 90_000 });
    const o2 = (await api(page, "GET", `${base}/autoarrange/songs/${songId}`)).json;
    files.push(...o2.audioAssets.map((a: { fileId: string }) => a.fileId));
    expect(o2.prearrangement.version).toBe("prearrange-v2");
    const n = o2.prearrangement.data.sections.length as number;
    console.log(
      JSON.stringify({
        montageSections: n,
        labels: o2.prearrangement.data.sections.map((s: { label: string }) => s.label).join(""),
      }),
    );
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(6);

    const bar = page.getByTestId("player-bar");
    await expect(bar).toHaveAttribute("data-kind", "file");
    await pre.getByTestId("recording-timeline").locator("button[data-label]").nth(1).click();
    await expect(bar).toHaveAttribute("data-playing", "true");
    await expect(bar).toHaveAttribute("data-passage", "pre:1");
    await bar.getByRole("button", { name: "Pausar" }).click();
    await expect(bar).toHaveAttribute("data-playing", "false");
    // The file is served in ranges, to members only.
    const fileUrl = `${base}/files/${files[0]}`;
    const range = await api(page, "GET", fileUrl, undefined, { range: "bytes=0-1" });
    expect(range.status).toBe(206);
    // Someone who is not logged in (and has not even passed the gate) gets nothing.
    const anon = await browser.newContext();
    const stranger = await anon.newPage();
    const answer = await stranger.goto(new URL(fileUrl, page.url()).toString());
    expect(answer?.headers()["content-type"] ?? "").not.toContain("audio");
    await anon.close();

    // 3. The band's version, corrected while listening, saved.
    const editor = page.getByTestId("arrangement-editor");
    await editor.getByRole("button", { name: "Começar a partir do pré-arranjo" }).click();
    const rows = editor.getByTestId("arrangement-section");
    await editor.getByTestId("boundary-handle").first().focus();
    await page.keyboard.press("ArrowRight");
    await editor.getByLabel("Nome da seção 1").fill("Abertura");
    await editor.getByTestId("save-arrangement").click();
    await expect(page.getByText("Arranjo da banda salvo")).toBeVisible();
    await expect(rows).toHaveCount(n);
    await page.screenshot({ path: `${SHOTS}/41-qa-arquivo-player.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/42-qa-arquivo-celular.png` });
    await page.setViewportSize({ width: 1280, height: 800 });

    // 4. Live rehearsal of the QA band shows the revised map.
    const rep = await api(page, "POST", `${base}/repertoires`, {
      name: `QA ${Date.now()}`,
      kind: "rehearsal",
    });
    const repId = rep.json.repertoire.id as string;
    await api(page, "POST", `${base}/repertoires/${repId}/items`, { songId });
    await page.goto(`/bands/${bandId}/rehearsal`);
    await page.getByLabel("Repertório desta sessão").selectOption(repId);
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await page.getByRole("button", { name: "Ativar som" }).first().click();
    await page.getByRole("button", { name: "Escolher música" }).click();
    await page.getByRole("button", { name: /Montagem CC/ }).click();
    await expect(page.getByTestId("live-arrangement")).toContainText("Abertura");
    await page.screenshot({ path: `${SHOTS}/43-qa-ensaio.png` });
    // The same room at phone size: controls in a sheet, one row; the material can go full screen.
    await page.setViewportSize({ width: 390, height: 844 });
    const sheet = page.getByTestId("control-sheet");
    await expect(sheet).toHaveAttribute("data-level", "mini");
    const share =
      (await page.getByTestId("room-material").boundingBox())!.height / page.viewportSize()!.height;
    console.log(JSON.stringify({ phoneMaterialShare: Math.round(share * 100) }));
    expect(share).toBeGreaterThan(0.72);
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/44-qa-ensaio-celular.png` });
    await page.getByTestId("focus-enter").click();
    await expect(sheet).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/45-qa-ensaio-tela-cheia.png` });
    await page.getByTestId("focus-handle").click();
    await expect(sheet).toHaveAttribute("data-level", "mini");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page
      .getByRole("button", { name: "Controles do regente" })
      .click({ timeout: 3000 })
      .catch(() => undefined);
    await page.getByRole("button", { name: "Encerrar sessão" }).click();
    await page.getByRole("button", { name: "Confirmar" }).click();
    await api(page, "DELETE", `${base}/repertoires/${repId}`);
  } finally {
    // Leave the QA band as it was found.
    for (const id of created) await api(page, "DELETE", `${base}/songs/${id}`);
    for (const id of files) await api(page, "DELETE", `${base}/files/${id}`);
  }
  const left = (await api(page, "GET", `${base}/songs`)).json.songs as unknown[];
  console.log(JSON.stringify({ band: QA_BAND, songsLeft: left.length }));
  await context.close();
});

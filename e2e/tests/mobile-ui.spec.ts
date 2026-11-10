import { devices, expect, type Page, test } from "@playwright/test";
import {
  contextFor,
  createBand,
  createRepertoire,
  createSong,
  inviteCode,
  join,
  registerUser,
} from "./helpers";

/**
 * The app on a phone outside the live room: home, one bottom bar (the app's, or the band's when
 * inside a band), compact lists, and a way into the rehearsal that says what it will do.
 */
const IPHONE = devices["iPhone 13"];
const LONG = "Uma canção de nome bem comprido para testar a quebra de linha no celular";

const fits = (page: Page) =>
  page.evaluate(
    (w) => window.innerWidth <= w + 1 && document.documentElement.scrollWidth <= w + 1,
    page.viewportSize()!.width,
  );
const navLabels = (page: Page) => page.getByTestId("bottom-nav").getByRole("link").allInnerTexts();

test("phone: home, navigation, band, lists, members and the way into the rehearsal (pt-BR)", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ana = await registerUser("Ana Ribeiro", "vocals", "pt-BR");
  const bruno = await registerUser("Bruno Baixo", "bass", "pt-BR");
  const bandId = await createBand(ana, "Banda do Bairro");
  await createBand(ana, "Trio de Quinta");
  await join(bruno, await inviteCode(ana, bandId, "bass"));
  for (const [n, i] of [
    ["Carla Teclas", "keys"],
    ["Dudu Batera", "drums"],
  ] as const)
    await join(await registerUser(n, i, "pt-BR"), await inviteCode(ana, bandId, i));
  // Bruno plays; he does not conduct.
  await ana.api.patch(`/api/bands/${bandId}/members/${bruno.id}`, {
    data: { permissions: { canControlRehearsal: false } },
  });
  const ids: string[] = [];
  for (const [t, bpm] of [
    ["Pérola Negra", 72],
    ["Esotérico", 96],
    [LONG, 88],
  ] as const)
    ids.push(
      await createSong(ana, bandId, t, bpm, [{ type: "lyrics", instrument: null, body: "la" }]),
    );
  // A song the band has not set a tempo for yet.
  const noBpm = await ana.api.post(`/api/bands/${bandId}/songs`, {
    data: { title: "Sem andamento" },
  });
  ids.push((await noBpm.json()).song.id);
  const repId = await createRepertoire(ana, bandId, "Ensaio de quinta", ids);

  const { page, context } = await contextFor(browser, ana, { ...IPHONE });

  // 1. Home: where I left off, my bands, the tools. One bottom bar with four places.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Olá, Ana");
  await expect(page.getByTestId("bottom-nav")).toHaveAttribute("data-context", "app");
  expect(await navLabels(page)).toEqual(["Início", "Bandas", "Ferramentas", "Perfil"]);
  await expect(page.getByRole("heading", { name: "Minhas bandas" })).toBeVisible();
  await expect(page.getByTestId("band-row")).toHaveCount(2);
  await expect(page.getByTestId("band-row").first()).toContainText("4 integrantes");
  const entry = page.getByTestId("live-entry");
  await expect(entry).toHaveAttribute("data-kind", "start");
  await expect(entry.getByRole("button", { name: "Iniciar ensaio" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Afinador" })).toHaveAttribute(
    "href",
    "/tools?tool=tuner",
  );
  await expect(page.getByTestId("credit")).toHaveText("Desenvolvido por Gabriel Gavinelli");
  expect(await fits(page)).toBe(true);
  // Rows, not tall cards.
  expect((await page.getByTestId("band-row").first().boundingBox())!.height).toBeLessThanOrEqual(
    72,
  );
  await page.screenshot({ path: "test-results/mobile-01-inicio.png" });

  // 2. Into the band: the bar becomes the band's (still one bar); the header leads back.
  await page.getByTestId("band-row").filter({ hasText: "Banda do Bairro" }).click();
  await expect(page).toHaveURL(new RegExp(`/bands/${bandId}$`));
  await expect(page.getByTestId("bottom-nav")).toHaveAttribute("data-context", "band");
  await expect(page.getByTestId("bottom-nav")).toHaveCount(1);
  expect(await navLabels(page)).toEqual([
    "Banda",
    "Ensaio",
    "Músicas",
    "Repertórios",
    "Integrantes",
  ]);
  await expect(page.getByTestId("band-header")).toContainText("Banda do Bairro");
  await expect(page.getByTestId("band-identity")).toContainText("4 integrantes");
  // The rehearsal comes first and fits the first screen, with the list in use right under it.
  const live = page.getByTestId("live-entry");
  await expect(live).toBeInViewport();
  expect((await live.boundingBox())!.height).toBeLessThanOrEqual(96);
  const current = page.getByTestId("current-repertoire");
  await expect(current).toContainText("Ensaio de quinta");
  await expect(current).toContainText("4 músicas");
  await expect(current.getByRole("button", { name: "Ensaiar" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Integrantes\s*4/ })).toBeInViewport();
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-02-banda.png" });
  await page.getByRole("link", { name: "Voltar ao início" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("bottom-nav")).toHaveAttribute("data-context", "app");
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/bands/${bandId}$`));

  // 3. Songs: compact rows with the confirmed tempo; a long name stays readable.
  await page.getByTestId("bottom-nav").getByRole("link", { name: "Músicas" }).click();
  const rows = page.getByTestId("song-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: "Pérola Negra" }).getByTestId("song-bpm")).toHaveText(
    "72 BPM",
  );
  await expect(rows.filter({ hasText: "Sem andamento" })).toContainText("sem BPM");
  await expect(rows.filter({ hasText: "Sem andamento" }).getByTestId("song-bpm")).toHaveCount(0);
  expect((await rows.filter({ hasText: "Esotérico" }).boundingBox())!.height).toBeLessThanOrEqual(
    72,
  );
  const long = rows.filter({ hasText: "Uma canção de nome" });
  expect((await long.boundingBox())!.height).toBeLessThanOrEqual(100);
  await expect(long).toContainText("bem comprido"); // second line, not cut after the first
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-03-musicas.png" });
  await expect(page.getByRole("link", { name: "Adicionar música" })).toBeVisible();

  // 4. Repertoire: the list and its order, in rows.
  await page.getByTestId("bottom-nav").getByRole("link", { name: "Repertórios" }).click();
  await page
    .getByTestId("repertoire-list")
    .getByRole("link", { name: /Ensaio de quinta/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/repertoires/${repId}$`));
  const items = page.getByTestId("repertoire-items").locator("li");
  await expect(items).toHaveCount(4);
  await expect(items.first()).toContainText("Pérola Negra");
  await expect(items.first()).toContainText("72 BPM");
  await items.first().getByRole("button", { name: "Mover para baixo" }).click();
  await expect(items.first()).toContainText("Esotérico");
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-04-repertorio.png" });

  // 5. Members: everything of a row is on screen (the edit control used to be cut off).
  await page.getByTestId("bottom-nav").getByRole("link", { name: "Integrantes" }).click();
  const members = page.getByTestId("member-list").locator("li");
  await expect(members).toHaveCount(4);
  await expect(members.first()).toContainText("Ana Ribeiro");
  await expect(members.first()).toContainText("Voz");
  await expect(members.first()).toContainText("Administrador");
  const edit = page.getByRole("button", { name: "Editar: Bruno Baixo" });
  const box = (await edit.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  expect((await members.nth(1).boundingBox())!.height).toBeLessThanOrEqual(72);
  await edit.click();
  await expect(page.getByRole("dialog")).toContainText("Permissões");
  await page.getByRole("button", { name: "Fechar" }).click();
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-05-integrantes.png" });

  // 6. The way into the rehearsal says what will happen, for each person and moment.
  await page.getByTestId("bottom-nav").getByRole("link", { name: "Ensaio" }).click();
  const lobby = page.getByTestId("lobby");
  await expect(lobby).toHaveAttribute("data-state", "start");
  await expect(lobby).toContainText("Você será o regente");
  const b = await contextFor(browser, bruno, { ...IPHONE });
  await b.page.goto(`/bands/${bandId}/rehearsal`);
  await expect(b.page.getByTestId("lobby")).toHaveAttribute("data-state", "none");
  await expect(b.page.getByRole("button", { name: /Iniciar/ })).toHaveCount(0);
  await page.screenshot({ path: "test-results/mobile-06-ensaio.png" });

  await page.getByLabel("Repertório desta sessão").selectOption(repId);
  await page.getByRole("button", { name: "Iniciar sessão" }).click();
  await expect(page).toHaveURL(/\/rehearsal\/[0-9a-f-]+$/);
  // Inside the room: its own sheet, no app navigation, no credit taking space.
  await expect(page.getByTestId("control-sheet")).toBeVisible();
  await expect(page.getByTestId("bottom-nav")).toHaveCount(0);
  await expect(page.getByTestId("credit")).toHaveCount(0);

  // Bruno sees a rehearsal to join; Ana, back on the band page, one of her own to resume.
  await b.page.goto(`/bands/${bandId}`);
  const bEntry = b.page.getByTestId("live-entry");
  await expect(bEntry).toHaveAttribute("data-kind", "join");
  await expect(bEntry).toContainText("Ensaio em andamento");
  await b.page.goto(`/bands/${bandId}/rehearsal`);
  await expect(b.page.getByTestId("lobby")).toHaveAttribute("data-state", "join");
  await expect(b.page.getByTestId("lobby")).toContainText("Você entra como músico");
  await b.page.getByRole("button", { name: "Entrar no ensaio" }).click();
  await expect(b.page).toHaveURL(/\/rehearsal\/[0-9a-f-]+$/);

  const room = page.url();
  await page.goto(`/bands/${bandId}`);
  const aEntry = page.getByTestId("live-entry");
  await expect(aEntry).toHaveAttribute("data-kind", "resume");
  await aEntry.getByRole("button", { name: "Retomar sessão" }).click();
  await expect(page).toHaveURL(room);
  // End it: the lobby then says when the last one ended.
  await page.getByRole("button", { name: "Ativar som" }).click();
  await page.getByTestId("sheet-toggle").tap();
  await page.getByTestId("sheet-toggle").tap();
  await page.getByRole("button", { name: "Controles do regente" }).tap();
  await page.getByRole("button", { name: "Encerrar sessão" }).tap();
  await page.getByRole("button", { name: "Confirmar" }).tap();
  await page.goto(`/bands/${bandId}/rehearsal`);
  await expect(page.getByTestId("lobby")).toHaveAttribute("data-state", "start");
  await expect(page.getByTestId("last-ended")).toContainText("Última sessão encerrada em");
  await b.context.close();

  // 7. Tools: one at a time, nothing wider than the screen.
  await page.goto("/tools");
  const tools = page.getByTestId("tools");
  await expect(tools).toHaveAttribute("data-tool", "metronome");
  await expect(page.getByRole("button", { name: "Iniciar" })).toBeInViewport();
  expect(await fits(page)).toBe(true);
  await page.getByRole("radio", { name: "Afinador" }).click();
  await expect(tools).toHaveAttribute("data-tool", "tuner");
  await expect(page.getByTestId("tuner")).toHaveAttribute("data-state", "idle");
  await expect(page.getByRole("button", { name: "Começar a ouvir" })).toBeInViewport();
  expect(await fits(page)).toBe(true);
  await page.getByRole("radio", { name: "Transpositor" }).click();
  await expect(page.getByTestId("transposer-output")).toBeVisible();
  expect(await fits(page)).toBe(true);
  await context.close();
});

test("phone, English account: the same places under their English names; small and wide phones fit", async ({
  browser,
}) => {
  const ana = await registerUser("Ann Keys", "keys", "en");
  const bandId = await createBand(ana, "Corner Band");
  await createSong(ana, bandId, "Song Alpha", 100, []);
  for (const viewport of [
    { width: 320, height: 568 }, // the smallest phones still in use
    { width: 430, height: 932 },
    { width: 844, height: 390 }, // a phone held sideways
  ]) {
    const { page, context } = await contextFor(browser, ana, {
      viewport,
      isMobile: true,
      hasTouch: true,
    });
    for (const path of [
      "/",
      "/bands",
      `/bands/${bandId}`,
      `/bands/${bandId}/songs`,
      `/bands/${bandId}/members`,
      `/bands/${bandId}/rehearsal`,
      "/tools",
      "/tools?tool=tuner",
      "/profile",
    ]) {
      await page.goto(path);
      await expect(page.getByTestId("credit")).toHaveText("Developed by Gabriel Gavinelli");
      expect(await fits(page), `${path} at ${viewport.width}×${viewport.height}`).toBe(true);
      // No raw translation key on screen ("nav.home", "entry.title.start"…).
      // biome-ignore lint/performance/useDomNodeTextContent: what is visible is what matters here (Playwright's innerText)
      expect(await page.locator("body").innerText()).not.toMatch(
        /\b(nav|home|myBands|dashboard|entry|sheet|focus|tuner|lobby|songs|members|actions|count|role|metronome|transposer)\.[a-z][a-zA-Z_.]*\b/,
      );
    }
    if (viewport.width === 430) {
      await page.goto("/");
      await expect(page.getByTestId("bottom-nav").getByRole("link")).toHaveCount(4);
      expect(await page.getByTestId("bottom-nav").getByRole("link").allInnerTexts()).toEqual([
        "Home",
        "Bands",
        "Tools",
        "Profile",
      ]);
      await page.goto(`/bands/${bandId}`);
      await expect(page.getByTestId("bottom-nav").getByRole("link")).toHaveCount(5);
      expect(await page.getByTestId("bottom-nav").getByRole("link").allInnerTexts()).toEqual([
        "Band",
        "Rehearsal",
        "Songs",
        "Repertoires",
        "Members",
      ]);
      await expect(
        page.getByTestId("live-entry").getByRole("button", { name: "Start rehearsal" }),
      ).toBeVisible();
    }
    await context.close();
  }
});

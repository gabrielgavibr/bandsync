import { devices, expect, type Page, test } from "@playwright/test";
import { API, contextFor, createBand, createSong, registerUser } from "./helpers";

/**
 * The first real rehearsal of a full band, end to end, in an isolated band of its own:
 * personal links → own accounts → the weekly rehearsal of today → attendance → the board,
 * before, during (inside Ensaio Live) and after; on an iPhone and an Android screen, pt-BR and en.
 */
const IPHONE = devices["iPhone 13"];
const ANDROID = devices["Pixel 5"];

const fits = (page: Page) =>
  page.evaluate(
    (w) => document.documentElement.scrollWidth <= w + 1,
    page.viewportSize()!.width,
  );

function todayInSaoPaulo() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(now);
  return { date, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd) };
}

test("personal invitations, weekly rehearsal, attendance and the rehearsal board", async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = await registerUser("Gavi Admin", "drums", "pt-BR");
  const bandId = await createBand(admin, `Banda QA ${Date.now()}`);
  await createSong(admin, bandId, "Meu Velho QA", 92, []);
  const { date, weekday } = todayInSaoPaulo();
  const sched = await admin.api.post(`/api/bands/${bandId}/agenda/schedules`, {
    data: { title: "Ensaio semanal", weekday, time: "23:59", timezone: "America/Sao_Paulo", startDate: date },
  });
  expect(sched.status(), await sched.text()).toBe(201);
  const invite = async (inviteeName: string, instrument: string) => {
    const res = await admin.api.post(`/api/bands/${bandId}/personal-invites`, {
      data: { inviteeName, instrument, secondaryInstruments: ["vocals"] },
    });
    expect(res.status()).toBe(201);
    return (await res.json()).url.replace(/^https?:\/\/[^/]+/, "") as string;
  };
  const leoPath = await invite("Leonardo Morango", "percussion");
  const jeffsPath = await invite("Jeffs", "keys");

  // 1. A musician without an account opens their link on an iPhone (pt-BR).
  const leoCtx = await browser.newContext({ ...IPHONE, locale: "pt-BR" });
  const leo = await leoCtx.newPage();
  await leo.goto(leoPath);
  const landing = leo.getByTestId("invite-landing");
  await expect(landing).toHaveAttribute("data-status", "active");
  await expect(landing).toContainText("Convite para Leonardo Morango");
  await expect(landing).toContainText("Percussão");
  expect(await fits(leo)).toBe(true);
  await leo.screenshot({ path: "test-results/first-rehearsal-01-invite.png" });
  const form = leo.getByTestId("invite-register");
  await expect(form.getByLabel("Nome de exibição")).toHaveValue("Leonardo Morango");
  await form.getByLabel("E-mail").fill(`leo-${Date.now()}@e2e.test`);
  await form.getByLabel("Senha").fill("leo-private-password");
  await form.getByRole("button", { name: "Criar minha conta e entrar" }).tap();
  await expect(leo).toHaveURL(new RegExp(`/bands/${bandId}$`));

  // 2. Today's rehearsal is on the band page; attendance and a comment before it starts.
  await expect(leo.getByTestId("next-rehearsals")).toBeVisible();
  await leo.getByTestId("occurrence-row").first().tap();
  await expect(leo.getByTestId("occurrence-when")).toContainText("23:59");
  await expect(leo.getByText("Hoje").first()).toBeVisible();
  await leo.getByRole("radio", { name: "Confirmado" }).tap();
  await expect(leo.getByRole("radio", { name: "Confirmado" })).toHaveAttribute("aria-checked", "true");
  await expect(leo.getByTestId("attendance-summary")).toContainText("1 confirmados");
  await leo.getByRole("textbox", { name: "Novo comentário" }).fill("Chego às 19h10, começem sem mim");
  await leo.getByRole("button", { name: "Enviar" }).tap();
  await expect(leo.getByTestId("board-comment")).toHaveCount(1);
  expect(await fits(leo)).toBe(true);
  await leo.screenshot({ path: "test-results/first-rehearsal-02-occurrence.png", fullPage: true });

  // 3. The link was used: a second use is refused, and it does not grant a second account.
  const other = await browser.newContext({ ...IPHONE, locale: "pt-BR" });
  const otherPage = await other.newPage();
  await otherPage.goto(leoPath);
  await expect(otherPage.getByTestId("invite-landing")).toHaveAttribute("data-status", "used");
  await other.close();

  // 4. A musician who already has an account (Android, English) takes their invitation signed in.
  const jeffs = await registerUser("Jeff S", "guitar", "en");
  const j = await contextFor(browser, jeffs, { ...ANDROID, locale: "en-US" });
  await j.page.goto(jeffsPath);
  await j.page.getByRole("button", { name: "Join the band as Jeff S" }).tap();
  await expect(j.page).toHaveURL(new RegExp(`/bands/${bandId}$`));

  // 5. The admin opens Ensaio Live from the rehearsal; nothing plays by itself.
  const a = await contextFor(browser, admin, { ...ANDROID, locale: "pt-BR" });
  await a.page.goto(`/bands/${bandId}/rehearsal`);
  await a.page.getByTestId("occurrence-row").first().tap();
  await expect(a.page.getByTestId("board-comment")).toContainText("Chego às 19h10");
  await a.page.getByTestId("occurrence-live").tap();
  await expect(a.page).toHaveURL(/\/rehearsal\/[0-9a-f-]+$/);
  const roomUrl = a.page.url();
  await expect(a.page.getByTestId("sheet-transport")).toHaveAttribute("data-running", "false");
  // The board inside the live room.
  await a.page.getByTestId("board-open").tap();
  const dialog = a.page.getByRole("dialog");
  await expect(dialog.getByTestId("board-comment")).toHaveCount(1);
  await dialog.getByRole("textbox", { name: "Novo comentário" }).fill("Começamos por Meu Velho");
  await dialog.getByLabel("Música (opcional)").selectOption({ label: "Meu Velho QA" });
  await dialog.getByRole("button", { name: "Enviar" }).tap();
  await expect(dialog.getByTestId("board-comment")).toHaveCount(2);
  await expect(dialog).toContainText("Sobre Meu Velho QA");
  expect(await fits(a.page)).toBe(true);
  await a.page.screenshot({ path: "test-results/first-rehearsal-03-live-board.png" });

  // 6. Real time: the musician's open page shows the new comment without reloading.
  await expect(leo.getByTestId("board-comment")).toHaveCount(2, { timeout: 15_000 });
  // The musician joins the same live session from the rehearsal page.
  await expect(leo.getByTestId("occurrence-live")).toContainText("Entrar no Ensaio Live", { timeout: 20_000 });
  await leo.getByTestId("occurrence-live").tap();
  await expect(leo).toHaveURL(roomUrl.replace(API, ""));
  // Others cannot remove someone else's comment: the button is not even offered.
  await leo.getByTestId("board-open").tap();
  const leoDialog = leo.getByRole("dialog");
  await expect(leoDialog.getByTestId("board-comment").nth(1).getByRole("button", { name: "Remover" })).toHaveCount(0);
  await leoDialog.getByRole("button", { name: "Fechar" }).tap();

  // 7. After: the conductor ends the session; the board stays open.
  await a.page.getByRole("dialog").getByRole("button", { name: "Fechar" }).tap();
  const end = await admin.api.get(`/api/bands/${bandId}/rehearsals`);
  const sessionId = (await end.json()).active.id;
  const ws = a.page; // end through the UI on the desktop layout would need the full panel; use the sheet
  await ws.getByTestId("sheet-toggle").tap();
  await ws.getByTestId("sheet-toggle").tap();
  await ws.getByRole("button", { name: "Controles do regente" }).tap();
  await ws.getByRole("button", { name: "Encerrar sessão" }).tap();
  await ws.getByRole("button", { name: "Confirmar" }).tap();
  await expect(ws.getByTestId("ended-board")).toBeVisible();
  await ws.getByTestId("ended-board").tap();
  await expect(ws.getByTestId("occurrence")).toHaveAttribute("data-live", "ended");
  await ws.getByRole("textbox", { name: "Novo comentário" }).fill("Bom ensaio, pessoal");
  await ws.getByRole("button", { name: "Enviar" }).tap();
  await expect(ws.getByTestId("board-comment")).toHaveCount(3);
  await ws.screenshot({ path: "test-results/first-rehearsal-04-after.png", fullPage: true });
  expect(sessionId).toBeTruthy();

  // 8. English on the musician's Android screen.
  await j.page.goto(`/bands/${bandId}/rehearsal`);
  await j.page.getByTestId("occurrence-row").first().tap();
  await expect(j.page.getByRole("heading", { name: "Rehearsal board" })).toBeVisible();
  await expect(j.page.getByText("The rehearsal is over, but the board stays open.")).toBeVisible();
  await expect(j.page.getByTestId("board-comment")).toHaveCount(3);
  expect(await fits(j.page)).toBe(true);

  await leoCtx.close();
  await j.context.close();
  await a.context.close();
});

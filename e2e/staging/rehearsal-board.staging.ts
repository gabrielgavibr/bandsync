import { devices, expect, test } from "@playwright/test";
import { api, fits, qaSession, SHOTS, throughGate } from "./support";

/**
 * Personal invitations, the weekly rehearsal and the rehearsal board on staging, in the QA band
 * only. No account is created: the invitation made here is opened (without the shared access
 * key) and then revoked; the comment is written, edited and removed.
 */
const IPHONE = devices["iPhone 13"];

test("QA band: a personal link opens without the access key; agenda, attendance and board", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page } = await throughGate(browser, { ...IPHONE });
  const { bandId } = await qaSession(page);

  // 1. A personal invitation opens the gate by itself, in a context that never saw the key.
  const created = await api(page, "POST", `/api/bands/${bandId}/personal-invites`, {
    inviteeName: "Convidado QA (não usar)",
    instrument: "keys",
    expiresInHours: 1,
  });
  expect(created.status, created.text).toBe(201);
  const path = new URL(created.json.url).pathname;
  const fresh = await browser.newContext({ ...IPHONE, locale: "pt-BR" });
  const guest = await fresh.newPage();
  await guest.goto(path);
  await expect(guest).toHaveURL(new RegExp(`${path}$`));
  await expect(guest.getByTestId("invite-landing")).toHaveAttribute("data-status", "active");
  await expect(guest.getByTestId("invite-landing")).toContainText("Convidado QA (não usar)");
  expect(await fits(guest)).toBe(true);
  await guest.screenshot({ path: `${SHOTS}/invite-landing.png` });
  const revoked = await api(
    page,
    "DELETE",
    `/api/bands/${bandId}/personal-invites/${created.json.invite.id}`,
  );
  expect(revoked.status).toBe(200);
  await guest.reload();
  await expect(guest.getByTestId("invite-landing")).toHaveAttribute("data-status", "revoked");
  // A made-up link does not open the gate.
  const other = await browser.newContext();
  const o = await other.newPage();
  await o.goto(`/convite/${"A".repeat(43)}`);
  await expect(o).toHaveURL(/\/__access/);
  await other.close();
  await fresh.close();

  // 2. A weekly rehearsal in the QA band (created once), with today's local date in Brasília.
  let agenda = (await api(page, "GET", `/api/bands/${bandId}/agenda`)).json;
  if (agenda.schedules.length === 0) {
    const res = await api(page, "POST", `/api/bands/${bandId}/agenda/schedules`, {
      title: "Ensaio QA",
      weekday: 2,
      time: "19:00",
      timezone: "America/Sao_Paulo",
      startDate: "2026-11-10",
    });
    expect(res.status, res.text).toBe(201);
    agenda = (await api(page, "GET", `/api/bands/${bandId}/agenda`)).json;
  }
  const first = agenda.upcoming[0] ?? agenda.past[0];
  expect(first.timezone).toBe("America/Sao_Paulo");
  expect(first.localTime).toBe("19:00");

  // 3. The rehearsal page on a phone: attendance and the board.
  await page.goto(`/bands/${bandId}/agenda/${first.id}`);
  await expect(page.getByTestId("occurrence-when")).toContainText("19:00");
  await page.getByRole("radio", { name: "Confirmado" }).tap();
  await expect(page.getByRole("radio", { name: "Confirmado" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const text = `Comentário de verificação ${Date.now()}`;
  await page.getByRole("textbox", { name: "Novo comentário" }).fill(text);
  await page.getByRole("button", { name: "Enviar" }).tap();
  const mine = page.getByTestId("board-comment").filter({ hasText: text });
  await expect(mine).toHaveCount(1);
  await mine.getByRole("button", { name: "Editar" }).tap();
  await page.getByRole("textbox", { name: "Editar" }).fill(`${text} (editado)`);
  await page.getByRole("button", { name: "Salvar" }).tap();
  await expect(page.getByTestId("board-comment").filter({ hasText: "(editado)" })).toHaveCount(1);
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/rehearsal-board.png`, fullPage: true });
  await page
    .getByTestId("board-comment")
    .filter({ hasText: "(editado)" })
    .getByRole("button", { name: "Remover" })
    .tap();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).tap();
  await expect(page.getByTestId("board-comment").filter({ hasText: text })).toHaveCount(0);
  await api(page, "PUT", `/api/bands/${bandId}/agenda/occurrences/${first.id}/attendance`, {
    status: "pending",
  });
  await context.close();
});

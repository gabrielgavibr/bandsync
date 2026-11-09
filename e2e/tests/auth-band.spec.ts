import { expect, test } from "@playwright/test";
import { contextFor, PASSWORD, registerUser } from "./helpers";

test.describe("accounts, bands and invitations", () => {
  test("registers through the UI, creates a band and invites a second user who joins by code", async ({
    browser,
    page,
  }) => {
    const stamp = Date.now();
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await page.getByLabel("Display name").fill("Ana Drums");
    await page.getByLabel("E-mail").fill(`ana-${stamp}@e2e.test`);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Main instrument").selectOption("drums");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "My bands" })).toBeVisible();
    await expect(page.getByText("You are not in a band yet.")).toBeVisible();

    await page.getByRole("link", { name: "Create a band" }).first().click();
    await page.getByLabel("Band name").fill(`E2E Band ${stamp}`);
    await page.getByRole("button", { name: "Create band" }).click();
    await expect(page.getByRole("heading", { name: "Invite members" })).toBeVisible();
    await page.getByRole("button", { name: "Generate invitation" }).click();
    await expect(page.getByText("Invitation ready")).toBeVisible();
    const code = (await page.locator(".font-mono.text-4xl").textContent())?.trim() ?? "";
    expect(code).toHaveLength(8);

    // Second user joins through the join page.
    const bruno = await registerUser("Bruno Bass", "bass");
    const { page: p2, context: c2 } = await contextFor(browser, bruno);
    await p2.goto(`/join/${code}`);
    await expect(p2.getByText("invited you to join")).toBeVisible();
    await p2.getByRole("button", { name: "Accept and join" }).click();
    await expect(p2.getByRole("heading", { name: `E2E Band ${stamp}` })).toBeVisible();

    // Admin sees both members; the member cannot see the invite page.
    await page.getByRole("link", { name: "Back" }).click();
    await expect(page.locator("#content").getByText("Bruno Bass")).toBeVisible();
    await expect(page.locator("#content").getByText("Ana Drums")).toBeVisible();
    await p2.goto(p2.url().replace(/\/?$/, "/invite"));
    await expect(p2.getByText("You do not have permission to do that.")).toBeVisible();
    await c2.close();
  });

  test("shows the interface in Portuguese when the account prefers pt-BR and switches live", async ({
    browser,
  }) => {
    const user = await registerUser("Carla Voz", "vocals", "pt-BR");
    const { page, context } = await contextFor(browser, user);
    await page.goto("/bands");
    await expect(page.getByRole("heading", { name: "Minhas bandas" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await page.getByRole("link", { name: "Perfil" }).first().click();
    await page.getByRole("radio", { name: "English" }).click();
    await expect(page.getByRole("heading", { name: "Profile & preferences" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    // Preference persisted on the account: a fresh page load stays in English.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Profile & preferences" })).toBeVisible();
    await context.close();
  });

  test("rejects wrong credentials with a translated message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("nobody@e2e.test");
    await page.getByLabel("Password").fill("wrong-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toHaveText("Wrong e-mail or password.");
  });
});

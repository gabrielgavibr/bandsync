import { defineConfig, devices } from "@playwright/test";

const WEB = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB,
    trace: "off",
    locale: "en-US",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
      // Lets the Web Audio click start in headless runs without a real gesture.
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @bandsync/api dev",
      url: "http://localhost:8787/api/health",
      reuseExistingServer: true,
      cwd: "..",
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @bandsync/web dev",
      url: WEB,
      reuseExistingServer: true,
      cwd: "..",
      timeout: 120_000,
    },
  ],
});

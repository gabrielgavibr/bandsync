import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke test of a deployed staging environment (no local servers are started).
 *   STAGING_URL=https://bandsync-staging.<account>.workers.dev \
 *   STAGING_CREDENTIALS=../apps/api/.staging/credentials.txt \
 *   pnpm --filter @bandsync/e2e test:staging
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.staging\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  outputDir: "../test-results/staging",
  use: {
    baseURL: process.env.STAGING_URL,
    trace: "off",
    locale: "en-US",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

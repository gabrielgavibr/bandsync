import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { outboundService } from "./test/outbound.ts";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_ENV: "test",
            PBKDF2_ITERATIONS: "1000",
            RATE_LIMITS: "on",
            // No pause between MusicBrainz calls in tests; the fake service does not rate-limit.
            MUSICBRAINZ_MIN_INTERVAL_MS: "0",
          },
          // Every outbound request from the Worker goes to the in-process fake (no network in tests).
          outboundService,
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
      testTimeout: 20_000,
      // The fake external services (test/outbound.ts) live in this Node process and are shared by
      // every test file, including the "fail the next N requests" switch. Files run one at a time
      // so an outage simulated by one file cannot leak into another.
      fileParallelism: false,
    },
  };
});

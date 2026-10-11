import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // A short grace window so the timeout test runs fast.
        miniflare: { bindings: { GRACE_MS: "300", TEST_MIGRATIONS: migrations, STRIPE_WEBHOOK_SECRET: "whsec_test_secret" } },
      }),
    ],
    test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
  };
});

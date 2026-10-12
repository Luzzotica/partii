import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // A short grace window so the timeout test runs fast.
        miniflare: { bindings: { GRACE_MS: "300", TEST_MIGRATIONS: migrations, STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
          // Fake S3 credentials: signing direct uploads is pure computation.
          R2_ACCESS_KEY_ID: "test-access", R2_SECRET_ACCESS_KEY: "test-secret", R2_ENDPOINT: "https://acct.r2.example", R2_BUCKET: "partii-dev-files" } },
      }),
    ],
    test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
  };
});

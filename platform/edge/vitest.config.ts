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
          R2_ACCESS_KEY_ID: "test-access", R2_SECRET_ACCESS_KEY: "test-secret", R2_ENDPOINT: "https://acct.r2.example", R2_BUCKET: "partii-dev-files",
          // Low alert thresholds so the usage tests reach them quickly.
          ALERT_SESSIONS: "3", ALERT_ROOMS: "2", ALERT_LIMITED: "2", ALERT_RELAY_DROPPED: "100" },
          // Rate limits as production has them, but tiny (each test client has its own IP).
          ratelimits: { RL_CONNECT: { namespace_id: "9001", simple: { limit: 6, period: 60 } }, RL_SESSION: { namespace_id: "9002", simple: { limit: 3, period: 60 } }, RL_CREATE: { namespace_id: "9003", simple: { limit: 3, period: 60 } }, RL_JOIN: { namespace_id: "9004", simple: { limit: 10, period: 60 } } } },
      }),
    ],
    test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
  };
});

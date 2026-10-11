import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // A short grace window so the timeout test runs fast.
      miniflare: { bindings: { GRACE_MS: "300" } },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});

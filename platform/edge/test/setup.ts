import { applyD1Migrations, env } from "cloudflare:test";

// Every test file starts from the real schema.
await applyD1Migrations((env as any).DB, (env as any).TEST_MIGRATIONS);

import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("answers health", async () => {
  const res = await SELF.fetch("https://edge/health");
  expect(await res.json()).toEqual({ ok: true, env: "dev" });
});

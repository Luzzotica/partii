import { describe, it, expect } from "vitest";
import { buildWebRTCPrompt, API_KEY_PLACEHOLDER } from "@/lib/devPrompt";

const real = buildWebRTCPrompt({ apiKey: "mpk_live_test123", baseUrl: "https://example.com" });
const placeholder = buildWebRTCPrompt({ apiKey: API_KEY_PLACEHOLDER, baseUrl: "https://example.com" });

describe("buildWebRTCPrompt (v2)", () => {
  it("covers the current platform surface", () => {
    for (const marker of [
      "refresh-ice",
      "signal_gw",
      "room_token",
      "telemetry/connect",
      "turns:turn.cloudflare.com:443",
      "renegotiate",
      "signal_id",
      "relay=1",
    ]) {
      expect(real, `missing marker: ${marker}`).toContain(marker);
    }
  });

  it("no longer claims the stale facts", () => {
    expect(real).not.toContain("There is no WebSocket");
    expect(real).not.toContain("re-joining is the refresh");
  });

  it("keeps hardening strictly optional and skippable", () => {
    expect(real).toContain("APPENDIX (OPTIONAL)");
    expect(real).toContain("SKIP unless the user asks");
    // The zero-config promise is stated up front.
    expect(real).toContain("The API key alone is a complete auth setup");
  });

  it("inlines the real key and marks credentials filled-in", () => {
    expect(real).toContain("mpk_live_test123");
    expect(real).toContain("already filled in for you");
  });

  it("placeholder mode instructs the LLM to ask for a key", () => {
    expect(placeholder).toContain(API_KEY_PLACEHOLDER);
    expect(placeholder).toContain("you must fill in the API key");
    expect(placeholder).toContain("/developer");
  });

  it("embeds the synced protocol spec", () => {
    expect(real).toContain("engine-neutral wire spec");
    expect(real).toContain("POST /api/rooms/{roomId}/signals");
    expect(real).toContain("recovery ladder");
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mintPlayerToken, verifyPlayerToken } from "@/lib/api/playerToken";
import { mintSessionToken, verifySessionToken } from "@/lib/api/token";
import { mintRoomToken, verifyRoomToken } from "@/lib/api/roomToken";
import { verifyProviderProof } from "@/lib/api/identity";

beforeEach(() => {
  vi.stubEnv("SESSION_TOKEN_SECRET", "t".repeat(32));
});
afterEach(() => vi.unstubAllEnvs());

describe("player tokens", () => {
  it("round-trips", () => {
    const { token, expiresIn } = mintPlayerToken("player-1", "proj-1");
    expect(expiresIn).toBe(24 * 60 * 60);
    const claims = verifyPlayerToken(token);
    expect(claims?.pid).toBe("player-1");
    expect(claims?.proj).toBe("proj-1");
  });

  it("rejects tampered tokens", () => {
    const { token } = mintPlayerToken("player-1", "proj-1");
    expect(verifyPlayerToken(token.slice(0, -2) + "xx")).toBeNull();
  });

  it("is structurally un-confusable with session and room tokens", () => {
    const session = mintSessionToken({ projectId: "proj-1", apiKeyId: "key-1", platform: "web" }).token;
    const room = mintRoomToken("room-1", "host", "host");
    const player = mintPlayerToken("player-1", "proj-1").token;

    // Player verifier rejects the others…
    expect(verifyPlayerToken(session)).toBeNull();
    expect(verifyPlayerToken(room)).toBeNull();
    // …and the others reject a player token.
    expect(verifySessionToken(player)).toBeNull();
    expect(verifyRoomToken(player)).toBeNull();
  });
});

describe("provider proofs (phase-1 providers)", () => {
  it("anon: sanitizes the device id", async () => {
    const res = await verifyProviderProof("anon", { device_id: "abc<script>-123" }, {});
    expect(res).toEqual({ ok: true, subject: "abcscript-123" });
  });

  it("anon: requires a device id", async () => {
    const res = await verifyProviderProof("anon", {}, {});
    expect(res.ok).toBe(false);
  });

  it("dev: refused in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await verifyProviderProof("dev", { subject: "x" }, {});
    expect(res.ok).toBe(false);
  });

  it("unknown provider is rejected", async () => {
    const res = await verifyProviderProof("myspace", {}, {});
    expect(res.ok).toBe(false);
  });
});

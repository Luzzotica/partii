import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mintSessionToken, verifySessionToken } from "@/lib/api/token";
import { originAllowed, isLocalOrigin } from "@/lib/api/origin";

const NOW_MS = 1_750_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  process.env.SESSION_TOKEN_SECRET = "test-session-secret";
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.SESSION_TOKEN_SECRET;
});

describe("session token mint/verify", () => {
  const ctx = { projectId: "proj_1", apiKeyId: "key_1", platform: "web" };

  it("round-trips claims", () => {
    const { token } = mintSessionToken(ctx);
    const claims = verifySessionToken(token);
    expect(claims).not.toBeNull();
    expect(claims!.pid).toBe("proj_1");
    expect(claims!.kid).toBe("key_1");
    expect(claims!.plat).toBe("web");
  });

  it("rejects a tampered payload", () => {
    const { token } = mintSessionToken(ctx);
    const [h, , s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ pid: "evil", kid: "x", exp: 9e9 })).toString(
      "base64url",
    );
    expect(verifySessionToken(`${h}.${forged}.${s}`)).toBeNull();
  });

  it("rejects a token signed with the wrong secret", () => {
    const { token } = mintSessionToken(ctx);
    process.env.SESSION_TOKEN_SECRET = "different-secret";
    expect(verifySessionToken(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    const { token } = mintSessionToken(ctx, 60);
    vi.setSystemTime(NOW_MS + 61_000);
    expect(verifySessionToken(token)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifySessionToken("not.a.jwt.at.all")).toBeNull();
    expect(verifySessionToken("garbage")).toBeNull();
  });
});

describe("origin allowlist", () => {
  it("allows any origin when allowlist is empty", () => {
    expect(originAllowed("https://evil.com", [])).toBe(true);
  });

  it("allows a native client (no Origin) regardless of allowlist", () => {
    expect(originAllowed(null, ["https://play.sterlinglong.me"])).toBe(true);
  });

  it("matches exact host + scheme", () => {
    const allow = ["https://play.sterlinglong.me"];
    expect(originAllowed("https://play.sterlinglong.me", allow)).toBe(true);
    expect(originAllowed("http://play.sterlinglong.me", allow)).toBe(false);
    expect(originAllowed("https://evil.com", allow)).toBe(false);
  });

  it("supports a leading-wildcard host", () => {
    const allow = ["https://*.sterlinglong.me"];
    expect(originAllowed("https://play.sterlinglong.me", allow)).toBe(true);
    expect(originAllowed("https://sterlinglong.me", allow)).toBe(true);
    expect(originAllowed("https://evil.com", allow)).toBe(false);
  });

  it("detects local-dev origins", () => {
    expect(isLocalOrigin("http://localhost:5173")).toBe(true);
    expect(isLocalOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalOrigin("https://play.sterlinglong.me")).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { generateTurnCredentials } from "@/lib/api/turn";

// All time-sensitive assertions pin Date.now() so we get deterministic
// usernames (`<expiry>:k=...:p=...`).
const NOW_MS = 1_750_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.TURN_SHARED_SECRET;
  delete process.env.TURN_HOST;
});

describe("generateTurnCredentials", () => {
  it("embeds api key id + peer tag in the username", () => {
    process.env.TURN_SHARED_SECRET = "test-secret-32-chars-of-randomness";
    const out = generateTurnCredentials("apk_abc123", "peer_xyz");
    // username shape: "<unixExpiry>:k=<apiKeyId>:p=<peerTag>"
    expect(out.username).toMatch(/^\d+:k=apk_abc123:p=peer_xyz$/);
    const [exp, , p] = out.username.split(":");
    expect(Number(exp)).toBeGreaterThan(NOW_S);
    expect(p).toBe("p=peer_xyz");
  });

  it("produces a credential that's HMAC-SHA1(username, secret) base64", () => {
    process.env.TURN_SHARED_SECRET = "test-secret-32-chars-of-randomness";
    const out = generateTurnCredentials("apk_xxx", "peer_yyy");
    const expected = createHmac("sha1", "test-secret-32-chars-of-randomness")
      .update(out.username)
      .digest("base64");
    expect(out.credential).toBe(expected);
  });

  it("respects the requested TTL and clamps it to [60, 86400]", () => {
    process.env.TURN_SHARED_SECRET = "s";
    const def = generateTurnCredentials("k", "p");
    expect(def.ttl_seconds).toBe(600); // default 10 min

    const short = generateTurnCredentials("k", "p", 5);
    expect(short.ttl_seconds).toBe(60); // clamped up

    const long = generateTurnCredentials("k", "p", 999_999);
    expect(long.ttl_seconds).toBe(86_400); // clamped down

    const ok = generateTurnCredentials("k", "p", 1800);
    expect(ok.ttl_seconds).toBe(1800);
  });

  it("sanitizes weird characters out of the username", () => {
    process.env.TURN_SHARED_SECRET = "s";
    const out = generateTurnCredentials("ap k:abc/123$%", "p ee r/!@");
    // Username must not contain colons except the two structural ones
    // separating expiry / k= / p=, nor any chars that'd confuse the parser.
    expect(out.username.split(":").length).toBe(3);
    expect(out.username).toMatch(/^\d+:k=[A-Za-z0-9_.-]+:p=[A-Za-z0-9_.-]+$/);
  });

  it("ice_servers contains STUN + TURN udp + TURN tcp, no TURNS", () => {
    process.env.TURN_SHARED_SECRET = "s";
    process.env.TURN_HOST = "turn.example.com";
    const out = generateTurnCredentials("k", "p");
    const flat = out.ice_servers.flatMap((s) =>
      Array.isArray(s.urls) ? s.urls : [s.urls],
    );
    expect(flat).toEqual(
      expect.arrayContaining([
        "stun:turn.example.com:3478",
        "turn:turn.example.com:3478?transport=udp",
        "turn:turn.example.com:3478?transport=tcp",
      ]),
    );
    expect(flat.some((u) => u.startsWith("turns:"))).toBe(false);
  });

  it("attaches username + credential only to the TURN entry, not STUN", () => {
    process.env.TURN_SHARED_SECRET = "s";
    const out = generateTurnCredentials("k", "p");
    const stun = out.ice_servers.find((s) => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls.every((u) => u.startsWith("stun:"));
    });
    const turn = out.ice_servers.find((s) => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls.some((u) => u.startsWith("turn:"));
    });
    expect(stun?.username).toBeUndefined();
    expect(stun?.credential).toBeUndefined();
    expect(turn?.username).toBe(out.username);
    expect(turn?.credential).toBe(out.credential);
  });

  it("falls back to STUN-only when TURN_SHARED_SECRET is missing", () => {
    // (this is the user's local-dev graceful-degradation path)
    const out = generateTurnCredentials("k", "p");
    expect(out.username).toBe("");
    expect(out.credential).toBe("");
    expect(out.ice_servers).toHaveLength(1);
    expect(out.ice_servers[0]?.urls).toMatch(/^stun:/);
  });

  it("falls back to safe defaults when api key / peer tag are empty", () => {
    process.env.TURN_SHARED_SECRET = "s";
    const out = generateTurnCredentials("", "");
    expect(out.username).toMatch(/^\d+:k=anon:p=peer$/);
  });
});

import { describe, expect, it } from "vitest";
import { mintIce } from "../src/ice";
import { signKey, verifyKey } from "../src/keys";
import { newCode, normalizeCode } from "../src/protocol";

describe("publishable keys", () => {
  it("round-trips and rejects tampering", async () => {
    const k = await signKey("s3cret", "tankii", "abc123");
    expect(k).toMatch(/^pk_tankii_abc123_[A-Za-z0-9_-]{22}$/);
    expect(await verifyKey("s3cret", k)).toEqual({ project: "tankii", keyId: "abc123" });
    expect(await verifyKey("other", k)).toBeNull();
    expect(await verifyKey("s3cret", k.slice(0, -1) + (k.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(await verifyKey("s3cret", k.replace("abc123", "abc124"))).toBeNull();
    expect(await verifyKey("s3cret", 42)).toBeNull();
  });

  it("refuses ids outside [a-z0-9]", async () => {
    await expect(signKey("s", "Bad_Id", "k")).rejects.toThrow();
  });
});

describe("room codes", () => {
  it("are unambiguous capitals and normalize", () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^[A-HJ-NP-Z]{5}$/);
    expect(normalizeCode(" abcde ")).toBe("ABCDE");
    expect(normalizeCode("AB1DE")).toBeNull();
    expect(normalizeCode(7)).toBeNull();
  });
});

describe("relay credentials", () => {
  const cfList = { iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" }] };
  const fakeFetch = (body: unknown, ok = true) => (async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 })) as unknown as typeof fetch;

  it("cloudflare: passes the full list through", async () => {
    const g = await mintIce({ TURN_MODE: "cloudflare", CF_TURN_KEY_ID: "k", CF_TURN_API_TOKEN: "t" }, 0, fakeFetch(cfList));
    expect(g.relay).toBe("turn");
    expect(g.ice_servers[0].urls).toContain("turns:turn.cloudflare.com:443?transport=tcp");
  });

  it("cloudflare: no TLS-443 entry, an error or a failure falls back to ws, never STUN-only", async () => {
    const stunOnly = { iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }] };
    for (const f of [fakeFetch(stunOnly), fakeFetch({}, false), (async () => { throw new Error("down"); }) as unknown as typeof fetch]) {
      const g = await mintIce({ TURN_MODE: "cloudflare", CF_TURN_KEY_ID: "k", CF_TURN_API_TOKEN: "t" }, 0, f);
      expect(g).toMatchObject({ relay: "ws", ice_servers: [] });
    }
  });

  it("static and none", async () => {
    const s = await mintIce({ TURN_MODE: "static", TURN_STATIC_URLS: "turn:coturn:3478, turns:coturn:443", TURN_STATIC_USERNAME: "u", TURN_STATIC_CREDENTIAL: "p" });
    expect(s).toMatchObject({ relay: "turn", ice_servers: [{ urls: ["turn:coturn:3478", "turns:coturn:443"], username: "u", credential: "p" }] });
    expect(await mintIce({})).toMatchObject({ relay: "ws", ice_servers: [] });
  });
});

describe("production safety", () => {
  it("never returns an email sign-in code without a mail provider", async () => {
    const { env } = await import("cloudflare:test");
    const { playerHandlers } = await import("../src/api/players");
    const start = (e: Record<string, unknown>) => (playerHandlers.playersEmailStart as any)({ env: { ...env, ...e }, body: { email: "a@b.co" } });
    expect((await start({ PARTII_ENV: "staging" })).code).toMatch(/^\d{6}$/);
    await expect(start({ PARTII_ENV: "production" })).rejects.toMatchObject({ code: "email_unavailable" });
  });
});

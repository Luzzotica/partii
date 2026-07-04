import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type JWK } from "jose";
import { createSign } from "node:crypto";
import { verifySiwa, __resetAppleJwks } from "@/lib/api/identity/siwa";
import { verifyGoogle, __resetGoogleJwks } from "@/lib/api/identity/google";
import { verifyGameCenter } from "@/lib/api/identity/gamecenter";
import { verifyDiscord } from "@/lib/api/identity/discord";

// Self-signed JWKS: sign test JWTs with our own RSA key and serve its public
// JWK through a mocked fetch — exercises the REAL jose verification path.

const fetchMock = vi.fn();

let privateKey: CryptoKey;
let publicJwk: JWK;

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  __resetAppleJwks();
  __resetGoogleJwks();
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey as CryptoKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  // JWKS endpoint responses (jose fetches via global fetch).
  fetchMock.mockImplementation(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("appleid.apple.com/auth/keys") || u.includes("googleapis.com/oauth2/v3/certs")) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function signToken(claims: Record<string, unknown>, iss: string, aud: string): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime("1h")
    .setSubject(String(claims.sub ?? "subject-1"))
    .sign(privateKey);
}

describe("Sign in with Apple", () => {
  it("accepts a valid token and returns sub", async () => {
    const token = await signToken({ sub: "apple-user-9" }, "https://appleid.apple.com", "com.example.game");
    const res = await verifySiwa(token, "com.example.game");
    expect(res).toEqual({ ok: true, subject: "apple-user-9" });
  });

  it("rejects wrong audience / wrong issuer / unconfigured", async () => {
    const wrongAud = await signToken({ sub: "x" }, "https://appleid.apple.com", "com.other.app");
    expect((await verifySiwa(wrongAud, "com.example.game")).ok).toBe(false);
    const wrongIss = await signToken({ sub: "x" }, "https://evil.example", "com.example.game");
    expect((await verifySiwa(wrongIss, "com.example.game")).ok).toBe(false);
    expect((await verifySiwa("anything", null)).ok).toBe(false);
  });
});

describe("Google sign-in", () => {
  it("accepts a valid token with name", async () => {
    const token = await signToken({ sub: "g-123", name: "Dave" }, "https://accounts.google.com", "client-1.apps");
    const res = await verifyGoogle(token, "client-1.apps");
    expect(res).toEqual({ ok: true, subject: "g-123", displayName: "Dave" });
  });

  it("rejects expired tokens", async () => {
    const token = await new SignJWT({ sub: "g-123" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://accounts.google.com")
      .setAudience("client-1.apps")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);
    expect((await verifyGoogle(token, "client-1.apps")).ok).toBe(false);
  });
});

describe("Game Center", () => {
  // Fixture: self-signed cert + its key (tests/fixtures, generated via openssl).
  // Signing the proof with the fixture key and serving the fixture cert from a
  // mocked Apple URL exercises the FULL verify path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const certDer: Buffer = fs.readFileSync(new URL("./fixtures/gc-test-cert.der", import.meta.url));
  const gcKey = fs.readFileSync(new URL("./fixtures/gc-test-key.pem", import.meta.url), "utf8");

  function gcProof(overrides: Partial<Record<string, unknown>> = {}) {
    const playerId = "T:_1234567890";
    const bundleId = "com.example.game";
    const timestamp = Date.now();
    const salt = Buffer.from("somesalt");
    const ts = Buffer.alloc(8);
    ts.writeBigUInt64BE(BigInt(timestamp));
    const payload = Buffer.concat([Buffer.from(playerId), Buffer.from(bundleId), ts, salt]);
    const signer = createSign("RSA-SHA256");
    signer.update(payload);
    const signature = signer.sign(gcKey);
    return {
      public_key_url: "https://static.gc.apple.com/public-key/gc-prod-test.cer",
      signature: signature.toString("base64"),
      salt: salt.toString("base64"),
      timestamp,
      player_id: playerId,
      ...overrides,
    };
  }

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("static.gc.apple.com")) {
        return new Response(new Uint8Array(certDer), { status: 200 });
      }
      return new Response("nf", { status: 404 });
    });
  });

  it("rejects non-Apple public key hosts", async () => {
    const res = await verifyGameCenter(gcProof({ public_key_url: "https://evil.example/key.cer" }) as never, "com.example.game");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("not an Apple");
  });

  it("rejects http (non-TLS) URLs even on Apple hosts", async () => {
    const res = await verifyGameCenter(gcProof({ public_key_url: "http://static.gc.apple.com/k.cer" }) as never, "com.example.game");
    expect(res.ok).toBe(false);
  });

  it("rejects stale timestamps", async () => {
    const res = await verifyGameCenter(gcProof({ timestamp: Date.now() - 10 * 60 * 1000 }) as never, "com.example.game");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("stale");
  });

  it("rejects when unconfigured", async () => {
    const res = await verifyGameCenter(gcProof() as never, null);
    expect(res.ok).toBe(false);
  });

  it("accepts a valid signature (fixture cert)", async () => {
    const res = await verifyGameCenter(gcProof() as never, "com.example.game");
    if (!res.ok) throw new Error(`expected ok, got: ${res.reason}`);
    expect(res.subject).toBe("T:_1234567890");
  });

  it("rejects a signature over the WRONG bundle id", async () => {
    const res = await verifyGameCenter(gcProof() as never, "com.wrong.bundle");
    expect(res.ok).toBe(false);
  });
});

describe("Discord", () => {
  it("exchanges the code and returns the snowflake", async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("discord.com/api/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "at-1" }), { status: 200 });
      }
      if (u.includes("discord.com/api/users/@me")) {
        return new Response(JSON.stringify({ id: "111222333", username: "dave", global_name: "Dave" }), { status: 200 });
      }
      return new Response("nf", { status: 404 });
    });
    const res = await verifyDiscord("code-1", "https://game.example/cb", "client-1", "secret-1");
    expect(res).toEqual({ ok: true, subject: "111222333", displayName: "Dave" });
  });

  it("propagates a failed code exchange", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const res = await verifyDiscord("bad", "https://game.example/cb", "client-1", "secret-1");
    expect(res.ok).toBe(false);
  });

  it("rejects when unconfigured", async () => {
    const res = await verifyDiscord("code", "uri", null, null);
    expect(res.ok).toBe(false);
  });
});

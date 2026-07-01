import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Session tokens (short-lived JWT)
//
// The raw API key (`mpk_live_…`) ships inside every game build, so it cannot be
// kept secret. Instead of trusting the key directly on every signalling call,
// the client exchanges it ONCE at /api/auth/token — proving itself via origin
// allowlist + platform attestation — for a short-lived signed token, then sends
// that token on all signalling + TURN requests.
//
// A leaked API key is therefore low-value: without a valid attestation from one
// of our properties you can't mint a session token, and a leaked session token
// expires in minutes.
//
// Compact HS256 JWT, hand-rolled on node:crypto (no dependency). Signed with
// SESSION_TOKEN_SECRET. If that env var is unset we fail CLOSED in production
// (cannot mint) but allow a dev fallback secret locally.
// ─────────────────────────────────────────────────────────────────────────────

export type SessionTokenClaims = {
  /** project_id — the security principal for quotas + origin rules. */
  pid: string;
  /** api_keys.id — kept for TURN billing attribution + revocation checks. */
  kid: string;
  /** Platform that attested: 'web' | 'steam' | 'dev' | 'mobile'. */
  plat: string;
  /** issued-at / expiry, unix seconds. */
  iat: number;
  exp: number;
  /** unique token id (for future denylist / logging). */
  jti: string;
};

export type SessionContext = { projectId: string; apiKeyId: string; platform: string };

// 10 min — long enough to start a match and survive a reconnect, short enough
// that a leaked token is near-worthless. Clients refresh before expiry.
export const SESSION_TTL_SECONDS = 10 * 60;

function signingSecret(): string {
  const secret = process.env.SESSION_TOKEN_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_TOKEN_SECRET is required in production");
  }
  // Dev-only fallback so local signalling works without extra setup.
  return "dev-insecure-session-secret-do-not-use-in-prod";
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(data: string): string {
  return createHmac("sha256", signingSecret()).update(data).digest("base64url");
}

/** Mint a signed session token for a verified caller. */
export function mintSessionToken(
  ctx: SessionContext,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): { token: string; expiresIn: number; claims: SessionTokenClaims } {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.min(ttlSeconds, 60 * 60));
  const claims: SessionTokenClaims = {
    pid: ctx.projectId,
    kid: ctx.apiKeyId,
    plat: ctx.platform,
    iat: now,
    exp: now + ttl,
    jti: randomUUID(),
  };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signature = hmac(`${header}.${payload}`);
  return { token: `${header}.${payload}.${signature}`, expiresIn: ttl, claims };
}

/**
 * Verify a session token. Returns the claims on success, or null if the token
 * is malformed, tampered, signed with the wrong secret, or expired.
 */
export function verifySessionToken(token: string): SessionTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;

  const expected = hmac(`${header}.${payload}`);
  // Constant-time compare; bail if lengths differ (timingSafeEqual throws).
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let claims: SessionTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!claims.pid || !claims.kid || typeof claims.exp !== "number") return null;
  if (Math.floor(Date.now() / 1000) >= claims.exp) return null;
  return claims;
}

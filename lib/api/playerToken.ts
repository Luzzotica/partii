import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Player tokens
//
// The credential a game holds for a signed-in PLAYER (master player account —
// see supabase players/player_identities). Minted by /api/players/login after
// provider-proof verification; authorizes player-scoped surfaces (player
// content, link/unlink, /players/me) and doubles as attestation for the
// session-token exchange (platform: 'player').
//
// Same hand-rolled HS256 + secret family as lib/api/token.ts, discriminated by
// t:'player' — structurally un-confusable with session tokens (which require
// pid+kid project claims) and room tokens (t:'room').
// ─────────────────────────────────────────────────────────────────────────────

export type PlayerTokenClaims = {
  t: "player";
  /** players.id */
  pid: string;
  /** projects.id the player belongs to. */
  proj: string;
  iat: number;
  exp: number;
  jti: string;
};

/** 24h — long enough for a play session + resume; bans take effect on the
 *  next DB-touching action regardless. Clients re-login silently on expiry. */
export const PLAYER_TOKEN_TTL_SECONDS = 24 * 60 * 60;

function signingSecret(): string {
  const secret = process.env.SESSION_TOKEN_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_TOKEN_SECRET is required in production");
  }
  return "dev-insecure-session-secret-do-not-use-in-prod";
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");
const hmac = (data: string): string =>
  createHmac("sha256", signingSecret()).update(data).digest("base64url");

export function mintPlayerToken(
  playerId: string,
  projectId: string,
  ttlSeconds: number = PLAYER_TOKEN_TTL_SECONDS,
): { token: string; expiresIn: number } {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.min(ttlSeconds, 30 * 24 * 60 * 60));
  const claims: PlayerTokenClaims = {
    t: "player",
    pid: playerId,
    proj: projectId,
    iat: now,
    exp: now + ttl,
    jti: randomUUID(),
  };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  return { token: `${header}.${payload}.${hmac(`${header}.${payload}`)}`, expiresIn: ttl };
}

/** Verify a player token; null on tamper/expiry/wrong kind. */
export function verifyPlayerToken(token: string): PlayerTokenClaims | null {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const a = Buffer.from(signature);
  const b = Buffer.from(hmac(`${header}.${payload}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims: PlayerTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims.t !== "player" || !claims.pid || !claims.proj) return null;
  if (typeof claims.exp !== "number" || Math.floor(Date.now() / 1000) >= claims.exp) return null;
  return claims;
}

import { createHmac, timingSafeEqual } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Room tokens
//
// A per-room, per-peer scoped credential returned by room create/join. It is
// what the realtime signaling gateway (and any future room-scoped surface)
// authorizes with: possession proves "peer X in room Y with role Z" and
// NOTHING else — no project, no API key, no other rooms. Short-lived (bounded
// by the room's own lifetime) and signed with the same HS256 secret as session
// tokens, distinguished by the `t: "room"` claim so the two can never be
// confused for one another.
// ─────────────────────────────────────────────────────────────────────────────

export type RoomTokenClaims = {
  /** discriminator — always "room". */
  t: "room";
  /** room id. */
  rid: string;
  /** peer id inside the room (the literal "host" for the host). */
  peer: string;
  role: "host" | "peer";
  iat: number;
  exp: number;
};

/** Cap even long-lived rooms' tokens at 6h; clients re-join to refresh. */
const MAX_ROOM_TOKEN_TTL_S = 6 * 60 * 60;

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

export function mintRoomToken(
  roomId: string,
  peerId: string,
  role: "host" | "peer",
  roomExpiresAt?: string | null,
): string {
  const now = Math.floor(Date.now() / 1000);
  const roomExp = roomExpiresAt ? Math.floor(new Date(roomExpiresAt).getTime() / 1000) : 0;
  const exp = Math.min(
    now + MAX_ROOM_TOKEN_TTL_S,
    roomExp > now ? roomExp : now + MAX_ROOM_TOKEN_TTL_S,
  );
  const claims: RoomTokenClaims = { t: "room", rid: roomId, peer: peerId, role, iat: now, exp };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  return `${header}.${payload}.${hmac(`${header}.${payload}`)}`;
}

/** Verify a room token; null on tamper/expiry/wrong-kind. */
export function verifyRoomToken(token: string): RoomTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const a = Buffer.from(signature);
  const b = Buffer.from(hmac(`${header}.${payload}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims: RoomTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims.t !== "room" || !claims.rid || !claims.peer) return null;
  if (typeof claims.exp !== "number" || Math.floor(Date.now() / 1000) >= claims.exp) return null;
  return claims;
}

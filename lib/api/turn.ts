import { createHmac } from "node:crypto";

// Canonical coturn REST API auth recipe (RFC-style ephemeral creds).
//
//   username   = `${unixExpiry}:k=${apiKeyId}:p=${peerTag}`
//   credential = base64( HMAC-SHA1(username, static-auth-secret) )
//
// coturn validates the HMAC at allocation time using TURN_SHARED_SECRET; it
// knows nothing about API keys. The API key ID is embedded in the username
// purely so coturn's allocation logs attribute bandwidth to a customer for
// billing — `grep "username=k=apk_abc123"` over coturn logs gives you all
// TURN sessions started by that API key.
//
// Revocation: revoke the API key in Next.js — `requireApiKey` will then
// refuse to mint new creds. Existing creds remain valid until their TTL
// expires (default 10 min), and existing TURN allocations keep relaying for
// their normal coturn lifetime. If you ever need instant kill-switching,
// switch coturn to a Postgres-backed userdb; not worth it day-one.

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type TurnCredentials = {
  username: string;
  credential: string;
  ttl_seconds: number;
  ice_servers: IceServer[];
};

// 10 min — long enough to gather ICE + establish, short enough that a leaked
// cred can't be re-used for sustained free TURN bandwidth.
const DEFAULT_TTL_SECONDS = 10 * 60;

function turnHost(): string {
  return process.env.TURN_HOST ?? "arcade-turn.fly.dev";
}

function iceServers(username: string, credential: string): IceServer[] {
  const host = turnHost();
  return [
    { urls: `stun:${host}:3478` },
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: [
        `turn:${host}:3478?transport=udp`,
        `turn:${host}:3478?transport=tcp`,
      ],
      username,
      credential,
    },
  ];
}

function sanitize(s: string, max: number): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, max);
}

/**
 * Mint short-lived TURN credentials tagged with the requesting API key.
 *
 * @param apiKeyId  The api_keys.id of the caller (used for billing attribution
 *                  in coturn logs; NOT validated by coturn).
 * @param peerTag   Free-form identifier — usually the peer_id. Logged but not
 *                  validated.
 * @param ttlSeconds Cred TTL. Clamped to [60, 86400]. Default 600.
 */
export function generateTurnCredentials(
  apiKeyId: string,
  peerTag: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): TurnCredentials {
  const secret = process.env.TURN_SHARED_SECRET;
  const ttl = Math.max(60, Math.min(ttlSeconds, 24 * 60 * 60));
  // Without a shared secret we can't mint authenticated TURN creds; degrade
  // gracefully to a STUN-only ice_servers list so the room create still
  // succeeds. Peers behind symmetric NATs will fail to connect (the same
  // behaviour as before TURN was added), but local-network and most home
  // setups continue to work. Production must set TURN_SHARED_SECRET.
  if (!secret) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        "[turn] TURN_SHARED_SECRET not set — returning STUN-only ice_servers. " +
          "Set TURN_SHARED_SECRET (and TURN_HOST) in your Hexii env to enable relay.",
      );
    }
    return {
      username: "",
      credential: "",
      ttl_seconds: ttl,
      ice_servers: [{ urls: "stun:stun.l.google.com:19302" }],
    };
  }
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const safeKey = sanitize(apiKeyId, 48) || "anon";
  const safePeer = sanitize(peerTag, 48) || "peer";
  const username = `${expiry}:k=${safeKey}:p=${safePeer}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return {
    username,
    credential,
    ttl_seconds: ttl,
    ice_servers: iceServers(username, credential),
  };
}

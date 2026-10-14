// Game Center sign-in (provider "gamecenter"). The game asks GameKit for an
// identity signature (GKLocalPlayer.fetchItemsForIdentityVerificationSignature)
// and sends it here. We check that:
//   * public_key_url is https on an apple.com host; the certificate there is
//     Apple Inc.'s, in date, and signed by the DigiCert code-signing CA we pin
//     (so neither the URL nor the cert alone is trusted);
//   * the signature (RSA PKCS#1 v1.5, SHA-256) covers
//     team_player_id || bundle_id || timestamp (u64, big-endian) || salt;
//   * the timestamp is within 5 minutes, and bundle_id is one of our apps
//     (APPLE_CLIENT_IDS, the same list Sign in with Apple uses).
// The subject is the team-scoped player id, the same on every device signed
// in to that Game Center account.

import type { Env } from "../index";
import { ApiError, bad, fromB64url, now } from "./core";

/** DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1 (valid to 2036): it signs Apple's gc-prod-*.cer. */
const DIGICERT_CS_SPKI = "MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA1bQvQtAorXi3XdU5WRuxiEL1M4zrPYGXcMW7xIUmMJ+kjmjYXPXrNCQH4UtP03hD9BfXHtr50tVnGlJPDqFX/IiZwZHMgQM+TXAkZLON4gh9NH1MgFcSa0OamfLFOx/y78tHWhOmTLMBICXzENOLsvsI8IrgnQnAZaf6mIBJNYc9URnokCF4RS6hnyzhGMIazMXuk0lwQjKP+8bqHPNlaJGiTUyCEUhSaN4QvRRXXegYE2XFf7JPhSxIpFaENdb5LpyqABXRN/4aBpTCfMjqGzLmysL0p6MDDnSlrzm2q2AS4+jWufcx4dyt5Big2MEjR0ezoQ9uo6ttmAaDG7dqZy3SvUQakhCBj7A7CdfHmzJawv9qYFSLScGT7eG0XOBv6yb5jNWy+TgQ5urOkfW+0/tvk2E0XLyTRSiDNipmKF+wc86LJiUGsoPUXPYVGUztYuBeM/Lo6OwKp7ADK5GyNnm+960IHnWmZcy740hQ83eRGv7bUKJGyGFYmPV8AhY8gyitOYbs1LcNU9D4R+Z1MI3sMJN2FKZbS110YU0/EpF23r9Yy3IQKUHw1cVtJnZoEUETWJrcJisB9IlNWdt4z4FKPkBHX8mBUHOFECMhWWCKZFTBzCEa6DgZfGYczXg4RTCZT/9jT0y7qg0IU0F8WD1Hs/q27IwyCQLMbDwMVhECAwEAAQ==";
const MAX_SKEW_MS = 5 * 60_000;

// ── A small DER reader: enough for an X.509 certificate's outer structure ──

interface Node {
  tag: number;
  /** The whole element, header included. */
  start: number;
  /** Where its contents begin and end. */
  body: number;
  end: number;
}

function node(b: Uint8Array, at: number): Node {
  const tag = b[at];
  let len = b[at + 1];
  let body = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 4) throw new Error("bad DER length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[at + 2 + i];
    body += n;
  }
  if (body + len > b.length) throw new Error("DER runs past the end");
  return { tag, start: at, body, end: body + len };
}

function children(b: Uint8Array, parent: Node): Node[] {
  const out: Node[] = [];
  for (let at = parent.body; at < parent.end; ) {
    const n = node(b, at);
    out.push(n);
    at = n.end;
  }
  return out;
}

function derTime(b: Uint8Array, n: Node): number {
  const s = new TextDecoder().decode(b.subarray(n.body, n.end));
  const m = n.tag === 0x17 ? /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/.exec(s) : /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/.exec(s);
  if (!m) throw new Error("bad certificate time");
  let y = Number(m[1]);
  if (n.tag === 0x17) y += y < 50 ? 2000 : 1900;
  return Date.UTC(y, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

export interface Cert {
  tbs: Uint8Array;
  signature: Uint8Array;
  spki: Uint8Array;
  notBefore: number;
  notAfter: number;
  subject: string;
}

export function parseCert(der: Uint8Array): Cert {
  const cert = node(der, 0);
  const [tbsN, , sigN] = children(der, cert);
  let f = children(der, tbsN);
  if (f[0].tag === 0xa0) f = f.slice(1); // explicit version
  const [, , , validity, subject, spki] = f;
  const [nb, na] = children(der, validity);
  return {
    tbs: der.subarray(tbsN.start, tbsN.end),
    signature: der.subarray(sigN.body + 1, sigN.end), // BIT STRING: skip the unused-bits byte
    spki: der.subarray(spki.start, spki.end),
    notBefore: derTime(der, nb),
    notAfter: derTime(der, na),
    subject: new TextDecoder("latin1").decode(der.subarray(subject.body, subject.end)),
  };
}

const rsa = (spki: Uint8Array) => crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);

/** Apple's Game Center certificate is genuine: in date, Apple's, and signed by the pinned CA. */
export async function checkAppleCert(cert: Cert, at = now()): Promise<void> {
  if (at < cert.notBefore || at > cert.notAfter) throw new ApiError(401, "bad_signature", "Game Center's certificate is out of date", "update the game; sign in again");
  if (!cert.subject.includes("Apple Inc.")) throw new ApiError(401, "bad_signature", "that certificate isn't Apple's");
  const ca = await rsa(fromB64std(DIGICERT_CS_SPKI));
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", ca, cert.signature, cert.tbs))) throw new ApiError(401, "bad_signature", "that certificate isn't signed by Apple's certificate authority");
}

function fromB64std(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

const b64any = (s: string) => (/[-_]/.test(s) ? fromB64url(s) : fromB64std(s));

const certCache = new Map<string, { at: number; cert: Cert }>();

async function appleCert(url: string, fetcher: typeof fetch): Promise<Cert> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw bad("public_key_url is not a URL");
  }
  if (u.protocol !== "https:" || !(u.hostname === "apple.com" || u.hostname.endsWith(".apple.com")) || u.port || u.username || u.password) {
    throw new ApiError(401, "bad_signature", "public_key_url must be https on apple.com");
  }
  const hit = certCache.get(url);
  if (hit && now() - hit.at < 24 * 3600_000) return hit.cert;
  const res = await fetcher(url);
  if (!res.ok) throw new ApiError(502, "provider_down", "couldn't fetch Game Center's certificate", "try again shortly");
  const cert = parseCert(new Uint8Array(await res.arrayBuffer()));
  await checkAppleCert(cert);
  certCache.set(url, { at: now(), cert });
  return cert;
}

/** The bytes Game Center signs. */
export function gameCenterPayload(teamPlayerId: string, bundleId: string, timestamp: bigint, salt: Uint8Array): Uint8Array {
  const a = new TextEncoder().encode(teamPlayerId);
  const b = new TextEncoder().encode(bundleId);
  const out = new Uint8Array(a.length + b.length + 8 + salt.length);
  out.set(a, 0);
  out.set(b, a.length);
  new DataView(out.buffer).setBigUint64(a.length + b.length, timestamp, false);
  out.set(salt, a.length + b.length + 8);
  return out;
}

/** The team player id, once the signature checks out. */
export async function verifyGameCenter(env: Env, body: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<string> {
  const teamPlayerId = String(body.team_player_id ?? "");
  const bundleId = String(body.bundle_id ?? "");
  if (!/^[A-Za-z0-9:._-]{1,80}$/.test(teamPlayerId)) throw bad("team_player_id is required (GKLocalPlayer.teamPlayerID)");
  // Staging and dev: a test login, so clients can be built without a device.
  if (body.test === true) {
    if (env.ALLOW_FAKE_LOGIN !== "1") throw bad("test Game Center logins only exist in dev and staging");
    return teamPlayerId;
  }
  const apps = (env.APPLE_CLIENT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apps.length) throw new ApiError(400, "provider_not_configured", "Game Center sign-in is not configured on this platform", "set APPLE_CLIENT_IDS (the apps' bundle ids) on the edge");
  if (!apps.includes(bundleId)) throw new ApiError(401, "bad_signature", `bundle_id ${bundleId} isn't one of this platform's apps`, "add it to APPLE_CLIENT_IDS");
  const ts = Number(body.timestamp);
  if (!Number.isSafeInteger(ts) || Math.abs(now() - ts) > MAX_SKEW_MS) throw new ApiError(401, "bad_signature", "the Game Center signature is stale", "fetch a fresh signature and sign in again");
  let sig: Uint8Array, salt: Uint8Array;
  try {
    sig = b64any(String(body.signature ?? ""));
    salt = b64any(String(body.salt ?? ""));
  } catch {
    throw bad("signature and salt must be base64");
  }
  const cert = await appleCert(String(body.public_key_url ?? ""), fetcher);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", await rsa(cert.spki), sig, gameCenterPayload(teamPlayerId, bundleId, BigInt(ts), salt));
  if (!ok) throw new ApiError(401, "bad_signature", "the Game Center signature doesn't verify");
  return teamPlayerId;
}

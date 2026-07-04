import { X509Certificate, verify as cryptoVerify } from "node:crypto";
import type { ProviderResult, ProviderProof } from "./index";

// ─────────────────────────────────────────────────────────────────────────────
// Apple Game Center identity verification.
//
// Client calls GKLocalPlayer.fetchItems(forIdentityVerificationSignature:) and
// sends { publicKeyURL, signature, salt, timestamp, teamPlayerID }. We:
//   1. Pin the key URL to Apple's Game Center hosts over HTTPS — skipping this
//      is the classic forged-login vulnerability.
//   2. Fetch + cache the X.509 cert, check its validity window. (Host pinning
//      + validity is the accepted industry pattern; full chain-to-root
//      validation is optional hardening.)
//   3. Verify RSASSA-PKCS1-v1_5/SHA-256 over
//      playerID ‖ bundleID ‖ timestamp(BE u64) ‖ salt.
//   4. Reject stale timestamps (GC has no nonce; the window bounds replay).
//
// BYO config: the project's apple_bundle_id (it's inside the signed buffer).
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_HOSTS = new Set(["static.gc.apple.com", "sandbox.gc.apple.com"]);
const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;
const CERT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const certCache = new Map<string, { cert: X509Certificate; at: number }>();

async function fetchCert(url: string): Promise<X509Certificate | null> {
  const cached = certCache.get(url);
  if (cached && Date.now() - cached.at < CERT_CACHE_TTL_MS) return cached.cert;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const der = Buffer.from(await res.arrayBuffer());
    const cert = new X509Certificate(der);
    certCache.set(url, { cert, at: Date.now() });
    return cert;
  } catch {
    return null;
  }
}

export async function verifyGameCenter(
  proof: ProviderProof,
  bundleId: string | null | undefined,
): Promise<ProviderResult> {
  if (!bundleId) {
    return { ok: false, reason: "Game Center not configured for this project (apple_bundle_id)" };
  }
  const { public_key_url: keyUrl, signature, salt, timestamp, player_id: playerId } = proof;
  if (!keyUrl || !signature || !salt || !timestamp || !playerId) {
    return { ok: false, reason: "gamecenter proof requires public_key_url, signature, salt, timestamp, player_id" };
  }

  let url: URL;
  try {
    url = new URL(keyUrl);
  } catch {
    return { ok: false, reason: "invalid public_key_url" };
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    return { ok: false, reason: "public_key_url is not an Apple Game Center host" };
  }

  if (Math.abs(Date.now() - Number(timestamp)) > TIMESTAMP_WINDOW_MS) {
    return { ok: false, reason: "stale Game Center signature (timestamp outside window)" };
  }

  const cert = await fetchCert(url.href);
  if (!cert) return { ok: false, reason: "failed to fetch Apple public key certificate" };
  const now = Date.now();
  if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) {
    certCache.delete(url.href);
    return { ok: false, reason: "Apple public key certificate expired" };
  }

  const tsBuf = Buffer.alloc(8);
  tsBuf.writeBigUInt64BE(BigInt(timestamp));
  const payload = Buffer.concat([
    Buffer.from(playerId, "utf8"),
    Buffer.from(bundleId, "utf8"),
    tsBuf,
    Buffer.from(salt, "base64"),
  ]);

  let valid = false;
  try {
    valid = cryptoVerify("RSA-SHA256", payload, cert.publicKey, Buffer.from(signature, "base64"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "Game Center signature verification failed" };

  return { ok: true, subject: playerId };
}

import { createHash, randomBytes, pbkdf2Sync, timingSafeEqual } from "node:crypto";

// PBKDF2 for passwords (developer accounts + lobby passwords).
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256";

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(plain, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `${salt.toString("base64")}:${derived.toString("base64")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [saltB64, hashB64] = stored.split(":");
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const derived = pbkdf2Sync(plain, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// SHA-256 for API key lookup. The full secret is shown once; we only store the hash.
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// Generate a new API key. Returns the full secret + hash + display prefix.
export function generateApiKey(): { secret: string; hash: string; prefix: string } {
  const raw = randomBytes(24).toString("base64url");
  const secret = `mpk_live_${raw}`;
  return {
    secret,
    hash: sha256Hex(secret),
    prefix: secret.slice(0, 16),
  };
}

// Generate a session token for the developer dashboard. Returns secret + hash.
export function generateSessionToken(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: sha256Hex(secret) };
}

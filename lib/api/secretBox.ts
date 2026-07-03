import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// secretBox — application-layer encryption for customer-supplied secrets
// (BYO Turnstile secrets, Steam publisher keys) stored in Postgres.
//
// AES-256-GCM with a single platform key from SECRETS_ENC_KEY (64 hex chars =
// 32 bytes; generate with `openssl rand -hex 32`). Wire format:
//   v1:base64url(iv[12] | authTag[16] | ciphertext)
// The version prefix leaves room for key rotation (v2 with a new key while v1
// still decrypts) without a data migration.
//
// Fails CLOSED in production when the key is missing — storing a customer
// secret in plaintext is never acceptable. Dev fallback key keeps local work
// friction-free.
// ─────────────────────────────────────────────────────────────────────────────

function encKey(): Buffer {
  const hex = process.env.SECRETS_ENC_KEY;
  if (hex) {
    const buf = Buffer.from(hex, "hex");
    if (buf.length !== 32) throw new Error("SECRETS_ENC_KEY must be 64 hex chars (32 bytes)");
    return buf;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("SECRETS_ENC_KEY is required in production");
  }
  return Buffer.from("dev-insecure-secretbox-key-32by!"); // 32 bytes, dev only
}

/** Encrypt a secret for at-rest storage. */
export function sealSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, ct]).toString("base64url")}`;
}

/** Decrypt a stored secret. Returns null on tamper, wrong key, or bad format —
 *  callers treat that as "no credential configured" and fall back safely. */
export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed || !sealed.startsWith("v1:")) return null;
  try {
    const raw = Buffer.from(sealed.slice(3), "base64url");
    if (raw.length < 12 + 16 + 1) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", encKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

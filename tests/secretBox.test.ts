import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sealSecret, openSecret } from "@/lib/api/secretBox";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

describe("secretBox", () => {
  const orig = process.env.SECRETS_ENC_KEY;
  beforeEach(() => {
    process.env.SECRETS_ENC_KEY = KEY_A;
  });
  afterEach(() => {
    process.env.SECRETS_ENC_KEY = orig;
  });

  it("round-trips a secret", () => {
    const sealed = sealSecret("0x4AAA-super-secret");
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("super-secret");
    expect(openSecret(sealed)).toBe("0x4AAA-super-secret");
  });

  it("produces distinct ciphertexts per call (random IV)", () => {
    expect(sealSecret("same")).not.toBe(sealSecret("same"));
  });

  it("rejects tampered ciphertext", () => {
    const sealed = sealSecret("secret");
    const raw = Buffer.from(sealed.slice(3), "base64url");
    raw[raw.length - 1] ^= 0xff; // flip a ciphertext bit
    expect(openSecret(`v1:${raw.toString("base64url")}`)).toBeNull();
  });

  it("returns null under the wrong key", () => {
    const sealed = sealSecret("secret");
    process.env.SECRETS_ENC_KEY = KEY_B;
    expect(openSecret(sealed)).toBeNull();
  });

  it("returns null for garbage / null / legacy values", () => {
    expect(openSecret(null)).toBeNull();
    expect(openSecret("")).toBeNull();
    expect(openSecret("plaintext-oops")).toBeNull();
    expect(openSecret("v1:!!!!")).toBeNull();
  });
});

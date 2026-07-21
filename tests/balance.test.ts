import { describe, expect, it } from "vitest";
import { contentSha256, canonicalize, jsonByteLength } from "@/lib/games/balance/canonical";
import { validateBalanceDocument, parseChannel } from "@/lib/games/balance/validate";
import { DEFAULT_BALANCE, DEFAULT_BALANCE_SHA256 } from "@/lib/games/balance/defaults";
import seed from "@/lib/games/balance/balance-v1.default.json";

describe("balance canonical hash", () => {
  it("is stable regardless of key insertion order", () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(contentSha256(a)).toBe(contentSha256(b));
  });

  it("hashes the seed document deterministically", () => {
    expect(contentSha256(seed)).toBe(DEFAULT_BALANCE_SHA256);
    expect(DEFAULT_BALANCE_SHA256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("validateBalanceDocument", () => {
  it("accepts the ota-rnd seed defaults", () => {
    const r = validateBalanceDocument(DEFAULT_BALANCE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.id).toBe("2026-07-21.default");
  });

  it("rejects wrong schema", () => {
    const r = validateBalanceDocument({ ...DEFAULT_BALANCE, schema: "nope" });
    expect(r.ok).toBe(false);
  });

  it("rejects missing required section field", () => {
    const bad = structuredClone(DEFAULT_BALANCE) as Record<string, unknown>;
    const player = { ...(bad.player as object) } as Record<string, unknown>;
    delete player.speed;
    bad.player = player;
    const r = validateBalanceDocument(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("player.speed");
  });

  it("rejects unknown keys (additionalProperties false)", () => {
    const bad = { ...DEFAULT_BALANCE, extra: 1 };
    const r = validateBalanceDocument(bad);
    expect(r.ok).toBe(false);
  });

  it("rejects oversize body", () => {
    const fat = {
      ...DEFAULT_BALANCE,
      notes: "x".repeat(70_000),
    };
    expect(jsonByteLength(fat)).toBeGreaterThan(64 * 1024);
    const r = validateBalanceDocument(fat);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/65536|64\s*KiB|bytes/i);
  });

  it("rejects non-positive speeds", () => {
    const bad = structuredClone(DEFAULT_BALANCE);
    bad.player.speed = 0;
    const r = validateBalanceDocument(bad);
    expect(r.ok).toBe(false);
  });
});

describe("parseChannel", () => {
  it("defaults to stable", () => {
    expect(parseChannel(null)).toBe("stable");
    expect(parseChannel(undefined)).toBe("stable");
  });
  it("accepts known channels", () => {
    expect(parseChannel("beta")).toBe("beta");
    expect(parseChannel("DEV")).toBe("dev");
  });
  it("rejects junk", () => {
    expect(parseChannel("prod")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import { checkAppleCert, gameCenterPayload, parseCert, verifyGameCenter } from "../src/api/gamecenter";
import { GC_PROD_11, GC_PROD_12 } from "./fixtures/gamecenter-certs";

const der = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function api(method: string, path: string, o: { token?: string; key?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.key) headers["x-partii-key"] = o.key;
  const res = await SELF.fetch(`https://edge${path}`, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
}
let n = 0;
const uniq = () => `${Date.now().toString(36)}${n++}`;

describe("Game Center", () => {
  it("accepts Apple's real certificates through the pinned CA, and nothing tampered", async () => {
    const c12 = parseCert(der(GC_PROD_12));
    expect(c12.subject).toContain("Apple Inc.");
    expect(new Date(c12.notAfter).toISOString()).toBe("2027-05-27T23:59:59.000Z");
    await checkAppleCert(c12, Date.UTC(2026, 9, 14));
    await checkAppleCert(parseCert(der(GC_PROD_11)), Date.UTC(2025, 5, 1));
    // Out of date.
    await expect(checkAppleCert(c12, Date.UTC(2028, 0, 1))).rejects.toThrow(/out of date/);
    // One byte changed in what was signed.
    const bad = der(GC_PROD_12);
    const c = parseCert(bad);
    const at = bad.indexOf(c.spki[40], c.tbs.byteOffset + 200);
    bad[at] ^= 1;
    await expect(checkAppleCert(parseCert(bad), Date.UTC(2026, 9, 14))).rejects.toThrow(/signed/);
  });

  it("signs team_player_id, bundle_id, the big-endian timestamp and the salt", () => {
    const p = gameCenterPayload("T:1", "me.x", 0x0102030405060708n, new Uint8Array([9, 9]));
    expect([...p]).toEqual([84, 58, 49, 109, 101, 46, 120, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9]);
  });

  it("refuses other hosts, other apps, and stale signatures before fetching anything", async () => {
    const e = { ...env, APPLE_CLIENT_IDS: "me.sterlinglong.tankii", ALLOW_FAKE_LOGIN: "0" } as any;
    const base = { team_player_id: "T:_abc", bundle_id: "me.sterlinglong.tankii", timestamp: Date.now(), signature: "AAAA", salt: "AAAA", public_key_url: "https://static.gc.apple.com/public-key/gc-prod-12.cer" };
    const never = (() => {
      throw new Error("fetched");
    }) as unknown as typeof fetch;
    await expect(verifyGameCenter(e, { ...base, public_key_url: "https://evil.example/gc.cer" }, never)).rejects.toThrow(/apple.com/);
    await expect(verifyGameCenter(e, { ...base, public_key_url: "https://apple.com.evil.example/gc.cer" }, never)).rejects.toThrow(/apple.com/);
    await expect(verifyGameCenter(e, { ...base, public_key_url: "http://static.gc.apple.com/x.cer" }, never)).rejects.toThrow(/apple.com/);
    await expect(verifyGameCenter(e, { ...base, bundle_id: "com.other" }, never)).rejects.toThrow(/isn't one of/);
    await expect(verifyGameCenter(e, { ...base, timestamp: Date.now() - 10 * 60_000 }, never)).rejects.toThrow(/stale/);
    await expect(verifyGameCenter(e, { ...base, test: true }, never)).rejects.toThrow(/dev and staging/);
    // A real cert, but the signature isn't over this payload.
    const served = (async () => new Response(der(GC_PROD_12))) as unknown as typeof fetch;
    await expect(verifyGameCenter(e, base, served)).rejects.toThrow(/doesn't verify/);
  });

  it("test logins (staging): a guest links Game Center; a second device reaches the same player", async () => {
    const dev = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `gc${uniq()}@example.com` } })).json.token;
    const project = `p${uniq()}`;
    await api("PUT", `/v1/projects/${project}`, { token: dev, body: { name: "P" } });
    const key = (await api("POST", `/v1/projects/${project}/keys`, { token: dev, body: { key_id: "ios", name: "ios" } })).json.key.key;
    const id = `T:_${uniq()}`;
    const guest = (await api("POST", "/v1/players/guest", { key, body: { device_id: `dev-${uniq()}-xxxx` } })).json;
    const a = await api("POST", "/v1/players/login", { key, token: guest.player_token, body: { provider: "gamecenter", team_player_id: id, test: true, alias: "Ace" } });
    expect(a.json.ok, JSON.stringify(a.json)).toBe(true);
    expect(a.json.player.id).toBe(guest.player.id);
    expect(a.json.player.providers).toEqual(["device", "gamecenter"]);
    const other = (await api("POST", "/v1/players/guest", { key, body: { device_id: `dev-${uniq()}-yyyy` } })).json;
    const b = await api("POST", "/v1/players/login", { key, token: other.player_token, body: { provider: "gamecenter", team_player_id: id, test: true } });
    expect(b.json).toMatchObject({ merged: true, player: { id: guest.player.id } });
    // Sign in with Apple: a mangled token is refused plainly (it used to be a 500).
    const apple = await api("POST", "/v1/players/login", { key, body: { provider: "apple", identity_token: "x.y.z" } });
    expect([400, 401]).toContain(apple.status);
  });
});

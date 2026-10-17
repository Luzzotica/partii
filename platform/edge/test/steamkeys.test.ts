import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

type Opts = { token?: string; key?: string; body?: unknown; raw?: string; headers?: Record<string, string> };
async function api(method: string, path: string, o: Opts = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.key) headers["x-partii-key"] = o.key;
  if (o.body !== undefined || o.raw) headers["content-type"] = "application/json";
  const res = await SELF.fetch(`https://edge${path}`, { method, headers, body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) });
  return { status: res.status, json: (await res.json()) as any };
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${n++}`;
const keyOf = (i: number, tag: string) => `${tag.slice(-5).toUpperCase().padStart(5, "A")}-AAAA${i % 10}-BBBB${Math.floor(i / 10) % 10}`;

async function setup() {
  const dev = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `keys${uniq()}@example.com`, name: "Dev" } })).json.token as string;
  const project = `p${uniq()}`;
  await api("PUT", `/v1/projects/${project}`, { token: dev, body: { name: "Proj" } });
  const key = (await api("POST", `/v1/projects/${project}/keys`, { token: dev, body: { key_id: "web", name: "web" } })).json.key.key as string;
  const game = `g-${project}`;
  await api("PUT", `/v1/games/${game}`, { token: dev, body: { project, title: "Tankii", price_cents: 500, platforms: ["macos"] } });
  await api("POST", `/v1/games/${game}/publish`, { token: dev });
  return { dev, key, game, tag: project.replace(/[^a-z0-9]/g, "") };
}
const guest = async (key: string) => (await api("POST", "/v1/players/guest", { key, body: { device_id: `d-${uniq()}` } })).json as { player_token: string; player: { id: string } };
const buy = (key: string, token: string, game: string) => api("POST", `/v1/store/games/${game}/checkout`, { key, token, body: {} });

describe("steam keys", () => {
  it("a purchase gets the next key (in the library, with an activate link); one key per player; refunds and take-backs revoke", async () => {
    const s = await setup();
    const keys = [0, 1, 2, 3].map((i) => keyOf(i, s.tag));
    const add = await api("POST", `/v1/games/${s.game}/steam-keys`, { token: s.dev, body: { keys: `${keys.join("\n")}\n${keys[0].toLowerCase()}\nnot-a-key`, batch: "launch" } });
    expect(add.json).toMatchObject({ added: 4, already_loaded: 0, invalid: 1, available: 4 });
    expect((await api("POST", `/v1/games/${s.game}/steam-keys`, { token: s.dev, body: { keys: [keys[1]] } })).json).toMatchObject({ added: 0, already_loaded: 1 });

    const a = await guest(s.key);
    expect((await api("GET", `/v1/store/games/${s.game}/steam-key`, { key: s.key, token: a.player_token })).json.error.code).toBe("no_steam_key");
    expect((await buy(s.key, a.player_token, s.game)).json.completed).toBe(true);
    const lib = (await api("GET", "/v1/store/library", { key: s.key, token: a.player_token })).json.games;
    expect(lib[0].steam_key).toMatchObject({ key: keys[0], revoked: false });
    expect(lib[0].steam_key.activate_url).toBe(`https://store.steampowered.com/account/registerkey?key=${keys[0]}`);
    // Asking again keeps the same key.
    expect((await api("GET", `/v1/store/games/${s.game}/steam-key`, { key: s.key, token: a.player_token })).json.steam_key.key).toBe(keys[0]);

    const b = await guest(s.key);
    await buy(s.key, b.player_token, s.game);
    expect((await api("GET", `/v1/store/games/${s.game}/steam-key`, { key: s.key, token: b.player_token })).json.steam_key.key).toBe(keys[1]);

    // A copy the developer gives gets one too.
    const c = await guest(s.key);
    await api("POST", `/v1/games/${s.game}/entitlements`, { token: s.dev, body: { player: c.player.id, note: "press" } });
    expect((await api("GET", `/v1/store/games/${s.game}/steam-key`, { key: s.key, token: c.player_token })).json.steam_key.key).toBe(keys[2]);

    let list = (await api("GET", `/v1/games/${s.game}/steam-keys`, { token: s.dev })).json;
    expect(list.counts).toEqual({ available: 1, assigned: 3, revoked: 0, total: 4 });
    expect(list.keys.map((k: any) => k.key).sort()).toEqual(keys.slice(0, 3).sort());
    const avail = (await api("GET", `/v1/games/${s.game}/steam-keys?status=available`, { token: s.dev })).json.keys;
    expect(avail).toEqual([expect.objectContaining({ last5: keys[3].slice(-5), batch: "launch" })]);
    expect(avail[0].key).toBeUndefined();

    // Taking the game back (a refund handled by the developer) revokes that player's key.
    await api("DELETE", `/v1/games/${s.game}/entitlements/${b.player.id}`, { token: s.dev });
    list = (await api("GET", `/v1/games/${s.game}/steam-keys?status=revoked`, { token: s.dev })).json;
    expect(list.keys).toEqual([expect.objectContaining({ key: keys[1], player: b.player.id, revoked_reason: "entitlement revoked" })]);

    // Another developer sees nothing.
    const stranger = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `x${uniq()}@example.com` } })).json.token;
    expect((await api("GET", `/v1/games/${s.game}/steam-keys`, { token: stranger })).status).toBe(404);
  });

  it("a Stripe refund revokes the key bought with that payment", async () => {
    const s = await setup();
    await api("POST", `/v1/games/${s.game}/steam-keys`, { token: s.dev, body: { keys: keyOf(5, s.tag) } });
    const a = await guest(s.key);
    const sign = async (payload: string) => {
      const t = Math.floor(Date.now() / 1000);
      const k = await crypto.subtle.importKey("raw", new TextEncoder().encode((env as any).STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${payload}`)));
      return `t=${t},v1=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    };
    const pi = `pi_${uniq()}`;
    const paid = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: `cs_${uniq()}`, payment_status: "paid", payment_intent: pi, amount_total: 500, currency: "usd", livemode: false, metadata: { player: a.player.id, game: s.game } } } });
    await api("POST", "/v1/webhooks/stripe", { raw: paid, headers: { "stripe-signature": await sign(paid) } });
    expect((await api("GET", `/v1/games/${s.game}/steam-keys`, { token: s.dev })).json.keys[0]).toMatchObject({ player: a.player.id, ref: pi });
    const refund = JSON.stringify({ type: "charge.refunded", data: { object: { payment_intent: pi } } });
    await api("POST", "/v1/webhooks/stripe", { raw: refund, headers: { "stripe-signature": await sign(refund) } });
    const revoked = (await api("GET", `/v1/games/${s.game}/steam-keys?status=revoked`, { token: s.dev })).json.keys;
    expect(revoked[0]).toMatchObject({ key: keyOf(5, s.tag), revoked_reason: "refunded" });
  });

  it("out of keys: no key, and partii's dashboard says so; unassigned keys can be removed; a guest's key follows it into its account", async () => {
    const s = await setup();
    const k1 = keyOf(7, s.tag);
    const k2 = keyOf(8, s.tag);
    await api("POST", `/v1/games/${s.game}/steam-keys`, { token: s.dev, body: { keys: [k1, k2] } });
    expect((await api("POST", `/v1/games/${s.game}/steam-keys/remove`, { token: s.dev, body: { keys: k2 } })).json).toMatchObject({ removed: 1, available: 1 });
    const a = await guest(s.key);
    await buy(s.key, a.player_token, s.game);
    const b = await guest(s.key);
    await buy(s.key, b.player_token, s.game);
    expect((await api("GET", `/v1/store/games/${s.game}/steam-key`, { key: s.key, token: b.player_token })).json.error.code).toBe("no_steam_key");
    await new Promise((r) => setTimeout(r, 50));
    const out = await (env as any).DB.prepare("SELECT kind FROM error_groups WHERE game_id = 'partii' AND message = ?").bind(`steam keys: ${s.game} is out of Steam keys`).first();
    expect(out?.kind).toBe("error");
    // An assigned key can't be removed.
    expect((await api("POST", `/v1/games/${s.game}/steam-keys/remove`, { token: s.dev, body: { keys: k1 } })).json.removed).toBe(0);
    // Guest a signs in to an account that already exists: merged, the key comes along.
    const subject = `s${uniq()}`;
    const existing = (await api("POST", "/v1/players/login", { key: s.key, body: { provider: "fake", subject } })).json;
    const merged = await api("POST", "/v1/players/login", { key: s.key, token: a.player_token, body: { provider: "fake", subject } });
    expect(merged.json).toMatchObject({ merged: true, player: { id: existing.player.id } });
    expect((await api("GET", `/v1/store/games/${s.game}/steam-key`, { key: s.key, token: merged.json.player_token })).json.steam_key.key).toBe(k1);
  });
});

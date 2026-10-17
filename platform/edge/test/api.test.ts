import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { HANDLERS } from "../src/api";
import { verifyClaims } from "../src/api/core";
import { verifyIdToken } from "../src/api/providers";
import { ROUTES } from "../src/generated/routes";
import { connected } from "./client";

type Opts = { token?: string; key?: string; player?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> };

async function api(method: string, path: string, o: Opts = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.player) headers.authorization = `Bearer ${o.player}`;
  if (o.key) headers["x-partii-key"] = o.key;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await SELF.fetch(`https://edge${path}`, { method, headers, body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, json: type.includes("json") ? ((await res.json()) as any) : null, res };
}

let n = 0;
async function developer() {
  const r = await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `dev${Date.now()}${n++}@example.com`, name: "Dev" } });
  expect(r.json.ok).toBe(true);
  return r.json.token as string;
}

/** A developer with a project, a key and a published $4.99 game. */
async function setup(opts: { demo?: unknown } = {}) {
  const token = await developer();
  const project = `p${Date.now().toString(36)}${n++}`;
  await api("PUT", `/v1/projects/${project}`, { token, body: { name: "Proj" } });
  const key = (await api("POST", `/v1/projects/${project}/keys`, { token, body: { key_id: "web", name: "web" } })).json.key.key;
  const game = `g-${project}`;
  const put = await api("PUT", `/v1/games/${game}`, { token, body: { project, title: "Tankii", price_cents: 499, platforms: ["macos", "ios"], demo: "demo" in opts ? opts.demo : { free_levels: 20 } } });
  expect(put.json.ok).toBe(true);
  await api("POST", `/v1/games/${game}/publish`, { token });
  return { token, project, key, game };
}

async function guest(key: string, device = `dev-${Date.now()}-${n++}-xxxx`) {
  const r = await api("POST", "/v1/players/guest", { key, body: { device_id: device, display_name: "Guest" } });
  expect(r.json.ok).toBe(true);
  return { player: r.json.player, token: r.json.player_token as string, device };
}

describe("the spec and the handlers", () => {
  it("match exactly", () => {
    const ops = ROUTES.map((r) => r.op).sort();
    expect(Object.keys(HANDLERS).sort()).toEqual(ops);
  });
});

describe("developers", () => {
  it("admin creates a developer; tokens can be listed, made and revoked", async () => {
    expect((await api("POST", "/v1/admin/developers", { token: "nope", body: { email: "a@b.c" } })).status).toBe(401);
    const token = await developer();
    const me = await api("GET", "/v1/me", { token });
    expect(me.json.developer.name).toBe("Dev");
    const t2 = (await api("POST", "/v1/tokens", { token, body: { name: "ci" } })).json.token;
    expect(t2.token).toMatch(/^pd_/);
    const list = (await api("GET", "/v1/tokens", { token })).json.tokens;
    expect(list.map((t: any) => t.name)).toEqual(["first", "ci"]);
    expect(list.every((t: any) => t.token === undefined)).toBe(true);
    await api("DELETE", `/v1/tokens/${t2.id}`, { token });
    const dead = await api("GET", "/v1/me", { token: t2.token });
    expect(dead.status).toBe(401);
    expect(dead.json.error.hint).toContain("partii tokens create");
  });

  it("projects are idempotent and private; keys work until revoked", async () => {
    const a = await developer();
    const b = await developer();
    const id = `proj${Date.now().toString(36)}`;
    expect((await api("PUT", `/v1/projects/${id}`, { token: a, body: { name: "One" } })).json.created).toBe(true);
    expect((await api("PUT", `/v1/projects/${id}`, { token: a, body: { name: "Uno" } })).json).toMatchObject({ created: false, project: { name: "Uno" } });
    expect((await api("PUT", `/v1/projects/${id}`, { token: b })).json.error.code).toBe("bad_request");
    expect((await api("GET", `/v1/projects/${id}`, { token: b })).status).toBe(404);
    expect((await api("PUT", `/v1/projects/Bad_Id`, { token: a })).status).toBe(400);
    const key = (await api("POST", `/v1/projects/${id}/keys`, { token: a, body: { key_id: "k1" } })).json.key.key;
    expect((await api("POST", "/v1/players/guest", { key, body: { device_id: "device-123456" } })).json.ok).toBe(true);
    expect((await api("GET", `/v1/projects/${id}/keys`, { token: a })).json.keys[0].key).toBe(key);
    await api("DELETE", `/v1/projects/${id}/keys/k1`, { token: a });
    const refused = await api("POST", "/v1/players/guest", { key, body: { device_id: "device-123456" } });
    expect(refused.status).toBe(401);
  });

  it("dry runs change nothing", async () => {
    const token = await developer();
    const id = `dry${Date.now().toString(36)}`;
    const r = await api("PUT", `/v1/projects/${id}`, { token, headers: { "x-partii-dry-run": "1" } });
    expect(r.json).toMatchObject({ dry_run: true, created: true });
    expect((await api("GET", `/v1/projects/${id}`, { token })).status).toBe(404);
  });

  it("errors are JSON with a hint", async () => {
    const r = await api("GET", "/v1/me");
    expect(r.json).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(r.json.error.hint).toBeTruthy();
    const b = await api("PUT", "/v1/projects/x", { token: await developer(), raw: "{not json", headers: { "content-type": "application/json" } });
    expect(b.json.error.code).toBe("bad_request");
  });
});

describe("games and the store", () => {
  it("drafts stay off the store; prices and sales apply", async () => {
    const token = await developer();
    const project = `s${Date.now().toString(36)}`;
    await api("PUT", `/v1/projects/${project}`, { token });
    expect((await api("PUT", `/v1/games/no-project`, { token, body: { title: "x" } })).json.error.hint).toContain("project");
    const game = `draft-${project}`;
    await api("PUT", `/v1/games/${game}`, { token, body: { project, title: "Draft", price_cents: 1000 } });
    expect((await api("GET", `/v1/store/games/${game}`)).status).toBe(404);
    await api("POST", `/v1/games/${game}/publish`, { token });
    expect((await api("GET", `/v1/store/games/${game}`)).json.game.price_now_cents).toBe(1000);
    await api("PUT", `/v1/games/${game}/sale`, { token, body: { percent: 25 } });
    expect((await api("GET", `/v1/store/games/${game}`)).json.game.price_now_cents).toBe(750);
    await api("DELETE", `/v1/games/${game}/sale`, { token });
    await api("PUT", `/v1/games/${game}/price`, { token, body: { price_cents: 499 } });
    const page = (await api("GET", `/v1/store/games/${game}`)).json.game;
    expect(page).toMatchObject({ price_cents: 499, price_now_cents: 499, sale: null });
    expect((await api("GET", "/v1/store/games")).json.games.some((g: any) => g.id === game)).toBe(true);
    await api("POST", `/v1/games/${game}/unpublish`, { token });
    expect((await api("GET", `/v1/store/games/${game}`)).status).toBe(404);
    expect((await api("PUT", `/v1/games/${game}/price`, { token, body: { price_cents: 4.5 } })).status).toBe(400);
  });

  it("direct uploads: signed URL with the checksum, then finish checks what landed", async () => {
    const { token, game } = await setup({ demo: null });
    const bytes = new Uint8Array(300_000).map((_, i) => i % 251);
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const body = { platform: "android", version: "2.0.0", filename: "tankii.apk", size: bytes.byteLength, sha256: sha };
    const start = await api("POST", `/v1/games/${game}/builds/uploads`, { token, body });
    expect(start.json.ok).toBe(true);
    const up = start.json.upload;
    const url = new URL(up.url);
    expect(url.origin).toBe("https://acct.r2.example");
    expect(url.pathname).toBe(`/partii-dev-files/builds/${game}/android/2.0.0/${up.id}/tankii.apk`);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("x-amz-checksum-sha256");
    expect(up.headers["x-amz-checksum-sha256"]).toBe(btoa(String.fromCharCode(...sha.match(/../g)!.map((h: string) => parseInt(h, 16)))));
    // Nothing uploaded yet.
    expect((await api("POST", `/v1/games/${game}/builds/uploads/${up.id}`, { token, body })).json.error.code).toBe("not_uploaded");
    // What the PUT to R2 does, done through the binding here.
    const key = url.pathname.replace("/partii-dev-files/", "");
    await (env as any).FILES.put(key, bytes.slice(0, 1000));
    expect((await api("POST", `/v1/games/${game}/builds/uploads/${up.id}`, { token, body })).json.error.code).toBe("size_mismatch");
    await (env as any).FILES.put(key, bytes);
    const fin = await api("POST", `/v1/games/${game}/builds/uploads/${up.id}`, { token, body });
    expect(fin.json.build).toMatchObject({ id: up.id, platform: "android", size: 300_000, sha256: sha });
    expect((await api("GET", `/v1/games/${game}/builds`, { token })).json.builds.map((b: any) => b.id)).toContain(up.id);
    // Someone else's game: no.
    const other = await developer();
    expect((await api("POST", `/v1/games/${game}/builds/uploads`, { token: other, body })).status).toBe(404); // not yours: as if absent
  });

  it("builds upload and download only for owners (no demo, paid)", async () => {
    const { token, key, game } = await setup({ demo: null });
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 250]);
    const up = await api("POST", `/v1/games/${game}/builds?platform=macos&version=1.0.0&filename=tankii.dmg`, { token, raw: bytes });
    expect(up.json.build).toMatchObject({ platform: "macos", version: "1.0.0", size: 6 });
    expect((await api("GET", `/v1/games/${game}/builds`, { token })).json.builds).toHaveLength(1);
    const me = await guest(key);
    const no = await api("GET", `/v1/store/games/${game}/download/macos`, { key, player: me.token });
    expect(no.status).toBe(402);
    await api("POST", `/v1/games/${game}/entitlements`, { token, body: { player: me.player.id } });
    const yes = await api("GET", `/v1/store/games/${game}/download/macos`, { key, player: me.token });
    expect(new Uint8Array(await yes.res.arrayBuffer())).toEqual(bytes);
    expect((await api("GET", `/v1/store/games/${game}`)).json.builds[0]).toMatchObject({ platform: "macos", version: "1.0.0" });
    // A newer build is served; deleting it falls back to the older one, then to none.
    const two = await api("POST", `/v1/games/${game}/builds?platform=macos&version=1.0.1`, { token, raw: new Uint8Array([9, 9]) });
    expect(new Uint8Array(await (await api("GET", `/v1/store/games/${game}/download/macos`, { key, player: me.token })).res.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
    expect((await api("DELETE", `/v1/games/${game}/builds/${two.json.build.id}`, { token })).json).toMatchObject({ deleted: true, build: { version: "1.0.1" } });
    expect((await api("DELETE", `/v1/games/${game}/builds/${two.json.build.id}`, { token })).status).toBe(404);
    expect(new Uint8Array(await (await api("GET", `/v1/store/games/${game}/download/macos`, { key, player: me.token })).res.arrayBuffer())).toEqual(bytes);
    await api("DELETE", `/v1/games/${game}/builds/${up.json.build.id}`, { token });
    expect((await api("GET", `/v1/store/games/${game}/download/macos`, { key, player: me.token })).status).toBe(404);
  });

  it("checkout in the fake store grants the game; the library shows it", async () => {
    const { key, game, token } = await setup();
    const me = await guest(key);
    const co = await api("POST", `/v1/store/games/${game}/checkout`, { key, player: me.token, body: {} });
    expect(co.json).toMatchObject({ completed: true });
    const lib = (await api("GET", "/v1/store/library", { key, player: me.token })).json.games;
    expect(lib.map((g: any) => g.id)).toEqual([game]);
    expect((await api("POST", `/v1/store/games/${game}/checkout`, { key, player: me.token, body: {} })).json.error.code).toBe("owned");
    const sales = (await api("GET", `/v1/games/${game}/sales`, { token })).json;
    expect(sales.totals).toMatchObject({ count: 1, test_count: 1, gross_cents: 0 });
  });

  it("test purchases and test players (fake store without a Stripe key)", async () => {
    const { token, game } = await setup();
    const tp = (await api("POST", "/v1/test/players", { token, body: { name: "Tester" } })).json;
    expect(tp.player.test).toBe(true);
    const buy = await api("POST", "/v1/test/purchases", { token, body: { game, player: tp.player.id } });
    expect(buy.json.entitlement).toMatchObject({ game, source: "fake" });
    expect((await api("GET", `/v1/games/${game}/entitlements`, { token })).json.entitlements[0]).toMatchObject({ player: tp.player.id, source: "fake" });
  });

  it("codes redeem once", async () => {
    const { token, key, game } = await setup();
    const codes = (await api("POST", `/v1/games/${game}/codes`, { token, body: { count: 3, note: "press" } })).json.codes;
    expect(codes).toHaveLength(3);
    expect(codes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const a = await guest(key);
    const b = await guest(key);
    expect((await api("POST", "/v1/players/me/redeem", { key, player: a.token, body: { code: codes[0].toLowerCase() } })).json.entitlement.source).toBe("code");
    expect((await api("POST", "/v1/players/me/redeem", { key, player: b.token, body: { code: codes[0] } })).json.error.code).toBe("used");
    expect((await api("GET", `/v1/games/${game}/codes`, { token })).json.codes.find((c: any) => c.code === codes[0]).redeemed_by).toBe(a.player.id);
  });

  it("entitlements: grant, signed offline copy, revoke", async () => {
    const { token, key, game } = await setup();
    const me = await guest(key);
    await api("POST", `/v1/games/${game}/entitlements`, { token, body: { player: me.player.id, note: "tester" } });
    const ent = (await api("GET", `/v1/players/me/entitlements?game=${game}`, { key, player: me.token })).json;
    expect(ent.entitlements).toHaveLength(1);
    const claims = await verifyClaims<{ pid: string; owns: string[]; exp: number }>((env as any).PLAYER_TOKEN_SECRET, "pe", ent.signed);
    expect(claims).toMatchObject({ pid: me.player.id, owns: [`${game}:full`] });
    await api("DELETE", `/v1/games/${game}/entitlements/${me.player.id}`, { token });
    expect((await api("GET", `/v1/players/me/entitlements?game=${game}`, { key, player: me.token })).json.entitlements).toHaveLength(0);
  });

  it("live content: push, manifest, files by hash", async () => {
    const { token, key, game } = await setup();
    const level = btoa(JSON.stringify({ name: "Level 1" }));
    const push = await api("POST", `/v1/games/${game}/content`, { token, body: { version: "2026.10.11", files: { "levels/1.json": level } } });
    const sha = push.json.manifest.files["levels/1.json"].sha256;
    const m = (await api("GET", `/v1/content/${game}/manifest`, { key })).json.manifest;
    expect(m).toMatchObject({ version: "2026.10.11", channel: "stable" });
    const f = await api("GET", `/v1/content/${game}/files/${sha}`, { key });
    expect(await f.res.text()).toBe(JSON.stringify({ name: "Level 1" }));
    expect((await api("GET", `/v1/content/${game}/manifest?channel=beta`, { key })).status).toBe(404);
  });
});

describe("players", () => {
  it("two first guest calls from one install at once get the same player", async () => {
    const { key } = await setup();
    const device = `race-${Date.now()}-${n++}-xxxx`;
    const [a, b] = await Promise.all([guest(key, device), guest(key, device)]);
    expect(a.player.id).toBe(b.player.id);
    expect((await guest(key, device)).player.id).toBe(a.player.id);
  });

  it("guests are one per device; names change", async () => {
    const { key } = await setup();
    const a = await guest(key, "device-aaaaaaaa");
    const again = await api("POST", "/v1/players/guest", { key, body: { device_id: "device-aaaaaaaa" } });
    expect(again.json.player.id).toBe(a.player.id);
    expect(again.json.created).toBe(false);
    const r = await api("PATCH", "/v1/players/me", { key, player: a.token, body: { display_name: "Sterling" } });
    expect(r.json.player.display_name).toBe("Sterling");
    expect((await api("GET", "/v1/players/me", { key, player: a.token })).json.player).toMatchObject({ display_name: "Sterling", providers: ["device"] });
    expect((await api("GET", "/v1/players/me", { key })).status).toBe(401);
  });

  it("email sign-in upgrades a guest; a second device's guest merges in", async () => {
    const { key, game, token } = await setup();
    const phone = await guest(key);
    const email = `sterling${n++}@example.com`;
    const start = (await api("POST", "/v1/players/email/start", { key, body: { email } })).json;
    expect(start.code).toMatch(/^\d{6}$/);
    expect((await api("POST", "/v1/players/login", { key, player: phone.token, body: { provider: "email", email, code: "000000" } })).json.error.code).toBe("bad_code");
    const up = await api("POST", "/v1/players/login", { key, player: phone.token, body: { provider: "email", email, code: start.code } });
    expect(up.json).toMatchObject({ merged: false, player: { id: phone.player.id, providers: ["device", "email"] } });

    // The desktop starts as its own guest, buys the game and saves.
    const desk = await guest(key);
    await api("POST", `/v1/test/purchases`, { token, body: { game, player: desk.player.id } });
    await api("PUT", `/v1/saves/${game}/main`, { key, player: desk.token, body: { data: { level: 7 } } });
    const code2 = (await api("POST", "/v1/players/email/start", { key, body: { email } })).json.code;
    const login = await api("POST", "/v1/players/login", { key, player: desk.token, body: { provider: "email", email, code: code2 } });
    expect(login.json).toMatchObject({ merged: true, player: { id: phone.player.id } });
    // One purchase, every device: the phone account owns it now, with the save.
    const ent = (await api("GET", `/v1/players/me/entitlements?game=${game}`, { key, player: login.json.player_token })).json.entitlements;
    expect(ent).toHaveLength(1);
    expect((await api("GET", `/v1/saves/${game}/main`, { key, player: phone.token })).json.save.data).toEqual({ level: 7 });
    expect((await api("GET", "/v1/players/me", { key, player: desk.token })).status).toBe(401);
  });

  it("fake provider logins in dev; unknown providers are refused", async () => {
    const { key } = await setup();
    const a = await api("POST", "/v1/players/login", { key, body: { provider: "fake", subject: "alice" } });
    const b = await api("POST", "/v1/players/login", { key, body: { provider: "fake", subject: "alice" } });
    expect(a.json.player.id).toBe(b.json.player.id);
    expect((await api("POST", "/v1/players/login", { key, body: { provider: "myspace" } })).json.error.code).toBe("bad_request");
    expect((await api("POST", "/v1/players/login", { key, body: { provider: "apple", id_token: "x.y.z" } })).json.error.code).toBe("provider_not_configured");
  });

  it("deleting the account removes it", async () => {
    const { key, game } = await setup();
    const me = await guest(key);
    await api("PUT", `/v1/saves/${game}/main`, { key, player: me.token, body: { data: 1 } });
    expect((await api("DELETE", "/v1/players/me", { key, player: me.token })).json.deleted).toBe(true);
    expect((await api("GET", "/v1/players/me", { key, player: me.token })).status).toBe(401);
    // The device starts fresh.
    expect((await api("POST", "/v1/players/guest", { key, body: { device_id: me.device } })).json.created).toBe(true);
  });

  it("receipts from the fake store become entitlements", async () => {
    const { key, game } = await setup();
    const me = await guest(key);
    const r = await api("POST", "/v1/players/me/receipts", { key, player: me.token, body: { store: "fake", game } });
    expect(r.json.entitlement).toMatchObject({ game, source: "fake" });
    expect((await api("POST", "/v1/players/me/receipts", { key, player: me.token, body: { store: "appstore", game, transaction: "1" } })).json.error.code).toBe("store_not_configured");
  });

  it("a store purchase belongs to one account: a guest's moves on restore, a signed-in account's stays", async () => {
    const { key, game } = await setup();
    const owns = async (token: string) => (await api("GET", `/v1/players/me/entitlements?game=${game}`, { key, player: token })).json.entitlements.some((e: any) => e.game === game);
    const receipt = (token: string, transaction: string) => api("POST", "/v1/players/me/receipts", { key, player: token, body: { store: "fake", game, transaction } });
    const t1 = `t1${Date.now()}`;
    // A guest buys, reinstalls (a new guest) and restores: the purchase moves.
    const g1 = await guest(key);
    expect((await receipt(g1.token, t1)).json.entitlement).toMatchObject({ game });
    const g2 = await guest(key);
    expect((await receipt(g2.token, t1)).json.entitlement).toMatchObject({ game });
    expect(await owns(g2.token)).toBe(true);
    expect(await owns(g1.token)).toBe(false);
    // Presenting it again is fine.
    expect((await receipt(g2.token, t1)).status).toBe(200);
    // A signed-in account's purchase can't be claimed by anyone else.
    const t2 = `t2${Date.now()}`;
    const alice = (await api("POST", "/v1/players/login", { key, body: { provider: "fake", subject: `buyer${Date.now()}` } })).json.player_token;
    expect((await receipt(alice, t2)).status).toBe(200);
    const thief = await guest(key);
    const r = await receipt(thief.token, t2);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("claimed_by_another_account");
    expect(await owns(thief.token)).toBe(false);
    expect(await owns(alice)).toBe(true);
  });
});

describe("saves", () => {
  it("write, conflict, merge, history, restore", async () => {
    const { key, game } = await setup();
    const me = await guest(key);
    const p = { key, player: me.token };
    const w1 = await api("PUT", `/v1/saves/${game}/main`, { ...p, body: { data: { level: 1 } } });
    expect(w1.json.save.rev).toBe(1);
    await api("PUT", `/v1/saves/${game}/main`, { ...p, body: { base_rev: 1, data: { level: 2 } } });
    // Another device still thinks rev 1 is current.
    const stale = await api("PUT", `/v1/saves/${game}/main`, { ...p, body: { base_rev: 1, data: { level: 5, coins: 3 } } });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ error: { code: "conflict" }, theirs: { rev: 2, data: { level: 2 } }, yours: { level: 5, coins: 3 } });
    await api("PUT", `/v1/saves/${game}/main`, { ...p, body: { base_rev: 2, data: { level: 5, coins: 3 } } });
    expect((await api("GET", `/v1/saves/${game}/main`, p)).json.save).toMatchObject({ rev: 3, data: { level: 5, coins: 3 } });
    expect((await api("GET", `/v1/saves/${game}`, p)).json.saves).toHaveLength(1);
    const h = (await api("GET", `/v1/saves/${game}/main/history`, p)).json;
    expect(h.revisions.map((r: any) => r.rev)).toEqual([3, 2, 1]);
    const back = await api("POST", `/v1/saves/${game}/main/restore`, { ...p, body: { rev: 1 } });
    expect(back.json.save).toMatchObject({ rev: 4, restored_from: 1 });
    expect((await api("GET", `/v1/saves/${game}/main`, p)).json.save.data).toEqual({ level: 1 });
    expect((await api("PUT", `/v1/saves/${game}/bad%20slot`, { ...p, body: { data: 1 } })).status).toBe(400);
  });
});

describe("timings", () => {
  it("clients report connection timings over the socket; developers read them", async () => {
    const token = await developer();
    const project = "demo";
    // "demo" may exist from another file; adopt or create it for this developer.
    const put = await api("PUT", `/v1/projects/${project}`, { token });
    if (!put.json.ok) return; // taken by another test developer: covered elsewhere
    const c = await connected();
    c.send({ t: "report", metrics: { create_ms: 55, join_ms: 90, connect_ms: 160, path: "turn" } });
    await new Promise((r) => setTimeout(r, 100));
    const t = (await api("GET", `/v1/projects/${project}/timings`, { token })).json;
    expect(t.summary.count).toBeGreaterThan(0);
    expect(t.summary.paths.turn).toBeGreaterThan(0);
  });
});

describe("stripe webhooks", () => {
  async function sign(payload: string, secret: string, t = Math.floor(Date.now() / 1000)) {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${payload}`)));
    return `t=${t},v1=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  }

  it("a signed checkout.session.completed grants the game; forgeries and refunds are handled", async () => {
    const { key, game, token } = await setup();
    const me = await guest(key);
    const ev = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", payment_intent: "pi_test_1", amount_total: 499, currency: "usd", livemode: false, metadata: { player: me.player.id, game } } } });
    const forged = await api("POST", "/v1/webhooks/stripe", { raw: ev, headers: { "stripe-signature": await sign(ev, "wrong") } });
    expect(forged.status).toBe(400);
    const ok = await api("POST", "/v1/webhooks/stripe", { raw: ev, headers: { "stripe-signature": await sign(ev, (env as any).STRIPE_WEBHOOK_SECRET) } });
    expect(ok.json.received).toBe(true);
    // Stripe retries: still one purchase.
    await api("POST", "/v1/webhooks/stripe", { raw: ev, headers: { "stripe-signature": await sign(ev, (env as any).STRIPE_WEBHOOK_SECRET) } });
    expect((await api("GET", `/v1/games/${game}/sales`, { token })).json.purchases).toHaveLength(1);
    // partii's own dashboard: the forged webhook is a reported failure; the purchase one event despite the retry.
    await new Promise((r) => setTimeout(r, 50));
    const forgery = await (env as any).DB.prepare("SELECT kind, count FROM error_groups WHERE game_id = 'partii' AND message LIKE 'webhookStripe: bad_signature%'").first();
    expect(forgery?.kind).toBe("warning");
    const bought = await (env as any).DB.prepare("SELECT COUNT(*) AS n FROM events WHERE game_id = 'partii' AND name = 'purchase' AND json_extract(props, '$.game') = ?").bind(game).first();
    expect(bought?.n).toBe(1);
    expect((await api("GET", `/v1/players/me/entitlements?game=${game}`, { key, player: me.token })).json.entitlements).toHaveLength(1);
    const refund = JSON.stringify({ type: "charge.refunded", data: { object: { payment_intent: "pi_test_1" } } });
    await api("POST", "/v1/webhooks/stripe", { raw: refund, headers: { "stripe-signature": await sign(refund, (env as any).STRIPE_WEBHOOK_SECRET) } });
    expect((await api("GET", `/v1/players/me/entitlements?game=${game}`, { key, player: me.token })).json.entitlements).toHaveLength(0);
  });

  it("a 100%-off promotion code (no_payment_required) grants the game; an unpaid session doesn't", async () => {
    const { key, game } = await setup();
    const send = async (o: Record<string, unknown>) => {
      const ev = JSON.stringify({ type: "checkout.session.completed", data: { object: { amount_total: 0, currency: "usd", livemode: false, payment_intent: null, ...o } } });
      await api("POST", "/v1/webhooks/stripe", { raw: ev, headers: { "stripe-signature": await sign(ev, (env as any).STRIPE_WEBHOOK_SECRET) } });
    };
    const unpaid = await guest(key);
    await send({ id: `cs_u${Date.now()}`, payment_status: "unpaid", metadata: { player: unpaid.player.id, game } });
    expect((await api("GET", `/v1/players/me/entitlements?game=${game}`, { key, player: unpaid.token })).json.entitlements).toHaveLength(0);
    const free = await guest(key);
    await send({ id: `cs_f${Date.now()}`, payment_status: "no_payment_required", metadata: { player: free.player.id, game } });
    expect((await api("GET", `/v1/players/me/entitlements?game=${game}`, { key, player: free.token })).json.entitlements).toHaveLength(1);
  });
});

describe("ID tokens", () => {
  it("verifies RS256 against a JWKS, issuer, audience and expiry", async () => {
    const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = { ...((await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey), kid: "k1" };
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const mint = async (claims: Record<string, unknown>) => {
      const input = `${b64({ alg: "RS256", kid: "k1" })}.${b64(claims)}`;
      const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(input)));
      return `${input}.${btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    };
    const fetcher = (async () => new Response(JSON.stringify({ keys: [jwk] }))) as unknown as typeof fetch;
    const exp = Math.floor(Date.now() / 1000) + 600;
    const url = `https://jwks.test/${Math.random()}`;
    const good = await mint({ iss: "https://appleid.apple.com", aud: "me.app", sub: "001", exp });
    expect((await verifyIdToken(good, url, ["https://appleid.apple.com"], ["me.app"], fetcher)).sub).toBe("001");
    await expect(verifyIdToken(await mint({ iss: "https://evil", aud: "me.app", sub: "1", exp }), url, ["https://appleid.apple.com"], ["me.app"], fetcher)).rejects.toThrow(/issuer/);
    await expect(verifyIdToken(await mint({ iss: "https://appleid.apple.com", aud: "other", sub: "1", exp }), url, ["https://appleid.apple.com"], ["me.app"], fetcher)).rejects.toThrow(/another app/);
    await expect(verifyIdToken(await mint({ iss: "https://appleid.apple.com", aud: "me.app", sub: "1", exp: 1 }), url, ["https://appleid.apple.com"], ["me.app"], fetcher)).rejects.toThrow(/expired/);
    await expect(verifyIdToken(good.slice(0, -4) + "AAAA", url, ["https://appleid.apple.com"], ["me.app"], fetcher)).rejects.toThrow(/signature/);
  });
});

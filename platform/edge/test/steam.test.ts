import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { gameSecret } from "../src/api/secrets";
import { checkWithSteam, steamTicketSubject } from "../src/api/steam";

const E = env as any;
type Opts = { token?: string; key?: string; body?: unknown };

async function api(method: string, path: string, o: Opts = {}) {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.key) headers["x-partii-key"] = o.key;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await SELF.fetch(path.startsWith("http") ? path : `https://edge${path}`, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, json: type.includes("json") ? ((await res.json()) as any) : null, text: type.includes("html") ? await res.text() : "" };
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${n++}`;

async function setup(games = 1) {
  const dev = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `steam${uniq()}@example.com`, name: "Dev" } })).json.token as string;
  const project = `p${uniq()}`;
  await api("PUT", `/v1/projects/${project}`, { token: dev, body: { name: "Proj" } });
  const key = (await api("POST", `/v1/projects/${project}/keys`, { token: dev, body: { key_id: "web", name: "web" } })).json.key.key as string;
  const ids: string[] = [];
  for (let i = 0; i < games; i++) {
    const game = `g${i}-${project}`;
    await api("PUT", `/v1/games/${game}`, { token: dev, body: { project, title: "Tankii", price_cents: 0, platforms: ["macos"] } });
    ids.push(game);
  }
  return { dev, key, project, game: ids[0], games: ids };
}

const KEY = "0123456789ABCDEF0123456789ABCDEF";

describe("per-game secrets", () => {
  it("are set by the game's developer, never shown back, and bound to the game", async () => {
    const s = await setup();
    expect((await api("PUT", `/v1/games/${s.game}/secrets/steam.web_api_key`, { key: s.key, body: { value: KEY } })).status).toBe(401);
    const set = await api("PUT", `/v1/games/${s.game}/secrets/steam.web_api_key`, { token: s.dev, body: { value: KEY.toLowerCase() } });
    expect(set.json.secret).toMatchObject({ name: "steam.web_api_key", set: true, last4: "CDEF" });
    expect(JSON.stringify(set.json)).not.toContain(KEY);
    await api("PUT", `/v1/games/${s.game}/secrets/steam.app_ids`, { token: s.dev, body: { value: "4971410, 4971420,4971410" } });
    const list = await api("GET", `/v1/games/${s.game}/secrets`, { token: s.dev });
    expect(JSON.stringify(list.json)).not.toContain(KEY);
    expect(list.json.secrets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "steam.web_api_key", secret: true, set: true, last4: "CDEF" }),
        expect.objectContaining({ name: "steam.app_ids", secret: false, set: true, value: "4971410,4971420" }),
      ]),
    );
    // Stored encrypted, readable only server-side and only for this game.
    const row = await E.DB.prepare("SELECT value FROM game_secrets WHERE game_id = ? AND name = 'steam.web_api_key'").bind(s.game).first();
    expect(row.value).not.toContain(KEY);
    expect(await gameSecret(E, s.game, "steam.web_api_key")).toBe(KEY);
    await E.DB.prepare("INSERT INTO game_secrets (game_id, name, secret, value, iv, last4, updated_at, updated_by) SELECT 'other-game', name, secret, value, iv, last4, updated_at, updated_by FROM game_secrets WHERE game_id = ? AND name = 'steam.web_api_key'").bind(s.game).run();
    await expect(gameSecret(E, "other-game", "steam.web_api_key")).rejects.toThrow();
    // Another developer can't touch them; bad names and values are refused.
    const stranger = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `x${uniq()}@example.com` } })).json.token;
    expect((await api("GET", `/v1/games/${s.game}/secrets`, { token: stranger })).status).toBe(404);
    expect((await api("PUT", `/v1/games/${s.game}/secrets/stripe.key`, { token: s.dev, body: { value: "x" } })).status).toBe(400);
    expect((await api("PUT", `/v1/games/${s.game}/secrets/steam.web_api_key`, { token: s.dev, body: { value: "short" } })).status).toBe(400);
    expect((await api("DELETE", `/v1/games/${s.game}/secrets/steam.web_api_key`, { token: s.dev })).json.deleted).toBe(true);
    expect(await gameSecret(E, s.game, "steam.web_api_key")).toBeNull();
  });
});

describe("steam ticket sign-in", () => {
  const valve = (ok: boolean, urls: string[]) =>
    (async (u: string) => (urls.push(u), Response.json(ok ? { response: { params: { result: "OK", steamid: "76561190000000001" } } } : { response: { error: { errorcode: 101, errordesc: "Invalid ticket" } } }))) as any;

  it("a game without a key gets steam_not_set_up (its cue for the browser)", async () => {
    const s = await setup();
    const r = await api("POST", "/v1/players/login", { key: s.key, body: { provider: "steam", game: s.game, ticket: "abcdef0123456789", identity: "partii" } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("steam_not_set_up");
  });

  it("checks with the game's own key, tries its apps, and refuses other projects' games", async () => {
    const s = await setup(2);
    await api("PUT", `/v1/games/${s.games[1]}/secrets/steam.web_api_key`, { token: s.dev, body: { value: KEY } });
    await api("PUT", `/v1/games/${s.games[1]}/secrets/steam.app_ids`, { token: s.dev, body: { value: "111,222" } });
    const urls: string[] = [];
    expect(await steamTicketSubject(E, s.project, { game: s.games[1], ticket: "abcdef0123456789", identity: "partii" }, valve(true, urls))).toBe("76561190000000001");
    expect(urls[0]).toContain(`key=${KEY}`);
    expect(urls[0]).toContain("appid=111");
    expect(urls[0]).toContain("identity=partii");
    const tried: string[] = [];
    await expect(steamTicketSubject(E, s.project, { game: s.games[1], ticket: "abcdef0123456789" }, valve(false, tried))).rejects.toThrow(/Invalid ticket/);
    expect(tried.map((u) => /appid=(\d+)/.exec(u)![1])).toEqual(["111", "222"]);
    await expect(steamTicketSubject(E, s.project, { game: s.games[1], ticket: "abcdef0123456789", app_id: "999" }, valve(true, []))).rejects.toThrow(/not one of/);
    // Two games and none named: which key is unclear.
    await expect(steamTicketSubject(E, s.project, { ticket: "abcdef0123456789" }, valve(true, []))).rejects.toThrow(/several games/);
    const other = await setup();
    await expect(steamTicketSubject(E, other.project, { game: s.games[1], ticket: "abcdef0123456789" }, valve(true, []))).rejects.toThrow(/no game/);
  });
});

describe("sign in through Steam (browser)", () => {
  it("start gives a Steam OpenID url coming back here, and a poll secret", async () => {
    const s = await setup();
    const r = await api("POST", "/v1/players/steam/openid/start", { key: s.key, body: {} });
    const url = new URL(r.json.url);
    expect(url.origin + url.pathname).toBe("https://steamcommunity.com/openid/login");
    expect(url.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(url.searchParams.get("openid.return_to")).toMatch(/^https:\/\/edge\/v1\/players\/steam\/openid\/return\?state=[a-z0-9]{20}$/);
    expect(url.searchParams.get("openid.realm")).toBe("https://edge");
    expect(r.json.poll).toMatch(/^sp_/);
    expect((await api("POST", "/v1/players/steam/openid/poll", { key: s.key, body: { poll: r.json.poll } })).json.status).toBe("pending");
  });

  it("refuses an answer that isn't for this login or isn't from Steam, before asking Steam", async () => {
    const s = await setup();
    const r = await api("POST", "/v1/players/steam/openid/start", { key: s.key, body: {} });
    const returnTo = new URL(r.json.url).searchParams.get("openid.return_to")!;
    const state = new URL(returnTo).searchParams.get("state")!;
    const q = (o: Record<string, string>) => `/v1/players/steam/openid/return?${new URLSearchParams({ state, ...o })}`;
    const base = { "openid.mode": "id_res", "openid.op_endpoint": "https://steamcommunity.com/openid/login", "openid.claimed_id": "https://steamcommunity.com/openid/id/76561190000000001", "openid.return_to": returnTo };
    expect((await api("GET", q({ ...base, "openid.return_to": "https://evil/x" }))).status).toBe(400);
    expect((await api("GET", q({ ...base, "openid.op_endpoint": "https://evil/openid" }))).status).toBe(400);
    expect((await api("GET", q({ ...base, "openid.claimed_id": "https://evil/id/1" }))).status).toBe(400);
    expect((await api("GET", q({ ...base, "openid.mode": "cancel" }))).text).toContain("cancelled");
    expect((await api("GET", "/v1/players/steam/openid/return?state=nope")).status).toBe(410);
    expect((await api("POST", "/v1/players/steam/openid/poll", { key: s.key, body: { poll: r.json.poll } })).json.status).toBe("pending");
  });

  it("asks Steam to vouch for the answer (check_authentication)", async () => {
    let sent = "";
    const ok = await checkWithSteam({ "openid.mode": "id_res", "openid.sig": "s", foo: "bar" }, (async (_u: string, init: RequestInit) => ((sent = String(init.body)), new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"))) as any);
    expect(ok).toBe(true);
    expect(sent).toContain("openid.mode=check_authentication");
    expect(sent).not.toContain("foo");
    expect(await checkWithSteam({}, (async () => new Response("is_valid:false\n")) as any)).toBe(false);
  });

  it("once Steam vouched, the next poll signs in (merging the guest), exactly once; ticket and browser reach one player", async () => {
    const s = await setup();
    const guest = (await api("POST", "/v1/players/guest", { key: s.key, body: { device_id: `device-${uniq()}` } })).json;
    const r = await api("POST", "/v1/players/steam/openid/start", { key: s.key, token: guest.player_token, body: {} });
    const state = new URL(new URL(r.json.url).searchParams.get("openid.return_to")!).searchParams.get("state");
    // (What steamOpenidReturn records after Steam's check_authentication says is_valid.)
    await E.DB.prepare("UPDATE steam_openid SET status = 'done', steam_id = '76561190000000002' WHERE id = ?").bind(state).run();
    const done = await api("POST", "/v1/players/steam/openid/poll", { key: s.key, body: { poll: r.json.poll } });
    expect(done.json).toMatchObject({ status: "done", merged: false, player: { id: guest.player.id } });
    expect(done.json.player.providers).toContain("steam");
    expect((await api("POST", "/v1/players/steam/openid/poll", { key: s.key, body: { poll: r.json.poll } })).json.status).toBe("used");
    // Another project's key can't poll it.
    const other = await setup();
    expect((await api("POST", "/v1/players/steam/openid/poll", { key: other.key, body: { poll: r.json.poll } })).status).toBe(404);
    // A ticket for the same Steam id signs in to the same player.
    const row = await E.DB.prepare("SELECT player_id FROM identities WHERE provider = 'steam' AND subject = '76561190000000002'").first();
    expect(row.player_id).toBe(guest.player.id);
  });
});

import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { periodKey } from "../src/api/leaderboards";

type Opts = { token?: string; key?: string; body?: unknown };
async function api(method: string, path: string, o: Opts = {}) {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.key) headers["x-partii-key"] = o.key;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await SELF.fetch(`https://edge${path}`, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
}
let n = 0;
const uniq = () => `${Date.now().toString(36)}${n++}`;

async function setup() {
  const dev = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `lb${uniq()}@example.com`, name: "Dev" } })).json.token as string;
  const project = `p${uniq()}`;
  await api("PUT", `/v1/projects/${project}`, { token: dev, body: { name: "Arcade" } });
  const key = (await api("POST", `/v1/projects/${project}/keys`, { token: dev, body: { key_id: "web", name: "web" } })).json.key.key as string;
  const game = `g-${project}`;
  await api("PUT", `/v1/games/${game}`, { token: dev, body: { project, title: "Rocket", price_cents: 0, platforms: ["web"] } });
  return { dev, key, game };
}
const guest = async (key: string, name: string) => (await api("POST", "/v1/players/guest", { key, body: { device_id: `dev-${uniq()}-xxxx`, display_name: name } })).json.player_token as string;
const submit = (s: { key: string; game: string }, token: string, score: number, meta?: unknown, board = "altitude") => api("POST", `/v1/games/${s.game}/leaderboards/${board}`, { key: s.key, token, body: { score, meta } });

describe("leaderboards", () => {
  it("keeps each player's best, ranks them, and shows the caller's own", async () => {
    const s = await setup();
    const ada = await guest(s.key, "Ada");
    const bo = await guest(s.key, "Bo");
    const cy = await guest(s.key, "Cy");
    let r = await submit(s, ada, 4200, { play_time_seconds: 81.5, reached_heaven: false, cause: "lava" });
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.best.all).toMatchObject({ score: 4200, rank: 1, improved: true, plays: 1 });
    // A lower run is a play, not a new best.
    r = await submit(s, ada, 900, { cause: "block", killer_block: "DEBT" });
    expect(r.json.best.daily).toMatchObject({ score: 4200, improved: false, plays: 2, meta: { cause: "lava" } });
    await submit(s, bo, 12000, { reached_heaven: true, cause: "victory" });
    await submit(s, cy, 4200);
    const top = (await api("GET", `/v1/games/${s.game}/leaderboards/altitude?period=weekly&limit=10`, { key: s.key, token: cy })).json;
    expect(top).toMatchObject({ period: "weekly", higher_is_better: true, players: 3, total_plays: 4 });
    // Ties go to whoever got there first.
    expect(top.entries.map((e: any) => [e.rank, e.display_name, e.score])).toEqual([
      [1, "Bo", 12000],
      [2, "Ada", 4200],
      [3, "Cy", 4200],
    ]);
    expect(top.entries[0].meta).toEqual({ reached_heaven: true, cause: "victory" });
    expect(top.me).toMatchObject({ score: 4200, rank: 3, plays: 1 });
    expect(top.resets_at).toBeGreaterThan(Date.now());
    // Without a player token: no `me`. limit honored.
    const anon = (await api("GET", `/v1/games/${s.game}/leaderboards/altitude?limit=1`, { key: s.key })).json;
    expect(anon.entries.length).toBe(1);
    expect(anon.me).toBeNull();
    // Unknown boards are empty, not errors.
    expect((await api("GET", `/v1/games/${s.game}/leaderboards/nothing`, { key: s.key })).json.entries).toEqual([]);
  });

  it("lower-is-better boards, cheater removal, bad input, other projects", async () => {
    const s = await setup();
    expect((await api("PUT", `/v1/games/${s.game}/leaderboards/time/config`, { token: s.dev, body: { higher_is_better: false } })).json.ok).toBe(true);
    const a = await guest(s.key, "A");
    const b = await guest(s.key, "B");
    await submit(s, a, 61.2, {}, "time");
    await submit(s, a, 75, {}, "time");
    await submit(s, b, 58.9, {}, "time");
    let top = (await api("GET", `/v1/games/${s.game}/leaderboards/time`, { key: s.key })).json;
    expect(top.entries.map((e: any) => e.score)).toEqual([58.9, 61.2]);
    const cheater = top.entries[0].player_id;
    expect((await api("DELETE", `/v1/games/${s.game}/leaderboards/time/players/${cheater}`, { token: s.dev })).json.removed).toBe(3);
    top = (await api("GET", `/v1/games/${s.game}/leaderboards/time`, { key: s.key })).json;
    expect(top.entries.map((e: any) => e.score)).toEqual([61.2]);
    const boards = (await api("GET", `/v1/games/${s.game}/leaderboards`, { token: s.dev })).json.boards;
    expect(boards).toEqual([expect.objectContaining({ board: "time", higher_is_better: false, plays: 3 })]);

    expect((await submit(s, a, Number.NaN as any)).status).toBe(400);
    expect((await api("POST", `/v1/games/${s.game}/leaderboards/altitude`, { key: s.key, token: a, body: { score: "9" } })).status).toBe(400);
    expect((await submit(s, a, 1, { nested: { x: 1 } })).status).toBe(400);
    expect((await submit(s, a, 1, {}, "Bad Board")).status).toBe(400);
    expect((await api("POST", `/v1/games/${s.game}/leaderboards/altitude`, { key: s.key, body: { score: 1 } })).status).toBe(401);
    const other = await setup();
    expect((await api("GET", `/v1/games/${s.game}/leaderboards/time`, { key: other.key })).status).toBe(404);
    expect((await api("GET", `/v1/games/${s.game}/leaderboards/time?period=monthly`, { key: s.key })).status).toBe(400);
  });

  it("a guest's scores merge into the account it signs in to; deleted players vanish", async () => {
    const s = await setup();
    const subject = `s${uniq()}`;
    const account = (await api("POST", "/v1/players/login", { key: s.key, body: { provider: "fake", subject, display_name: "Ada" } })).json.player_token;
    await submit(s, account, 100);
    const g = await guest(s.key, "Guest");
    await submit(s, g, 300);
    const merged = await api("POST", "/v1/players/login", { key: s.key, token: g, body: { provider: "fake", subject } });
    expect(merged.json.merged).toBe(true);
    const top = (await api("GET", `/v1/games/${s.game}/leaderboards/altitude`, { key: s.key, token: account })).json;
    expect(top.entries.map((e: any) => [e.display_name, e.score])).toEqual([["Ada", 300]]);
    expect(top.me).toMatchObject({ score: 300, plays: 2 });
    await api("DELETE", "/v1/players/me", { key: s.key, token: account });
    expect((await api("GET", `/v1/games/${s.game}/leaderboards/altitude`, { key: s.key })).json.entries).toEqual([]);
  });

  it("weeks start on Monday (UTC)", () => {
    const mon = Date.UTC(2026, 9, 12, 0, 0, 1);
    const sun = Date.UTC(2026, 9, 11, 23, 59, 59);
    const thu = Date.UTC(2026, 9, 15, 12);
    expect(periodKey("weekly", mon)).not.toBe(periodKey("weekly", sun));
    expect(periodKey("weekly", mon)).toBe(periodKey("weekly", thu));
    expect(periodKey("all", mon)).toBe("all");
  });
});

import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

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
const ADMIN = "dev-admin-token";

async function signUp(email = `new${uniq()}@example.com`) {
  const start = await api("POST", "/v1/developers/login/start", { body: { email } });
  expect(start.json).toMatchObject({ ok: true, sent: false, new_developer: true });
  const bad = await api("POST", "/v1/developers/login", { body: { email, code: "000000" === start.json.code ? "111111" : "000000" } });
  expect(bad.json.error.code).toBe("bad_code");
  const r = await api("POST", "/v1/developers/login", { body: { email, code: start.json.code, name: "Nova" } });
  expect(r.json).toMatchObject({ ok: true, created: true, developer: { email, trusted: false } });
  return { email, token: r.json.token as string, id: r.json.developer.id as string };
}

describe("developer sign-up and review", () => {
  it("an email code makes a developer; a second sign-in gives another token for the same one", async () => {
    const d = await signUp();
    const me = await api("GET", "/v1/me", { token: d.token });
    expect(me.json).toMatchObject({ developer: { id: d.id, trusted: false }, limits: { projects: 5, games: 20, paid: false } });
    const again = await api("POST", "/v1/developers/login/start", { body: { email: d.email } });
    expect(again.json.new_developer).toBe(false);
    const r = await api("POST", "/v1/developers/login", { body: { email: d.email, code: again.json.code } });
    expect(r.json).toMatchObject({ created: false, developer: { id: d.id } });
    // The code is single use.
    expect((await api("POST", "/v1/developers/login", { body: { email: d.email, code: again.json.code } })).json.error.code).toBe("code_expired");
  });

  it("a new developer's game publishes into review, free only; approval puts it on the store", async () => {
    const d = await signUp();
    const project = `np${uniq()}`;
    expect((await api("PUT", `/v1/projects/${project}`, { token: d.token, body: { name: "Nova Games" } })).json.ok).toBe(true);
    const game = `nova-${uniq()}`;
    const paid = await api("PUT", `/v1/games/${game}`, { token: d.token, body: { project, title: "Nova", price_cents: 499, platforms: ["web"] } });
    expect(paid.json.error.code).toBe("paid_later");
    expect((await api("PUT", `/v1/games/${game}`, { token: d.token, body: { project, title: "Nova", platforms: ["web"] } })).json.ok).toBe(true);
    const pub = await api("POST", `/v1/games/${game}/publish`, { token: d.token });
    expect(pub.json).toMatchObject({ in_review: true, game: { status: "draft", review: { status: "pending" } } });
    expect((await api("GET", "/v1/store/games")).json.games.some((g: any) => g.id === game)).toBe(false);

    const queue = (await api("GET", "/v1/admin/games/review", { token: ADMIN })).json.games;
    expect(queue.find((g: any) => g.id === game)).toMatchObject({ developer: { email: d.email } });
    expect((await api("POST", `/v1/admin/games/${game}/review`, { token: ADMIN, body: { verdict: "reject" } })).status).toBe(400);
    const rej = await api("POST", `/v1/admin/games/${game}/review`, { token: ADMIN, body: { verdict: "reject", note: "the title screen is blank" } });
    expect(rej.json.game).toMatchObject({ status: "draft", review: { status: "rejected", note: "the title screen is blank" } });
    expect((await api("GET", `/v1/games/${game}`, { token: d.token })).json.game.review.note).toBe("the title screen is blank");

    await api("POST", `/v1/games/${game}/publish`, { token: d.token });
    const ok = await api("POST", `/v1/admin/games/${game}/review`, { token: ADMIN, body: { verdict: "approve" } });
    expect(ok.json.game).toMatchObject({ status: "published", review: { status: "approved" } });
    expect((await api("GET", "/v1/store/games")).json.games.some((g: any) => g.id === game)).toBe(true);
    // Approved once: unpublish and publish again without another review.
    await api("POST", `/v1/games/${game}/unpublish`, { token: d.token });
    expect((await api("POST", `/v1/games/${game}/publish`, { token: d.token })).json.game.status).toBe("published");
  });

  it("trusting a developer lets them publish straight away and charge", async () => {
    const d = await signUp();
    const project = `tp${uniq()}`;
    await api("PUT", `/v1/projects/${project}`, { token: d.token, body: {} });
    const list = (await api("GET", "/v1/admin/developers", { token: ADMIN })).json.developers;
    expect(list.find((x: any) => x.id === d.id)).toMatchObject({ trusted: false, signup: "email", projects: 1 });
    expect((await api("POST", `/v1/admin/developers/${d.email}/trust`, { token: ADMIN, body: { trusted: true } })).json.developer.trusted).toBe(true);
    const game = `trusted-${uniq()}`;
    expect((await api("PUT", `/v1/games/${game}`, { token: d.token, body: { project, title: "T", price_cents: 299 } })).json.ok).toBe(true);
    expect((await api("POST", `/v1/games/${game}/publish`, { token: d.token })).json.game.status).toBe("published");
  });

  it("the admin overview has every game, daily totals and developers", async () => {
    const d = await signUp();
    const project = `ov${uniq()}`;
    await api("PUT", `/v1/projects/${project}`, { token: d.token, body: {} });
    const key = (await api("POST", `/v1/projects/${project}/keys`, { token: d.token, body: { key_id: "game" } })).json.key.key as string;
    const game = `ov-${uniq()}`;
    await api("PUT", `/v1/games/${game}`, { token: d.token, body: { project, title: "Overview" } });
    const t = Date.now();
    await api("POST", `/v1/games/${game}/events`, { key, body: { device: `ovdev-${uniq()}`, platform: "web", events: [{ name: "session_start", at: t - 1000, session: "s1" }, { name: "session_end", at: t, session: "s1", props: { secs: 90 } }] } });
    expect((await api("GET", "/v1/admin/overview", { token: d.token })).status).toBe(401);
    const o = (await api("GET", "/v1/admin/overview?days=7", { token: ADMIN })).json;
    expect(o.range.days).toBe(7);
    expect(o.daily).toHaveLength(7);
    expect(o.totals.developers).toBeGreaterThan(0);
    expect(o.games.find((g: any) => g.id === game)).toMatchObject({ dau: 1, wau: 1, new_players: 1, sessions: 1, play_secs: 90, avg_session_secs: 90, developer: { email: d.email, trusted: false } });
    expect(o.daily[6].by_game[game]).toBe(1);
  });
});

import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256hex } from "../src/api/core";
import { uploadTicket } from "../src/api/ugc";

type Opts = { token?: string; key?: string; body?: unknown; raw?: BodyInit };

async function api(method: string, path: string, o: Opts = {}) {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.key) headers["x-partii-key"] = o.key;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await SELF.fetch(path.startsWith("http") ? path : `https://edge${path}`, { method, headers, body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, json: type.includes("json") ? ((await res.json()) as any) : null, res };
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${n++}`;

/** A developer with a project, a key and a game. */
async function setup() {
  const dev = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `ugc${uniq()}@example.com`, name: "Dev" } })).json.token as string;
  const project = `p${uniq()}`;
  await api("PUT", `/v1/projects/${project}`, { token: dev, body: { name: "Proj" } });
  const key = (await api("POST", `/v1/projects/${project}/keys`, { token: dev, body: { key_id: "web", name: "web" } })).json.key.key as string;
  const game = `g-${project}`;
  expect((await api("PUT", `/v1/games/${game}`, { token: dev, body: { project, title: "Tankii", price_cents: 0, platforms: ["macos"] } })).json.ok).toBe(true);
  return { dev, key, game };
}

async function signedIn(key: string, name = "Ada") {
  const r = await api("POST", "/v1/players/login", { key, body: { provider: "fake", subject: `s${uniq()}`, display_name: name } });
  return r.json.player_token as string;
}
async function guest(key: string) {
  return (await api("POST", "/v1/players/guest", { key, body: { device_id: `device-${uniq()}` } })).json.player_token as string;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** Upload through the Worker (the path used when there are no R2 S3 credentials). */
async function upload(key: string, token: string, game: string, data: string | Uint8Array, kind = "file") {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const sha = await sha256hex(bytes);
  const start = await api("POST", `/v1/games/${game}/ugc/uploads`, { key, token, body: { kind, size: bytes.byteLength, sha256: sha } });
  expect(start.json.ok).toBe(true);
  if (!start.json.exists) {
    const ticket = await uploadTicket(env as any, { g: game, h: sha, s: bytes.byteLength, exp: Date.now() + 60_000 });
    const put = await api("PUT", `/v1/games/${game}/ugc/blobs/${sha}?ticket=${encodeURIComponent(ticket)}`, { raw: bytes });
    expect(put.json).toMatchObject({ ok: true, stored: true });
  }
  return sha;
}

async function publish(s: { key: string; game: string }, token: string, fields: Record<string, unknown> = {}) {
  const sha = await upload(s.key, token, s.game, JSON.stringify({ level: uniq() }));
  const r = await api("POST", `/v1/games/${s.game}/ugc`, { key: s.key, token, body: { kind: "level", title: "Canyon run", client_version: "0.9.1", sha256: sha, ...fields } });
  expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
  return r.json.item;
}

describe("player content: uploads", () => {
  it("signs a direct R2 PUT with the checksum, and says when the hash is already stored", async () => {
    const s = await setup();
    const t = await signedIn(s.key);
    const sha = await sha256hex("abc");
    const r = await api("POST", `/v1/games/${s.game}/ugc/uploads`, { key: s.key, token: t, body: { size: 3, sha256: sha } });
    expect(r.json.exists).toBe(false);
    expect(r.json.upload.url).toContain(`ugc/${s.game}/${sha}`);
    expect(r.json.upload.url).toContain("X-Amz-Signature");
    expect(r.json.upload.headers["x-amz-checksum-sha256"]).toBeTruthy();
    await upload(s.key, t, s.game, "abc");
    expect((await api("POST", `/v1/games/${s.game}/ugc/uploads`, { key: s.key, token: t, body: { size: 3, sha256: sha } })).json.exists).toBe(true);
  });

  it("refuses guests, oversize files, bad tickets and bytes that don't match", async () => {
    const s = await setup();
    const g = await guest(s.key);
    const sha = await sha256hex("abc");
    expect((await api("POST", `/v1/games/${s.game}/ugc/uploads`, { key: s.key, token: g, body: { size: 3, sha256: sha } })).json.error.code).toBe("sign_in_required");
    const t = await signedIn(s.key);
    expect((await api("POST", `/v1/games/${s.game}/ugc/uploads`, { key: s.key, token: t, body: { size: 6 * 1024 * 1024, sha256: sha } })).status).toBe(400);
    expect((await api("PUT", `/v1/games/${s.game}/ugc/blobs/${sha}?ticket=ut_x.y`, { raw: "abc" })).status).toBe(401);
    const ticket = await uploadTicket(env as any, { g: s.game, h: sha, s: 3, exp: Date.now() + 60_000 });
    expect((await api("PUT", `/v1/games/${s.game}/ugc/blobs/${sha}?ticket=${encodeURIComponent(ticket)}`, { raw: "abd" })).status).toBe(400);
  });
});

describe("player content: publish, versions, fetch", () => {
  it("publishes, fetches by id, share code and hash, and downloads the bytes", async () => {
    const s = await setup();
    const t = await signedIn(s.key, "Ada");
    const thumb = await upload(s.key, t, s.game, PNG, "thumbnail");
    const it1 = await publish(s, t, { tags: ["Desert", "hard"], description: "A long canyon", thumbnail_sha256: thumb });
    expect(it1).toMatchObject({ kind: "level", title: "Canyon run", tags: ["desert", "hard"], version: 1, author: { display_name: "Ada" }, visibility: "public" });
    expect(it1.share_code).toMatch(/^[A-Z2-9]{6}$/);
    const got = await api("GET", `/v1/ugc/${it1.id}`, { key: s.key });
    expect(got.json.item.versions).toHaveLength(1);
    expect((await api("GET", `/v1/games/${s.game}/ugc/code/${it1.share_code.toLowerCase()}`, { key: s.key })).json.item.id).toBe(it1.id);
    expect((await api("GET", `/v1/games/${s.game}/ugc/hash/${it1.sha256}`, { key: s.key })).json.versions[0]).toMatchObject({ item_id: it1.id, version: 1 });
    const dl = await SELF.fetch(it1.download_url);
    expect(dl.headers.get("cache-control")).toContain("immutable");
    expect(await sha256hex(await dl.arrayBuffer())).toBe(it1.sha256);
    const th = await SELF.fetch(it1.thumbnail_url);
    expect(th.headers.get("content-type")).toBe("image/png");
  });

  it("checks what it publishes: uploaded file, PNG thumbnails, kinds, refs", async () => {
    const s = await setup();
    const t = await signedIn(s.key);
    const missing = await api("POST", `/v1/games/${s.game}/ugc`, { key: s.key, token: t, body: { kind: "level", title: "x", client_version: "1", sha256: "a".repeat(64) } });
    expect(missing.json.error.code).toBe("not_uploaded");
    const notPng = await upload(s.key, t, s.game, "not a png", "thumbnail");
    const sha = await upload(s.key, t, s.game, "{}");
    expect((await api("POST", `/v1/games/${s.game}/ugc`, { key: s.key, token: t, body: { kind: "level", title: "x", client_version: "1", sha256: sha, thumbnail_sha256: notPng } })).status).toBe(400);
    expect((await api("POST", `/v1/games/${s.game}/ugc`, { key: s.key, token: t, body: { kind: "map", title: "x", client_version: "1", sha256: sha } })).status).toBe(400);
    expect((await api("POST", `/v1/games/${s.game}/ugc`, { key: s.key, token: t, body: { kind: "world", title: "w", client_version: "1", sha256: sha, refs: ["b".repeat(64)] } })).json.error.code).toBe("not_uploaded");
  });

  it("versions: a World pins old Level versions, which stay downloadable", async () => {
    const s = await setup();
    const t = await signedIn(s.key);
    const level = await publish(s, t);
    const v2sha = await upload(s.key, t, s.game, '{"level":"v2"}');
    const world = await publish(s, t, { kind: "world", title: "Isles", refs: [level.sha256] });
    const v2 = await api("POST", `/v1/ugc/${level.id}/versions`, { key: s.key, token: t, body: { sha256: v2sha, client_version: "0.9.2", notes: "wider" } });
    expect(v2.json.item).toMatchObject({ version: 2, sha256: v2sha });
    expect(v2.json.item.versions.map((v: any) => v.version)).toEqual([2, 1]);
    expect((await SELF.fetch(level.download_url)).status).toBe(200);
    const w = await api("GET", `/v1/ugc/${world.id}`, { key: s.key });
    expect(w.json.item.versions[0].refs).toEqual([level.sha256]);
    // Only the author can change it.
    const other = await signedIn(s.key, "Eve");
    expect((await api("POST", `/v1/ugc/${level.id}/versions`, { key: s.key, token: other, body: { sha256: v2sha, client_version: "1" } })).status).toBe(403);
    expect((await api("PATCH", `/v1/ugc/${level.id}`, { key: s.key, token: other, body: { title: "mine" } })).status).toBe(403);
  });
});

describe("player content: browse", () => {
  it("lists public items by new, top and played, with kind, tags, search and pages", async () => {
    const s = await setup();
    const t = await signedIn(s.key);
    const a = await publish(s, t, { title: "Lava lake", tags: ["fire"] });
    const b = await publish(s, t, { title: "Frozen pass", tags: ["ice", "hard"] });
    const c = await publish(s, t, { title: "Secret", visibility: "unlisted" });
    const r = await publish(s, t, { kind: "replay", title: "Triple kill" });
    const list = async (q: string) => (await api("GET", `/v1/games/${s.game}/ugc?${q}`, { key: s.key })).json;
    expect((await list("")).items.map((x: any) => x.id)).toEqual([r.id, b.id, a.id]);
    expect((await list("kind=level")).items.map((x: any) => x.id)).toEqual([b.id, a.id]);
    expect((await list("tags=ice,hard")).items.map((x: any) => x.id)).toEqual([b.id]);
    expect((await list("q=lav")).items.map((x: any) => x.id)).toEqual([a.id]);
    expect((await list("q=secret")).items).toEqual([]);
    const p1 = await list("limit=2");
    expect(p1.items).toHaveLength(2);
    const p2 = await list(`limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`);
    expect(p2.items.map((x: any) => x.id)).toEqual([a.id]);
    expect(p2.next_cursor).toBeNull();
    // Votes and plays from other players.
    for (let i = 0; i < 2; i++) {
      const v = await guest(s.key);
      await api("PUT", `/v1/ugc/${a.id}/vote`, { key: s.key, token: v, body: { value: 1 } });
      await api("POST", `/v1/ugc/${a.id}/plays`, { key: s.key, token: v });
    }
    await api("PUT", `/v1/ugc/${b.id}/vote`, { key: s.key, token: await guest(s.key), body: { value: -1 } });
    expect((await list("sort=top")).items.map((x: any) => x.id)).toEqual([a.id, r.id, b.id]);
    expect((await list("sort=played")).items[0]).toMatchObject({ id: a.id, plays: 2 });
    expect(c.id).toBeTruthy();
  });

  it("votes are one per player, can change and clear; plays count players", async () => {
    const s = await setup();
    const a = await publish(s, await signedIn(s.key));
    const g = await guest(s.key);
    expect((await api("PUT", `/v1/ugc/${a.id}/vote`, { key: s.key, token: g, body: { value: 1 } })).json.votes).toEqual({ up: 1, down: 0, score: 1 });
    expect((await api("PUT", `/v1/ugc/${a.id}/vote`, { key: s.key, token: g, body: { value: 1 } })).json.votes).toEqual({ up: 1, down: 0, score: 1 });
    expect((await api("PUT", `/v1/ugc/${a.id}/vote`, { key: s.key, token: g, body: { value: -1 } })).json.votes).toEqual({ up: 0, down: 1, score: -1 });
    expect((await api("GET", `/v1/ugc/${a.id}`, { key: s.key, token: g })).json.item.my_vote).toBe(-1);
    expect((await api("PUT", `/v1/ugc/${a.id}/vote`, { key: s.key, token: g, body: { value: 0 } })).json.votes).toEqual({ up: 0, down: 0, score: 0 });
    expect((await api("POST", `/v1/ugc/${a.id}/plays`, { key: s.key, token: g })).json.counted).toBe(true);
    expect((await api("POST", `/v1/ugc/${a.id}/plays`, { key: s.key, token: g })).json.counted).toBe(false);
    expect((await api("GET", `/v1/ugc/${a.id}`, { key: s.key })).json.item.plays).toBe(1);
  });
});

describe("player content: unpublish and moderation", () => {
  it("an unpublished item leaves browse and lookups, but its pinned file still downloads", async () => {
    const s = await setup();
    const t = await signedIn(s.key);
    const a = await publish(s, t);
    expect((await api("DELETE", `/v1/ugc/${a.id}`, { key: s.key, token: t })).json.deleted).toBe(true);
    expect((await api("GET", `/v1/ugc/${a.id}`, { key: s.key })).status).toBe(404);
    expect((await api("GET", `/v1/games/${s.game}/ugc`, { key: s.key })).json.items).toEqual([]);
    expect((await api("GET", `/v1/players/me/ugc?game=${s.game}`, { key: s.key, token: t })).json.items).toEqual([]);
    expect((await SELF.fetch(a.download_url)).status).toBe(200);
    expect((await api("GET", `/v1/games/${s.game}/ugc/hash/${a.sha256}`, { key: s.key })).json.versions[0].unpublished).toBe(true);
  });

  it("reports reach the developer, who can hide an item and its files, and bring it back", async () => {
    const s = await setup();
    const t = await signedIn(s.key);
    const a = await publish(s, t);
    const g = await guest(s.key);
    expect((await api("POST", `/v1/ugc/${a.id}/report`, { key: s.key, token: g, body: { reason: "offensive name" } })).json.reported).toBe(true);
    const reports = await api("GET", `/v1/games/${s.game}/ugc/reports`, { token: s.dev });
    expect(reports.json.items[0]).toMatchObject({ id: a.id, reports: [{ reason: "offensive name" }] });
    // Another developer can't moderate it; the operator can.
    const stranger = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `x${uniq()}@example.com` } })).json.token;
    expect((await api("POST", `/v1/ugc/${a.id}/moderate`, { token: stranger, body: { action: "hide" } })).status).toBe(404);
    expect((await api("POST", `/v1/ugc/${a.id}/moderate`, { token: s.dev, body: { action: "hide", reason: "name" } })).json.item.hidden).toBe(true);
    expect((await api("GET", `/v1/ugc/${a.id}`, { key: s.key })).status).toBe(404);
    expect((await SELF.fetch(a.download_url)).status).toBe(404);
    expect((await api("GET", `/v1/players/me/ugc`, { key: s.key, token: t })).json.items[0]).toMatchObject({ hidden: true, hidden_reason: "name" });
    expect((await api("GET", `/v1/games/${s.game}/ugc/reports`, { token: s.dev })).json.items).toEqual([]);
    expect((await api("POST", `/v1/admin/ugc/${a.id}/moderate`, { token: "dev-admin-token", body: { action: "unhide" } })).json.item.hidden).toBe(false);
    expect((await SELF.fetch(a.download_url)).status).toBe(200);
  });

  it("a guest's votes follow it into the account it signs in to; deleting an account unpublishes its items", async () => {
    const s = await setup();
    const t = await signedIn(s.key);
    const a = await publish(s, t);
    const subject = `m${uniq()}`;
    const acct = (await api("POST", "/v1/players/login", { key: s.key, body: { provider: "fake", subject } })).json.player_token;
    const g = await guest(s.key);
    await api("PUT", `/v1/ugc/${a.id}/vote`, { key: s.key, token: acct, body: { value: 1 } });
    await api("PUT", `/v1/ugc/${a.id}/vote`, { key: s.key, token: g, body: { value: 1 } });
    await api("POST", `/v1/ugc/${a.id}/plays`, { key: s.key, token: g });
    expect((await api("GET", `/v1/ugc/${a.id}`, { key: s.key })).json.item.votes.up).toBe(2);
    // The guest signs in to the existing account: one player, one vote.
    const merged = await api("POST", "/v1/players/login", { key: s.key, token: g, body: { provider: "fake", subject } });
    expect(merged.json.merged).toBe(true);
    const after = (await api("GET", `/v1/ugc/${a.id}`, { key: s.key, token: merged.json.player_token })).json.item;
    expect(after).toMatchObject({ votes: { up: 1, down: 0, score: 1 }, plays: 1, my_vote: 1 });
    expect((await api("DELETE", "/v1/players/me", { key: s.key, token: t })).json.deleted).toBe(true);
    expect((await api("GET", `/v1/ugc/${a.id}`, { key: s.key })).status).toBe(404);
  });
});

describe("player content switch", () => {
  it("without UGC=on (production for now) the routes answer not_available; other routes are unaffected", async () => {
    const { Hono } = await import("hono");
    const { registerApi } = await import("../src/api");
    const app = new Hono();
    registerApi(app as any);
    const off = { ...(env as any), UGC: undefined };
    const r = await app.request("/v1/games/tankii/ugc", {}, off);
    expect(r.status).toBe(404);
    expect(((await r.json()) as any).error.code).toBe("not_available");
    expect((await app.request("/v1/admin/ugc/u_x/moderate", { method: "POST" }, off)).status).toBe(404);
    expect((await app.request("/health", {}, off)).status).toBe(200);
  });
});

describe("player content: review queue (the moderator)", () => {
  const MOD = "dev-moderator-token";
  /** This item's pending entries. */
  async function pendingFor(id: string) {
    const all: any[] = [];
    let after = 0;
    for (;;) {
      const r = await api("GET", `/v1/admin/ugc/review?after=${after}&limit=50`, { token: MOD });
      expect(r.status).toBe(200);
      all.push(...r.json.entries);
      if (r.json.entries.length < 50) break;
      after = r.json.entries.at(-1).seq;
    }
    return all.filter((e) => e.item.id === id);
  }

  it("queues new items, versions and edits; the moderator token reviews but can't do other admin work", async () => {
    const s = await setup();
    const t = await signedIn(s.key);
    const thumb = await upload(s.key, t, s.game, PNG, "thumbnail");
    const it1 = await publish(s, t, { thumbnail_sha256: thumb });
    let q = await pendingFor(it1.id);
    expect(q.map((e) => e.cause)).toEqual(["new"]);
    expect(q[0].item.title).toBe("Canyon run");
    // The moderator can fetch the file and thumbnail.
    const file = await api("GET", q[0].file_url, { token: MOD });
    expect(file.status).toBe(200);
    expect((await api("GET", q[0].thumbnail_url, { token: MOD })).res.headers.get("content-type")).toBe("image/png");
    expect((await api("GET", q[0].file_url)).status).toBe(401);
    // A version and a text edit each queue; changing nothing reviewable doesn't.
    const sha2 = await upload(s.key, t, s.game, JSON.stringify({ level: uniq() }));
    await api("POST", `/v1/ugc/${it1.id}/versions`, { key: s.key, token: t, body: { sha256: sha2, client_version: "0.9.2" } });
    await api("PATCH", `/v1/ugc/${it1.id}`, { key: s.key, token: t, body: { title: "Canyon run 2" } });
    await api("PATCH", `/v1/ugc/${it1.id}`, { key: s.key, token: t, body: { visibility: "unlisted" } });
    q = await pendingFor(it1.id);
    expect(q.map((e) => e.cause)).toEqual(["new", "version", "edit"]);
    // ok settles every open entry for the item.
    const ok = await api("POST", `/v1/admin/ugc/review/${q[0].seq}`, { token: MOD, body: { verdict: "ok" } });
    expect(ok.json.item.title).toBe("Canyon run 2");
    expect(await pendingFor(it1.id)).toEqual([]);
    // The moderator's token is for review only.
    expect((await api("GET", "/v1/admin/usage", { token: MOD })).status).toBe(401);
    expect((await api("POST", "/v1/admin/developers", { token: MOD, body: { email: `x${uniq()}@example.com` } })).status).toBe(401);
  });

  it("hide needs a reason the author sees; files go with it", async () => {
    const s = await setup();
    const t = await signedIn(s.key);
    const it1 = await publish(s, t);
    const [e] = await pendingFor(it1.id);
    expect((await api("POST", `/v1/admin/ugc/review/${e.seq}`, { token: MOD, body: { verdict: "hide" } })).status).toBe(400);
    const hid = await api("POST", `/v1/admin/ugc/review/${e.seq}`, { token: MOD, body: { verdict: "hide", reason: "sexual content (rule 1)" } });
    expect(hid.json.item.hidden_reason).toBe("sexual content (rule 1)");
    expect((await api("GET", `/v1/ugc/${it1.id}`, { key: s.key })).status).toBe(404);
    expect((await api("GET", it1.download_url)).status).toBe(404);
    const mine = await api("GET", `/v1/players/me/ugc`, { key: s.key, token: t });
    expect(mine.json.items[0].hidden_reason).toBe("sexual content (rule 1)");
  });

  it("three players reporting an item hide it until the moderator decides; ok brings it back", async () => {
    const s = await setup();
    const author = await signedIn(s.key);
    const it1 = await publish(s, author);
    for (let i = 0; i < 3; i++) {
      const r = await api("POST", `/v1/ugc/${it1.id}/report`, { key: s.key, token: await signedIn(s.key, `R${i}`), body: { reason: "nsfw" } });
      expect(r.json.reported).toBe(true);
      expect((await api("GET", `/v1/ugc/${it1.id}`, { key: s.key })).status).toBe(i < 2 ? 200 : 404);
    }
    const q = await pendingFor(it1.id);
    expect(q.filter((e) => e.cause === "reports").length).toBe(3);
    expect(q.at(-1).reports.length).toBe(3);
    expect(q.at(-1).item.hidden_reason).toContain("waiting for review");
    // Still reviewable while hidden.
    expect((await api("GET", q.at(-1).file_url, { token: MOD })).status).toBe(200);
    await api("POST", `/v1/admin/ugc/review/${q.at(-1).seq}`, { token: MOD, body: { verdict: "ok", reason: "a normal level" } });
    expect((await api("GET", `/v1/ugc/${it1.id}`, { key: s.key })).status).toBe(200);
    expect(await pendingFor(it1.id)).toEqual([]);
  });
});

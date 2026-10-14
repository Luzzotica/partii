import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256hex } from "../src/api/core";
import { workerUploadUrl } from "../src/api/web";

async function api(method: string, path: string, o: { token?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await SELF.fetch(path.startsWith("http") ? path : `https://edge${path}`, { method, headers, body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined), redirect: "manual" });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, res, json: type.includes("application/json") && !path.includes(".localhost") ? ((await res.json()) as any) : null, text: type.includes("application/json") && !path.includes(".localhost") ? "" : await res.text() };
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${n++}`;

async function setup() {
  const dev = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `web${uniq()}@example.com`, name: "Dev" } })).json.token as string;
  const project = `p${uniq()}`;
  await api("PUT", `/v1/projects/${project}`, { token: dev, body: { name: "Proj" } });
  const game = `w${uniq()}`;
  await api("PUT", `/v1/games/${game}`, { token: dev, body: { project, title: "Hexii", price_cents: 0, platforms: ["web"] } });
  return { dev, game };
}

/** What `partii web deploy` does: start, upload what's missing, finish. */
async function deploy(s: { dev: string; game: string }, site: Record<string, string>, opts: Record<string, unknown> = {}) {
  const bytes = Object.fromEntries(Object.entries(site).map(([p, c]) => [p, new TextEncoder().encode(c)]));
  const files: Record<string, { sha256: string; size: number }> = {};
  for (const [p, b] of Object.entries(bytes)) files[p] = { sha256: await sha256hex(b), size: b.byteLength };
  const start = await api("POST", `/v1/games/${s.game}/web/deploys`, { token: s.dev, body: { files, ...opts } });
  expect(start.json.ok, JSON.stringify(start.json)).toBe(true);
  const missing: string[] = start.json.missing;
  if (missing.length) {
    const ups = await api("POST", `/v1/games/${s.game}/web/deploys/${start.json.deploy.id}/uploads`, { token: s.dev, body: { sha256: missing } });
    for (const u of ups.json.uploads) {
      const p = Object.keys(files).find((k) => files[k].sha256 === u.sha256)!;
      // Tests have R2 credentials but can't reach R2: upload through the Worker instead.
      expect(u.url).toMatch(/X-Amz-Signature|ticket=/);
      const url = u.url.startsWith("https://edge/") ? u.url : await workerUploadUrl(env as any, "https://edge", s.game, u.sha256, bytes[p].byteLength);
      const put = await api("PUT", url, { raw: bytes[p] });
      expect(put.json.stored).toBe(true);
    }
  }
  let fin;
  do fin = await api("POST", `/v1/games/${s.game}/web/deploys/${start.json.deploy.id}/finish`, { token: s.dev, body: { activate: opts.activate } });
  while (fin.json.done === false && !fin.json.not_uploaded);
  return { id: start.json.deploy.id as string, missing, fin: fin.json };
}

const site = (game: string, path = "") => `https://${game}.localhost/${path}`;

describe("web hosting", () => {
  it("deploys a folder and serves it at <game>.partii.games; only changed files upload", async () => {
    const s = await setup();
    const d1 = await deploy(s, { "index.html": "<h1>v1</h1>", "game.js": "console.log(1)", "assets/logo.png": "png-bytes", "game.wasm": "wasm" });
    expect(d1.fin.done).toBe(true);
    expect(d1.fin.url).toBe(`http://${s.game}.localhost:8787/`);
    expect(d1.missing.length).toBe(4);
    const home = await api("GET", site(s.game));
    expect(home.status).toBe(200);
    expect(home.text).toBe("<h1>v1</h1>");
    expect(home.res.headers.get("content-type")).toContain("text/html");
    expect(home.res.headers.get("cache-control")).toBe("no-cache");
    expect((await api("GET", site(s.game, "game.wasm"))).res.headers.get("content-type")).toBe("application/wasm");
    expect((await api("GET", site(s.game, "assets/logo.png"))).text).toBe("png-bytes");
    // ETags: unchanged files answer 304.
    const etag = home.res.headers.get("etag")!;
    expect((await api("GET", site(s.game), { headers: { "if-none-match": etag } })).status).toBe(304);
    // A second deploy uploads only what changed.
    const d2 = await deploy(s, { "index.html": "<h1>v2</h1>", "game.js": "console.log(1)", "assets/logo.png": "png-bytes", "game.wasm": "wasm" });
    expect(d2.missing.length).toBe(1);
    expect((await api("GET", site(s.game))).text).toBe("<h1>v2</h1>");
    // The API isn't served on a game's host; the site isn't served on the API host.
    expect((await api("GET", site(s.game, "v1/games"))).status).toBe(404);
  });

  it("rollback, preview before going live, take-down", async () => {
    const s = await setup();
    const d1 = await deploy(s, { "index.html": "one" });
    const d2 = await deploy(s, { "index.html": "two" }, { activate: false });
    // Not live yet, but previewable.
    expect((await api("GET", site(s.game))).text).toBe("one");
    expect((await api("GET", site(`${d2.id}--${s.game}`))).text).toBe("two");
    const list = await api("GET", `/v1/games/${s.game}/web/deploys`, { token: s.dev });
    expect(list.json.live).toBe(d1.id);
    expect(list.json.deploys.map((d: any) => d.id)).toEqual([d2.id, d1.id]);
    await api("POST", `/v1/games/${s.game}/web/deploys/${d2.id}/activate`, { token: s.dev });
    // The isolate's cache is per process; a fresh lookup sees the new live deploy at once in this isolate.
    expect((await api("GET", site(s.game))).text).toBe("two");
    await api("POST", `/v1/games/${s.game}/web/deploys/${d1.id}/activate`, { token: s.dev });
    expect((await api("GET", site(s.game))).text).toBe("one");
    expect((await api("DELETE", `/v1/games/${s.game}/web`, { token: s.dev })).json.taken_down).toBe(true);
    expect((await api("GET", site(s.game))).status).toBe(404);
  });

  it("directories, spa fallback, 404.html, and cross-origin isolation", async () => {
    const s = await setup();
    await deploy(s, { "index.html": "root", "controller/index.html": "pad", "404.html": "custom 404" }, { spa: false });
    expect((await api("GET", site(s.game, "controller"))).status).toBe(301);
    expect((await api("GET", site(s.game, "controller/"))).text).toBe("pad");
    const miss = await api("GET", site(s.game, "nope"));
    expect(miss.status).toBe(404);
    expect(miss.text).toBe("custom 404");
    await deploy(s, { "index.html": "root", "controller/index.html": "pad" }, { spa: true, isolated: true });
    // A client-side route under /controller/ gets the controller's index.html.
    const route = await api("GET", site(s.game, "controller/c/ABCD"));
    expect(route.text).toBe("pad");
    expect(route.res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(route.res.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
    expect((await api("GET", site(s.game, "levels/3"))).text).toBe("root");
  });

  it("refuses bad deploys, other developers, unknown and reserved hosts", async () => {
    const s = await setup();
    const sha = await sha256hex("x");
    const start = (files: unknown, token = s.dev) => api("POST", `/v1/games/${s.game}/web/deploys`, { token, body: { files } });
    expect((await start({ "../etc/passwd": { sha256: sha, size: 1 }, "index.html": { sha256: sha, size: 1 } })).status).toBe(400);
    expect((await start({ "/abs.html": { sha256: sha, size: 1 } })).status).toBe(400);
    expect((await start({ "page.html": { sha256: sha, size: 1 } })).json.error.message).toContain("index.html");
    expect((await start({ "index.html": { sha256: "nothex", size: 1 } })).status).toBe(400);
    const stranger = (await api("POST", "/v1/admin/developers", { token: "dev-admin-token", body: { email: `x${uniq()}@example.com` } })).json.token;
    expect((await start({ "index.html": { sha256: sha, size: 1 } }, stranger)).status).toBe(404);
    // Finishing before uploading says what's missing.
    const d = await start({ "index.html": { sha256: sha, size: 1 } });
    const fin = await api("POST", `/v1/games/${s.game}/web/deploys/${d.json.deploy.id}/finish`, { token: s.dev, body: {} });
    expect(fin.json.done).toBe(false);
    expect(fin.json.not_uploaded).toEqual([sha]);
    // Uploads must match their hash.
    const ups = await api("POST", `/v1/games/${s.game}/web/deploys/${d.json.deploy.id}/uploads`, { token: s.dev, body: { sha256: [sha] } });
    expect(ups.json.uploads[0].headers["x-amz-checksum-sha256"] ?? "ticket").toBeTruthy();
    expect((await api("PUT", await workerUploadUrl(env as any, "https://edge", s.game, sha, 1), { raw: "y" })).status).toBe(400);
    // Hosts that aren't a site.
    expect((await api("GET", site("no-such-game"))).status).toBe(404);
    expect((await api("GET", "https://api.localhost/health")).status).toBe(200);
  });
});

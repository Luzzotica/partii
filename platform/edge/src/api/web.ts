// Web hosting for games: a developer deploys a folder (`partii web deploy
// <game> ./dist`) and it's served at https://<game>.partii.games (WEB_DOMAIN):
// browser games, custom phone controllers, anything static. Each game gets
// its own origin. Files are content-addressed in R2 (web/<game>/blobs/<sha>),
// so a deploy only uploads what changed; a deploy is a manifest of paths to
// hashes (web/<game>/deploys/<id>.json). One deploy is live per game;
// activating an older one is the rollback. Every deploy can be previewed at
// https://<id>--<game>.partii.games before it goes live.

import { AwsClient } from "aws4fetch";
import type { Env } from "../index";
import { files } from "../files";
import { ApiError, bad, now, ownGame, randomSlug, sha256hex, signClaims, verifyClaims } from "./core";
import { hexToB64 } from "./games";
import type { Handlers } from "./index";

export const WEB_LIMITS = { files: 10_000, fileBytes: 100 * 1024 * 1024, deployBytes: 1024 * 1024 * 1024, pathChars: 300, uploadsPerCall: 100, verifyPerCall: 40, keepDeploys: 20 };

/** Subdomains that are never a game's site. */
const RESERVED = new Set(["api", "api-staging", "www", "mail", "play", "admin", "store", "docs", "status", "cdn", "static", "app", "dev", "blog", "help", "support", "staging"]);

type FileEntry = { sha256: string; size: number };
type Options = { spa: boolean; isolated: boolean };
type Manifest = { files: Record<string, FileEntry>; options: Options; unverified: string[] };

const blobKey = (game: string, sha: string) => `web/${game}/blobs/${sha}`;
const manifestKey = (game: string, id: string) => `web/${game}/deploys/${id}.json`;

/** The site's address, and a deploy's preview address. */
export function siteUrl(env: Env, game: string, deploy?: string): string | null {
  if (!env.WEB_DOMAIN) return null;
  const label = deploy ? `${deploy}--${game}` : game;
  const local = env.WEB_DOMAIN === ".localhost";
  return `${local ? "http" : "https"}://${label}${env.WEB_DOMAIN}${local ? ":8787" : ""}/`;
}

/** A clean relative path: no leading slash, no "." or ".." segments, nothing odd. */
function cleanPath(p: string): string {
  if (p.length > WEB_LIMITS.pathChars || p.startsWith("/") || p.includes("\\") || p.includes("//")) throw bad(`bad path ${JSON.stringify(p.slice(0, 80))}`);
  const segs = p.split("/");
  if (segs.some((s) => s === "" || s === "." || s === ".." || !/^[A-Za-z0-9._@+~ ()[\]!,-]+$/.test(s))) throw bad(`bad path ${JSON.stringify(p.slice(0, 80))}`, "letters, digits and . _ - @ + ~ ( ) [ ] ! , and spaces");
  return p;
}

async function loadManifest(env: Env, game: string, id: string): Promise<Manifest | null> {
  const o = await files(env).get(manifestKey(game, id));
  return o ? (JSON.parse(await o.text()) as Manifest) : null;
}

const saveManifest = (env: Env, game: string, id: string, m: Manifest) => files(env).put(manifestKey(game, id), JSON.stringify(m), { contentType: "application/json" });

/** Which of these hashes the game already has stored. */
async function knownBlobs(env: Env, game: string, shas: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  for (let i = 0; i < shas.length; i += 90) {
    const chunk = shas.slice(i, i + 90);
    const r = await env.DB.prepare(`SELECT sha256 FROM web_blobs WHERE game_id = ? AND sha256 IN (${chunk.map(() => "?").join(",")})`).bind(game, ...chunk).all<{ sha256: string }>();
    for (const x of r.results) known.add(x.sha256);
  }
  return known;
}

type DeployRow = { id: string; game_id: string; status: string; files: number; bytes: number; options: string; note: string; created_at: number; finished_at: number | null };

function deployView(env: Env, d: DeployRow, live: string | null) {
  return { id: d.id, status: d.status, live: d.id === live, files: d.files, bytes: d.bytes, options: JSON.parse(d.options), note: d.note, created_at: d.created_at, finished_at: d.finished_at, preview_url: siteUrl(env, d.game_id, d.id) };
}

async function liveDeploy(env: Env, game: string): Promise<string | null> {
  return (await env.DB.prepare("SELECT deploy_id FROM web_sites WHERE game_id = ?").bind(game).first<{ deploy_id: string }>())?.deploy_id ?? null;
}

async function deployRow(env: Env, game: string, id: string): Promise<DeployRow> {
  const d = await env.DB.prepare("SELECT * FROM web_deploys WHERE id = ? AND game_id = ?").bind(id, game).first<DeployRow>();
  if (!d) throw new ApiError(404, "not_found", `no deploy ${id} for ${game}`);
  return d;
}

async function activate(env: Env, game: string, id: string) {
  await env.DB.prepare("INSERT INTO web_sites (game_id, deploy_id, updated_at) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET deploy_id = excluded.deploy_id, updated_at = excluded.updated_at").bind(game, id, now()).run();
  siteCache.delete(game);
  // Keep the newest deploys (and the live one); older manifests go. Blobs stay (shared across deploys).
  const old = await env.DB.prepare("SELECT id FROM web_deploys WHERE game_id = ? AND id <> ? ORDER BY created_at DESC LIMIT -1 OFFSET ?").bind(game, id, WEB_LIMITS.keepDeploys - 1).all<{ id: string }>();
  for (const o of old.results) {
    await files(env).delete(manifestKey(game, o.id));
    await env.DB.prepare("DELETE FROM web_deploys WHERE id = ?").bind(o.id).run();
  }
}

/** Where to PUT one blob: a signed R2 URL (checksum signed in), or a Worker URL with a ticket. */
async function uploadFor(env: Env, req: Request, game: string, sha: string, size: number) {
  if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ENDPOINT && env.R2_BUCKET) {
    const aws = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
    const url = new URL(`${env.R2_ENDPOINT.replace(/\/$/, "")}/${env.R2_BUCKET}/${blobKey(game, sha)}`);
    url.searchParams.set("X-Amz-Expires", "3600");
    const headers = { "x-amz-checksum-sha256": hexToB64(sha), "content-type": "application/octet-stream" };
    const signed = await aws.sign(new Request(url, { method: "PUT", headers }), { aws: { signQuery: true } });
    return { sha256: sha, url: signed.url, method: "PUT", headers };
  }
  return { sha256: sha, url: await workerUploadUrl(env, new URL(req.url).origin, game, sha, size), method: "PUT", headers: { "content-type": "application/octet-stream" } };
}

/** A Worker upload URL with a signed ticket (when there are no R2 S3 credentials). */
export async function workerUploadUrl(env: Env, origin: string, game: string, sha: string, size: number) {
  const ticket = await signClaims(env.KEY_SECRET, "wt", { g: game, h: sha, s: size, exp: now() + 3600_000 });
  return `${origin}/v1/games/${game}/web/blobs/${sha}?ticket=${encodeURIComponent(ticket)}`;
}

export const webHandlers: Handlers = {
  async webDeployStart({ env, caller, params, body, dryRun }) {
    await ownGame(env, caller, params.game);
    if (RESERVED.has(params.game) || params.game.endsWith("-staging") || params.game.includes("--")) throw bad(`${params.game} can't have a site (reserved name)`);
    const raw = body.files;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad("files is {path: {sha256, size}}");
    const entries = Object.entries(raw as Record<string, any>);
    if (!entries.length) throw bad("a deploy needs at least one file");
    if (entries.length > WEB_LIMITS.files) throw bad(`a deploy has at most ${WEB_LIMITS.files} files`);
    const filesOut: Record<string, FileEntry> = {};
    let bytes = 0;
    for (const [p, f] of entries) {
      const path = cleanPath(p);
      const sha = String(f?.sha256 ?? "").toLowerCase();
      const size = Number(f?.size);
      if (!/^[0-9a-f]{64}$/.test(sha)) throw bad(`${path}: sha256 is the file's hex digest`);
      if (!Number.isInteger(size) || size < 0 || size > WEB_LIMITS.fileBytes) throw bad(`${path}: files are at most ${WEB_LIMITS.fileBytes / 1024 / 1024} MB`);
      filesOut[path] = { sha256: sha, size };
      bytes += size;
    }
    if (bytes > WEB_LIMITS.deployBytes) throw bad(`a deploy is at most ${WEB_LIMITS.deployBytes / 1024 / 1024} MB`);
    if (!filesOut["index.html"]) throw bad("a site needs index.html at the top of the folder");
    const options: Options = { spa: body.spa === true, isolated: body.isolated === true };
    const unique = [...new Set(Object.values(filesOut).map((f) => f.sha256))];
    const known = await knownBlobs(env, params.game, unique);
    const missing = unique.filter((s) => !known.has(s));
    if (dryRun) return { dry_run: true, files: entries.length, bytes, missing: missing.length };
    const id = randomSlug(12);
    await saveManifest(env, params.game, id, { files: filesOut, options, unverified: missing });
    await env.DB.prepare("INSERT INTO web_deploys (id, game_id, status, files, bytes, options, note, created_at, created_by) VALUES (?, ?, 'uploading', ?, ?, ?, ?, ?, ?)")
      .bind(id, params.game, entries.length, bytes, JSON.stringify(options), String(body.note ?? "").slice(0, 200), now(), caller.developer!.id)
      .run();
    return { deploy: { id, files: entries.length, bytes }, missing };
  },

  async webDeployUploads({ env, req, caller, params, body }) {
    await ownGame(env, caller, params.game);
    const d = await deployRow(env, params.game, params.deploy);
    if (d.status !== "uploading") throw bad("this deploy is already finished");
    const m = (await loadManifest(env, params.game, d.id))!;
    const want = Array.isArray(body.sha256) ? (body.sha256 as unknown[]).map(String) : [];
    if (!want.length || want.length > WEB_LIMITS.uploadsPerCall) throw bad(`sha256 is a list of 1–${WEB_LIMITS.uploadsPerCall} hashes from missing`);
    const sizes = new Map(Object.values(m.files).map((f) => [f.sha256, f.size]));
    const uploads = [];
    for (const sha of want) {
      if (!m.unverified.includes(sha)) throw bad(`${sha.slice(0, 12)}… isn't missing from this deploy`);
      uploads.push(await uploadFor(env, req, params.game, sha, sizes.get(sha)!));
    }
    return { uploads };
  },

  async webBlobPut({ env, req, params, query }) {
    const t = await verifyClaims<{ g: string; h: string; s: number; exp: number }>(env.KEY_SECRET, "wt", String(query.ticket ?? ""));
    if (!t || t.g !== params.game || t.h !== params.sha256) throw new ApiError(401, "unauthorized", "this upload ticket is invalid or expired", "ask webDeployUploads again");
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength !== t.s) throw bad(`expected ${t.s} bytes, got ${bytes.byteLength}`);
    if ((await sha256hex(bytes)) !== t.h) throw bad("the bytes don't match their sha256");
    await files(env).put(blobKey(params.game, t.h), bytes, { contentType: "application/octet-stream" });
    await env.DB.prepare("INSERT OR IGNORE INTO web_blobs (game_id, sha256, size, created_at) VALUES (?, ?, ?, ?)").bind(params.game, t.h, t.s, now()).run();
    return { stored: true, sha256: t.h };
  },

  async webDeployFinish({ env, caller, params, body }) {
    await ownGame(env, caller, params.game);
    const d = await deployRow(env, params.game, params.deploy);
    const live = await liveDeploy(env, params.game);
    if (d.status === "ready") return { done: true, deploy: deployView(env, d, live), url: siteUrl(env, params.game) };
    const m = (await loadManifest(env, params.game, d.id))!;
    const sizes = new Map(Object.values(m.files).map((f) => [f.sha256, f.size]));
    // Check what was uploaded, a batch per call (storage lookups are limited per request).
    const already = await knownBlobs(env, params.game, m.unverified);
    const still: string[] = [];
    let checked = 0;
    for (const sha of m.unverified) {
      if (already.has(sha)) continue;
      if (checked >= WEB_LIMITS.verifyPerCall) {
        still.push(sha);
        continue;
      }
      checked++;
      const h = await files(env).head(blobKey(params.game, sha));
      if (!h) {
        still.push(sha);
        continue;
      }
      if (h.size !== sizes.get(sha)) throw new ApiError(409, "size_mismatch", `${sha.slice(0, 12)}…: stored ${h.size} bytes, expected ${sizes.get(sha)}`, "upload it again");
      await env.DB.prepare("INSERT OR IGNORE INTO web_blobs (game_id, sha256, size, created_at) VALUES (?, ?, ?, ?)").bind(params.game, sha, h.size, now()).run();
    }
    m.unverified = still;
    await saveManifest(env, params.game, d.id, m);
    if (still.length) {
      // Under the cap, every remaining hash was looked at: those were never uploaded.
      const allChecked = checked < WEB_LIMITS.verifyPerCall;
      return { done: false, remaining: still.length, ...(allChecked ? { not_uploaded: still.slice(0, 20) } : {}) };
    }
    await env.DB.prepare("UPDATE web_deploys SET status = 'ready', finished_at = ? WHERE id = ?").bind(now(), d.id).run();
    if (body.activate !== false) await activate(env, params.game, d.id);
    const fresh = await deployRow(env, params.game, d.id);
    return { done: true, deploy: deployView(env, fresh, await liveDeploy(env, params.game)), url: siteUrl(env, params.game) };
  },

  async webDeploysList({ env, caller, params }) {
    await ownGame(env, caller, params.game);
    const live = await liveDeploy(env, params.game);
    const r = await env.DB.prepare("SELECT * FROM web_deploys WHERE game_id = ? ORDER BY created_at DESC").bind(params.game).all<DeployRow>();
    return { url: siteUrl(env, params.game), live, deploys: r.results.map((d) => deployView(env, d, live)) };
  },

  async webActivate({ env, caller, params, dryRun }) {
    await ownGame(env, caller, params.game);
    const d = await deployRow(env, params.game, params.deploy);
    if (d.status !== "ready") throw bad("that deploy isn't finished", "finish it (or deploy again)");
    if (dryRun) return { dry_run: true, live: d.id };
    await activate(env, params.game, d.id);
    return { live: d.id, url: siteUrl(env, params.game) };
  },

  async webTakeDown({ env, caller, params, dryRun }) {
    await ownGame(env, caller, params.game);
    if (dryRun) return { dry_run: true };
    const r = await env.DB.prepare("DELETE FROM web_sites WHERE game_id = ?").bind(params.game).run();
    siteCache.delete(params.game);
    return { taken_down: (r.meta.changes ?? 0) > 0, hint: "deploys are kept; `partii web activate` puts one back" };
  },
};

// ── Serving <game>.partii.games ──

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json", map: "application/json", wasm: "application/wasm", txt: "text/plain; charset=utf-8", xml: "application/xml", webmanifest: "application/manifest+json",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4", webm: "video/webm",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  data: "application/octet-stream", pck: "application/octet-stream", bin: "application/octet-stream", glb: "model/gltf-binary", gltf: "model/gltf+json",
};
const typeOf = (path: string) => TYPES[path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

/** Per isolate, briefly: the live deploy and its manifest per game. */
const siteCache = new Map<string, { at: number; deploy: string | null; manifest: Manifest | null }>();
const SITE_CACHE_MS = 15_000;

/** The game (and preview deploy) this host is for, or null when it isn't a site host. */
export function webTarget(env: Env, host: string): { game: string; deploy: string | null } | null {
  if (!env.WEB_DOMAIN) return null;
  const h = host.toLowerCase().replace(/:\d+$/, "");
  if (!h.endsWith(env.WEB_DOMAIN)) return null;
  const label = h.slice(0, -env.WEB_DOMAIN.length);
  if (!label || label.includes(".") || RESERVED.has(label)) return null;
  const m = /^([a-z0-9]{12})--([a-z0-9-]{1,40})$/.exec(label);
  if (m) return { game: m[2], deploy: m[1] };
  return /^[a-z0-9-]{1,40}$/.test(label) ? { game: label, deploy: null } : null;
}

function page(status: number, title: string, text: string) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:18px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}</style><main><h1>${title}</h1><p>${text}</p><p><a href="https://partii.games">partii.games</a></p></main>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function serveWeb(env: Env, req: Request, target: { game: string; deploy: string | null }): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  let site = target.deploy ? undefined : siteCache.get(target.game);
  if (!site || Date.now() - site.at > SITE_CACHE_MS) {
    let deploy = target.deploy;
    if (deploy) {
      const d = await env.DB.prepare("SELECT status FROM web_deploys WHERE id = ? AND game_id = ?").bind(deploy, target.game).first<{ status: string }>();
      if (!d || d.status !== "ready") deploy = null;
    } else {
      deploy = await liveDeploy(env, target.game);
    }
    site = { at: Date.now(), deploy, manifest: deploy ? await loadManifest(env, target.game, deploy) : null };
    if (!target.deploy) siteCache.set(target.game, site);
  }
  if (!site.manifest) return page(404, "Nothing here yet", `There's no site at this address.`);
  const m = site.manifest;
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
  } catch {
    return page(400, "Bad address", "That address isn't valid.");
  }
  if (path === "" || path.endsWith("/")) path += "index.html";
  let status = 200;
  let entry = m.files[path];
  if (!entry && m.files[`${path}/index.html`]) {
    const u = new URL(req.url);
    u.pathname += "/";
    return Response.redirect(u.toString(), 301);
  }
  if (!entry && m.options.spa) {
    // A client-side route: the nearest index.html above it.
    const segs = path.split("/");
    for (let i = segs.length - 1; i >= 0 && !entry; i--) {
      const candidate = [...segs.slice(0, i), "index.html"].join("/");
      if (m.files[candidate]) {
        entry = m.files[candidate];
        path = candidate;
      }
    }
  }
  if (!entry && m.files["404.html"]) {
    entry = m.files["404.html"];
    path = "404.html";
    status = 404;
  }
  if (!entry) return page(404, "Not found", "This page isn't part of the site.");
  const etag = `"${entry.sha256}"`;
  const headers = new Headers({
    "content-type": typeOf(path),
    etag,
    "cache-control": path.endsWith(".html") ? "no-cache" : "public, max-age=60",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  });
  // Unity's pre-compressed builds: the stored bytes are already encoded.
  const enc = /\.(br|gz)$/.exec(path);
  if (enc) {
    headers.set("content-encoding", enc[1] === "br" ? "br" : "gzip");
    headers.set("content-type", typeOf(path.slice(0, -enc[0].length)));
  }
  if (m.options.isolated) {
    // SharedArrayBuffer (threaded wasm: Godot, Unity, Emscripten) needs cross-origin isolation.
    headers.set("cross-origin-opener-policy", "same-origin");
    headers.set("cross-origin-embedder-policy", "require-corp");
    headers.set("cross-origin-resource-policy", "same-origin");
  }
  if (status === 200 && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  const key = blobKey(target.game, entry.sha256);
  if (env.FILES) {
    const range = status === 200 && req.headers.has("range") ? req.headers : undefined;
    const o = await env.FILES.get(key, range ? { range } : undefined);
    if (!o) return page(404, "Not found", "This file is missing.");
    headers.set("accept-ranges", "bytes");
    if (range && "range" in o && o.range) {
      const r = o.range as { offset?: number; length?: number };
      const start = r.offset ?? 0;
      const len = r.length ?? o.size - start;
      headers.set("content-range", `bytes ${start}-${start + len - 1}/${o.size}`);
      headers.set("content-length", String(len));
      status = 206;
    } else {
      headers.set("content-length", String(o.size));
    }
    return new Response(req.method === "HEAD" ? null : o.body, { status, headers, ...(enc ? { encodeBody: "manual" as const } : {}) });
  }
  const o = await files(env).get(key);
  if (!o) return page(404, "Not found", "This file is missing.");
  headers.set("content-length", String(o.size));
  return new Response(req.method === "HEAD" ? null : o.body, { status, headers, ...(enc ? { encodeBody: "manual" as const } : {}) });
}

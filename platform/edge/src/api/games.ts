// Games: store pages, prices and sales, builds, keys, entitlements, live content.

import { bad, b64url, fromB64url, gameView, now, ownGame, ownProject, randomSlug, sha256hex, type GameRow } from "./core";
import type { Handlers } from "./index";

const GAME_ID = /^[a-z0-9-]{1,40}$/;
const PLATFORMS = ["macos", "windows", "linux", "ios", "android", "web"];
const MAX_BUILD = 512 * 1024 * 1024;

export async function grant(env: { DB: D1Database }, player: string, game: string, source: string, ref: string) {
  await env.DB.prepare(
    "INSERT INTO entitlements (player_id, game_id, sku, source, ref, created_at) VALUES (?, ?, 'full', ?, ?, ?) ON CONFLICT DO UPDATE SET revoked_at = NULL, source = excluded.source, ref = excluded.ref",
  )
    .bind(player, game, source, ref, now())
    .run();
  return { game, sku: "full", source, ref, created_at: now() };
}

function codeString(): string {
  // XXXXX-XXXXX-XXXXX, unambiguous characters.
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.getRandomValues(new Uint8Array(15));
  const s = Array.from(b, (x) => a[x % a.length]).join("");
  return `${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10)}`;
}

export const gameHandlers: Handlers = {
  async gamesList({ env, caller }) {
    const r = await env.DB.prepare("SELECT g.* FROM games g JOIN projects p ON p.id = g.project_id WHERE p.developer_id = ? ORDER BY g.created_at").bind(caller.developer!.id).all<GameRow>();
    return { games: r.results.map(gameView) };
  },

  async gamesPut({ env, caller, params, body, dryRun }) {
    const id = params.game;
    if (!GAME_ID.test(id)) throw bad("game ids are 1–40 lowercase letters, digits and dashes");
    const existing = await env.DB.prepare("SELECT g.*, p.developer_id FROM games g JOIN projects p ON p.id = g.project_id WHERE g.id = ?").bind(id).first<GameRow & { developer_id: string }>();
    if (existing && existing.developer_id !== caller.developer!.id) throw bad(`game id ${id} is taken`, "pick another id");
    const project = body.project !== undefined ? String(body.project) : existing?.project_id;
    if (!project) throw bad("project is required for a new game", "pass --field project=<project>");
    await ownProject(env, caller, project);
    const pick = <T>(k: string, fallback: T): T => (body[k] !== undefined ? (body[k] as T) : fallback);
    const platforms = pick<string[]>("platforms", existing ? JSON.parse(existing.platforms) : []);
    if (!Array.isArray(platforms) || platforms.some((p) => !PLATFORMS.includes(p))) throw bad(`platforms must be some of ${PLATFORMS.join(", ")}`);
    const price = Number(pick("price_cents", existing?.price_cents ?? 0));
    if (!Number.isInteger(price) || price < 0) throw bad("price_cents must be a whole number of cents");
    const g: GameRow = {
      id,
      project_id: project,
      title: String(pick("title", existing?.title ?? id)),
      tagline: String(pick("tagline", existing?.tagline ?? "")),
      description: String(pick("description", existing?.description ?? "")),
      price_cents: price,
      currency: String(pick("currency", existing?.currency ?? "usd")).toLowerCase(),
      sale: existing?.sale ?? null,
      demo: body.demo !== undefined ? (body.demo === null ? null : JSON.stringify(body.demo)) : existing?.demo ?? null,
      platforms: JSON.stringify(platforms),
      store: JSON.stringify(pick("store", existing ? JSON.parse(existing.store) : {})),
      status: existing?.status ?? "draft",
      created_at: existing?.created_at ?? now(),
      updated_at: now(),
    };
    if (dryRun) return { dry_run: true, game: gameView(g), created: !existing };
    await env.DB.prepare(
      `INSERT INTO games (id, project_id, title, tagline, description, price_cents, currency, sale, demo, platforms, store, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET project_id = excluded.project_id, title = excluded.title, tagline = excluded.tagline, description = excluded.description,
         price_cents = excluded.price_cents, currency = excluded.currency, demo = excluded.demo, platforms = excluded.platforms, store = excluded.store, updated_at = excluded.updated_at`,
    )
      .bind(g.id, g.project_id, g.title, g.tagline, g.description, g.price_cents, g.currency, g.sale, g.demo, g.platforms, g.store, g.status, g.created_at, g.updated_at)
      .run();
    return { game: gameView(g), created: !existing };
  },

  async gamesGet({ env, caller, params }) {
    return { game: gameView(await ownGame(env, caller, params.game)) };
  },

  async gamesPublish({ env, caller, params, dryRun }) {
    const g = await ownGame(env, caller, params.game);
    if (!g.title.trim()) throw bad("a game needs a title before it goes on the store");
    if (dryRun) return { dry_run: true, game: { ...gameView(g), status: "published" } };
    await env.DB.prepare("UPDATE games SET status = 'published', updated_at = ? WHERE id = ?").bind(now(), g.id).run();
    return { game: { ...gameView(g), status: "published" } };
  },

  async gamesUnpublish({ env, caller, params, dryRun }) {
    const g = await ownGame(env, caller, params.game);
    if (dryRun) return { dry_run: true, game: { ...gameView(g), status: "draft" } };
    await env.DB.prepare("UPDATE games SET status = 'draft', updated_at = ? WHERE id = ?").bind(now(), g.id).run();
    return { game: { ...gameView(g), status: "draft" } };
  },

  async gamesPrice({ env, caller, params, body, dryRun }) {
    const g = await ownGame(env, caller, params.game);
    const price = Number(body.price_cents);
    if (!Number.isInteger(price) || price < 0) throw bad("price_cents must be a whole number of cents", "e.g. --field price_cents=499 for $4.99");
    const currency = body.currency ? String(body.currency).toLowerCase() : g.currency;
    if (dryRun) return { dry_run: true, game: { ...gameView(g), price_cents: price, currency } };
    await env.DB.prepare("UPDATE games SET price_cents = ?, currency = ?, updated_at = ? WHERE id = ?").bind(price, currency, now(), g.id).run();
    return { game: { ...gameView(g), price_cents: price, currency } };
  },

  async gamesSale({ env, caller, params, body, dryRun }) {
    const g = await ownGame(env, caller, params.game);
    const percent = Number(body.percent);
    if (!Number.isInteger(percent) || percent < 1 || percent > 95) throw bad("percent must be 1–95");
    const sale = { percent, starts_at: Number(body.starts_at ?? now()), ends_at: Number(body.ends_at ?? now() + 7 * 86400_000) };
    if (sale.ends_at <= sale.starts_at) throw bad("ends_at must be after starts_at");
    if (dryRun) return { dry_run: true, game: { ...gameView(g), sale } };
    await env.DB.prepare("UPDATE games SET sale = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(sale), now(), g.id).run();
    return { game: { ...gameView(g), sale } };
  },

  async gamesSaleEnd({ env, caller, params, dryRun }) {
    const g = await ownGame(env, caller, params.game);
    if (dryRun) return { dry_run: true, game: { ...gameView(g), sale: null } };
    await env.DB.prepare("UPDATE games SET sale = NULL, updated_at = ? WHERE id = ?").bind(now(), g.id).run();
    return { game: { ...gameView(g), sale: null } };
  },

  async buildsList({ env, caller, params }) {
    await ownGame(env, caller, params.game);
    const r = await env.DB.prepare("SELECT id, platform, version, channel, filename, size, sha256, created_at FROM builds WHERE game_id = ? ORDER BY created_at DESC").bind(params.game).all();
    return { builds: r.results.map((b) => ({ game: params.game, ...b })) };
  },

  async buildsUpload({ env, caller, params, query, req, dryRun }) {
    await ownGame(env, caller, params.game);
    const platform = String(query.platform ?? "");
    if (!PLATFORMS.includes(platform)) throw bad(`platform must be one of ${PLATFORMS.join(", ")}`);
    const version = String(query.version ?? "");
    if (!/^[A-Za-z0-9._+-]{1,40}$/.test(version)) throw bad("version is required (letters, digits, . _ + -)");
    const channel = String(query.channel ?? "stable");
    const filename = String(query.filename ?? `${params.game}-${version}-${platform}`);
    if (dryRun) return { dry_run: true, build: { game: params.game, platform, version, channel, filename } };
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength === 0) throw bad("the request body is the build file; it was empty");
    if (bytes.byteLength > MAX_BUILD) throw bad("builds over 512 MB need a multipart upload", "split the upload");
    const sha = await sha256hex(bytes);
    const id = randomSlug(12);
    const key = `builds/${params.game}/${platform}/${version}/${id}/${filename}`;
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: "application/octet-stream", contentDisposition: `attachment; filename="${filename}"` } });
    const build = { id, game: params.game, platform, version, channel, filename, size: bytes.byteLength, sha256: sha, created_at: now() };
    await env.DB.prepare("INSERT INTO builds (id, game_id, platform, version, channel, filename, r2_key, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, params.game, platform, version, channel, filename, key, build.size, sha, build.created_at)
      .run();
    return { build };
  },

  async codesList({ env, caller, params }) {
    await ownGame(env, caller, params.game);
    const r = await env.DB.prepare("SELECT code, note, created_at, redeemed_by, redeemed_at FROM codes WHERE game_id = ? ORDER BY created_at").bind(params.game).all();
    return { codes: r.results };
  },

  async codesCreate({ env, caller, params, body, dryRun }) {
    await ownGame(env, caller, params.game);
    const count = Math.min(Math.max(Number(body.count ?? 1), 1), 500);
    if (dryRun) return { dry_run: true, count };
    const codes: string[] = [];
    const stmts = [];
    for (let i = 0; i < count; i++) {
      const code = codeString();
      codes.push(code);
      stmts.push(env.DB.prepare("INSERT INTO codes (code, game_id, note, created_at) VALUES (?, ?, ?, ?)").bind(code, params.game, String(body.note ?? ""), now()));
    }
    await env.DB.batch(stmts);
    return { codes };
  },

  async entitlementsList({ env, caller, params }) {
    await ownGame(env, caller, params.game);
    const r = await env.DB.prepare(
      "SELECT e.player_id AS player, p.display_name, e.sku, e.source, e.ref, e.created_at, e.revoked_at FROM entitlements e LEFT JOIN players p ON p.id = e.player_id WHERE e.game_id = ? ORDER BY e.created_at",
    )
      .bind(params.game)
      .all();
    return { entitlements: r.results };
  },

  async entitlementsGrant({ env, caller, params, body, dryRun }) {
    await ownGame(env, caller, params.game);
    const player = String(body.player ?? "");
    const p = await env.DB.prepare("SELECT id FROM players WHERE id = ? AND deleted_at IS NULL").bind(player).first();
    if (!p) throw bad(`no player ${player}`);
    if (dryRun) return { dry_run: true };
    return { entitlement: await grant(env, player, params.game, "grant", String(body.note ?? caller.developer!.email)) };
  },

  async entitlementsRevoke({ env, caller, params, dryRun }) {
    await ownGame(env, caller, params.game);
    if (dryRun) return { dry_run: true };
    const r = await env.DB.prepare("UPDATE entitlements SET revoked_at = ? WHERE game_id = ? AND player_id = ? AND revoked_at IS NULL").bind(now(), params.game, params.player).run();
    return { revoked: r.meta.changes > 0 };
  },

  async salesList({ env, caller, params }) {
    await ownGame(env, caller, params.game);
    const r = await env.DB.prepare("SELECT id, player_id AS player, store, ref, amount_cents, currency, status, test, created_at FROM purchases WHERE game_id = ? ORDER BY created_at DESC LIMIT 500")
      .bind(params.game)
      .all<{ amount_cents: number; status: string; test: number }>();
    const paid = r.results.filter((p) => p.status === "paid");
    return {
      purchases: r.results.map((p) => ({ ...p, test: !!p.test })),
      totals: { count: paid.length, gross_cents: paid.filter((p) => !p.test).reduce((a, p) => a + p.amount_cents, 0), test_count: paid.filter((p) => p.test).length },
    };
  },

  async contentPush({ env, caller, params, body, dryRun }) {
    await ownGame(env, caller, params.game);
    const version = String(body.version ?? "");
    if (!version) throw bad("version is required");
    const channel = String(body.channel ?? "stable");
    const files = (body.files ?? {}) as Record<string, string>;
    if (typeof files !== "object" || !Object.keys(files).length) throw bad("files is required: {\"path\": \"<base64>\"}");
    const manifest: Record<string, { sha256: string; size: number }> = {};
    const blobs: [string, Uint8Array][] = [];
    for (const [path, data] of Object.entries(files)) {
      if (!/^[A-Za-z0-9._/-]{1,200}$/.test(path) || path.includes("..")) throw bad(`bad content path ${path}`);
      const bytes = fromB64url(data.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
      const sha = await sha256hex(bytes);
      manifest[path] = { sha256: sha, size: bytes.byteLength };
      blobs.push([sha, bytes]);
    }
    const m = { game: params.game, channel, version, files: manifest };
    if (dryRun) return { dry_run: true, manifest: m };
    for (const [sha, bytes] of blobs) await env.FILES.put(`content/${params.game}/${sha}`, bytes);
    await env.DB.prepare("INSERT INTO content (game_id, channel, version, manifest, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET version = excluded.version, manifest = excluded.manifest, created_at = excluded.created_at")
      .bind(params.game, channel, version, JSON.stringify(m), now())
      .run();
    return { manifest: m };
  },
};

export { b64url };

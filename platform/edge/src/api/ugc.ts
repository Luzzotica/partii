import { AwsClient } from "aws4fetch";
import { files } from "../files";
// Player content (UGC): public levels, worlds and replays. Files are content
// addressed per game (ugc/<game>/<sha256>) and go straight to R2 on a signed
// PUT (through the Worker on a signed ticket when there are no R2 S3
// credentials). An item is a title, tags and a list of versions, each naming
// a file by hash; old versions stay downloadable because a World pins the
// exact Levels it uses. Votes and plays are one per player per item.
// Moderation hides an item and its files; authors unpublish their own.

import type { Env } from "../index";
import { ApiError, bad, forbidden, now, ownGame, randomSlug, sha256hex, signClaims, verifyClaims, type Caller } from "./core";
import type { Handlers } from "./index";

export const KINDS = ["level", "world", "replay"] as const;
export const UGC_LIMITS = {
  /** Bytes per item file. */
  file: 5 * 1024 * 1024,
  /** Bytes per thumbnail (PNG). */
  thumbnail: 256 * 1024,
  /** Live (not unpublished) items per player per game. */
  items: 300,
  /** Publishes plus new versions per player per hour. */
  publishesPerHour: 30,
  /** Upload starts per player per hour. */
  uploadsPerHour: 60,
  /** Votes per player per hour. */
  votesPerHour: 300,
  /** Reports per player per hour. */
  reportsPerHour: 20,
  /** Hashes a version may pin. */
  refs: 200,
  /** Distinct players' open reports that hide an item until the moderator looks. */
  autoHideReports: 3,
};
const TITLE_MAX = 80;
const DESCRIPTION_MAX = 2000;
const TAGS_MAX = 10;
const TAG = /^[a-z0-9][a-z0-9-]{0,23}$/;
const SHA = /^[0-9a-f]{64}$/;
const VERSION = /^[A-Za-z0-9._+-]{1,40}$/;
const PAGE_MAX = 50;
const TICKET_TTL = 3600_000;
const HOUR = 3600_000;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Share codes: like room codes, but six characters so the two never look alike. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const blobKey = (game: string, sha: string) => `ugc/${game}/${sha}`;

interface ItemRow {
  id: string;
  game_id: string;
  author_id: string;
  author_name?: string;
  kind: string;
  title: string;
  description: string;
  tags: string;
  visibility: string;
  share_code: string;
  version: number;
  sha256: string;
  size: number;
  client_version: string;
  thumbnail_sha256: string | null;
  up: number;
  down: number;
  score: number;
  plays: number;
  reports: number;
  hidden_at: number | null;
  hidden_reason: string | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

const ITEM_SELECT = "SELECT i.*, p.display_name AS author_name FROM ugc_items i LEFT JOIN players p ON p.id = i.author_id";

function origin(req: Request) {
  return new URL(req.url).origin;
}
const blobUrl = (req: Request, game: string, sha: string) => `${origin(req)}/v1/games/${encodeURIComponent(game)}/ugc/blobs/${sha}`;

function itemView(req: Request, r: ItemRow, extra: Record<string, unknown> = {}) {
  return {
    id: r.id,
    game: r.game_id,
    kind: r.kind,
    title: r.title,
    description: r.description,
    tags: JSON.parse(r.tags) as string[],
    author: { id: r.author_id, display_name: r.author_name ?? "" },
    visibility: r.visibility,
    share_code: r.share_code,
    version: r.version,
    sha256: r.sha256,
    size: r.size,
    client_version: r.client_version,
    download_url: blobUrl(req, r.game_id, r.sha256),
    thumbnail_url: r.thumbnail_sha256 ? blobUrl(req, r.game_id, r.thumbnail_sha256) : null,
    votes: { up: r.up, down: r.down, score: r.score },
    plays: r.plays,
    hidden: r.hidden_at !== null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    ...extra,
  };
}

async function item(env: Env, id: string): Promise<ItemRow | null> {
  return env.DB.prepare(`${ITEM_SELECT} WHERE i.id = ?`).bind(id).first<ItemRow>();
}

/** The item as players see it: unpublished and hidden items are gone (except a hidden one to its author). */
async function visibleItem(env: Env, id: string, viewer?: string | null): Promise<ItemRow> {
  const r = await item(env, id);
  if (!r || r.deleted_at !== null || (r.hidden_at !== null && r.author_id !== viewer)) throw new ApiError(404, "not_found", "no such item", "it may have been unpublished");
  return r;
}

/** The caller must be the item's author. */
async function ownItem(env: Env, caller: Caller, id: string): Promise<ItemRow> {
  const r = await item(env, id);
  if (!r || r.deleted_at !== null) throw new ApiError(404, "not_found", "no such item");
  if (r.author_id !== caller.player!.id) throw forbidden("only the author can change this item");
  return r;
}

/** A player token, if one came along on a key-auth request. */
export async function optionalPlayer(env: Env, req: Request): Promise<string | null> {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer pt_")) return null;
  const c = await verifyClaims<{ pid: string; exp?: number }>(env.PLAYER_TOKEN_SECRET, "pt", h.slice(7));
  return c?.pid ?? null;
}

async function gameExists(env: Env, game: string) {
  const g = await env.DB.prepare("SELECT id, project_id FROM games WHERE id = ?").bind(game).first<{ id: string; project_id: string }>();
  if (!g) throw new ApiError(404, "not_found", `no game ${game}`);
  return g;
}

/** Publishing needs an account a player can get back to, not a device guest. */
async function requireSignedIn(env: Env, player: string) {
  const r = await env.DB.prepare("SELECT 1 FROM identities WHERE player_id = ? AND provider <> 'device' LIMIT 1").bind(player).first();
  if (!r) throw new ApiError(403, "sign_in_required", "guests can't publish", "sign in (email, Steam, Apple, Google or Discord) first; the guest's progress merges into the account");
}

async function perHour(env: Env, sql: string, ...args: unknown[]): Promise<number> {
  const r = await env.DB.prepare(sql).bind(...args, now() - HOUR).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

function limited(what: string) {
  return new ApiError(429, "rate_limited", `too many ${what} in the last hour`, "try again later");
}

function sha(v: unknown, field = "sha256"): string {
  const s = String(v ?? "").toLowerCase();
  if (!SHA.test(s)) throw bad(`${field} is a file's hex sha256`);
  return s;
}

function text(v: unknown, field: string, max: number, required = false): string {
  const s = String(v ?? "").trim();
  if (required && !s) throw bad(`${field} is required`);
  if (s.length > max) throw bad(`${field} is at most ${max} characters`);
  return s;
}

function tags(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : String(v).split(",");
  const out = [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  if (out.length > TAGS_MAX) throw bad(`at most ${TAGS_MAX} tags`);
  for (const t of out) if (!TAG.test(t)) throw bad(`tag "${t}": 1–24 chars of a-z, 0-9 and -`);
  return out;
}

function visibility(v: unknown): string {
  const s = String(v ?? "public");
  if (s !== "public" && s !== "unlisted") throw bad("visibility is public or unlisted");
  return s;
}

function shareCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

/** A stored blob of this game, checked against its row (kind, size, moderation). */
async function storedBlob(env: Env, game: string, hash: string, kind: "file" | "thumbnail", field: string) {
  const row = await env.DB.prepare("SELECT kind, size, hidden_at FROM ugc_blobs WHERE game_id = ? AND sha256 = ?").bind(game, hash).first<{ kind: string; size: number; hidden_at: number | null }>();
  const stored = await files(env).head(blobKey(game, hash));
  if (!row || !stored) throw new ApiError(409, "not_uploaded", `${field}: nothing was uploaded with this hash`, "upload it first (ugcUploadStart, then PUT the bytes)");
  if (row.hidden_at !== null) throw new ApiError(409, "removed", `${field}: this file was removed by moderation`);
  if (row.kind !== kind) throw bad(`${field}: this hash was uploaded as a ${row.kind}, not a ${kind}`);
  if (stored.size !== row.size) throw new ApiError(409, "size_mismatch", `${field}: stored ${stored.size} bytes, expected ${row.size}`, "upload it again");
  if (kind === "thumbnail") {
    const head = new Uint8Array(await (await files(env).get(blobKey(game, hash)))!.arrayBuffer()).slice(0, 8);
    if (!PNG.every((b, i) => head[i] === b)) throw bad(`${field}: thumbnails must be PNG`);
  }
  return { size: stored.size };
}

async function refsOf(env: Env, game: string, v: unknown): Promise<string[]> {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad("refs is a list of sha256");
  const out = [...new Set(v.map((x) => sha(x, "refs")))];
  if (out.length > UGC_LIMITS.refs) throw bad(`at most ${UGC_LIMITS.refs} refs`);
  for (const h of out) {
    const r = await env.DB.prepare("SELECT 1 FROM ugc_blobs WHERE game_id = ? AND sha256 = ? AND kind = 'file' AND hidden_at IS NULL").bind(game, h).first();
    if (!r) throw new ApiError(409, "not_uploaded", `refs: ${h} is not a file of this game`, "publish or upload the Levels a World pins first");
  }
  return out;
}

async function checkPublishRate(env: Env, player: string) {
  if ((await perHour(env, "SELECT COUNT(*) AS n FROM ugc_versions WHERE author_id = ? AND created_at > ?", player)) >= UGC_LIMITS.publishesPerHour) throw limited("publishes");
}

function searchRow(r: { id: string; title: string; description: string; tags: string[] }) {
  return [r.id, r.title, r.description, r.tags.join(" ")];
}

/** Turn free text into an FTS5 query: every word must match, as a prefix. */
function ftsQuery(q: string): string | null {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return null;
  return words.slice(0, 8).map((w) => `"${w}"*`).join(" ");
}

const SORTS = {
  new: { cols: ["i.created_at", "i.id"], order: "i.created_at DESC, i.id DESC" },
  top: { cols: ["i.score", "i.created_at", "i.id"], order: "i.score DESC, i.created_at DESC, i.id DESC" },
  played: { cols: ["i.plays", "i.created_at", "i.id"], order: "i.plays DESC, i.created_at DESC, i.id DESC" },
} as const;
type Sort = keyof typeof SORTS;

const cursorOf = (sort: Sort, r: ItemRow) => btoa(JSON.stringify(sort === "new" ? [r.created_at, r.id] : [sort === "top" ? r.score : r.plays, r.created_at, r.id]));

async function myVotes(env: Env, player: string | null, ids: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!player || !ids.length) return m;
  const r = await env.DB.prepare(`SELECT item_id, value FROM ugc_votes WHERE player_id = ? AND item_id IN (${ids.map(() => "?").join(",")})`).bind(player, ...ids).all<{ item_id: string; value: number }>();
  for (const v of r.results) m.set(v.item_id, v.value);
  return m;
}

async function versionsOf(req: Request, env: Env, r: ItemRow) {
  const v = await env.DB.prepare("SELECT version, sha256, size, client_version, notes, refs, created_at FROM ugc_versions WHERE item_id = ? ORDER BY version DESC").bind(r.id).all<{ version: number; sha256: string; size: number; client_version: string; notes: string; refs: string; created_at: number }>();
  return v.results.map((x) => ({ ...x, refs: JSON.parse(x.refs) as string[], download_url: blobUrl(req, r.game_id, x.sha256) }));
}

/** Hide (reason) or unhide (null) an item and its files. A moderator's decision also settles its open reports and review entries. */
async function setHidden(env: Env, r: ItemRow, reason: string | null, decided: { verdict: "ok" | "hide"; note: string } | null) {
  const at = reason ? now() : null;
  const versions = await env.DB.prepare("SELECT sha256 FROM ugc_versions WHERE item_id = ?").bind(r.id).all<{ sha256: string }>();
  const hashes = [...new Set([...versions.results.map((v) => v.sha256), ...(r.thumbnail_sha256 ? [r.thumbnail_sha256] : [])])];
  await env.DB.batch([
    env.DB.prepare("UPDATE ugc_items SET hidden_at = ?, hidden_reason = ? WHERE id = ?").bind(at, reason, r.id),
    ...hashes.map((h) => env.DB.prepare("UPDATE ugc_blobs SET hidden_at = ? WHERE game_id = ? AND sha256 = ?").bind(at, r.game_id, h)),
    ...(decided
      ? [
          env.DB.prepare("UPDATE ugc_reports SET resolved_at = ? WHERE item_id = ? AND resolved_at IS NULL").bind(now(), r.id),
          env.DB.prepare("UPDATE ugc_review SET done_at = ?, verdict = ?, note = ? WHERE item_id = ? AND done_at IS NULL").bind(now(), decided.verdict, decided.note, r.id),
        ]
      : []),
  ]);
}

async function moderate(env: Env, req: Request, r: ItemRow, body: Record<string, any>) {
  const action = String(body.action ?? "");
  if (action !== "hide" && action !== "unhide") throw bad("action is hide or unhide");
  const reason = action === "hide" ? text(body.reason, "reason", 500) || "moderation" : null;
  await setHidden(env, r, reason, { verdict: reason ? "hide" : "ok", note: reason ?? "" });
  return { item: itemView(req, (await item(env, r.id))!, { hidden_reason: reason }) };
}

/** Queue an item for the moderator (a statement for the caller's batch). */
const queueReview = (env: Env, itemId: string, game: string, version: number, cause: "new" | "version" | "edit" | "reports") =>
  env.DB.prepare("INSERT INTO ugc_review (item_id, game_id, version, cause, created_at) VALUES (?, ?, ?, ?, ?)").bind(itemId, game, version, cause, now());

const adminBlobUrl = (req: Request, game: string, sha: string) => `${origin(req)}/v1/admin/ugc/blobs/${encodeURIComponent(game)}/${sha}`;

/** Signed ticket for a Worker upload (when R2 direct uploads are unavailable). */
export async function uploadTicket(env: Env, claims: { g: string; h: string; s: number; exp: number }) {
  return signClaims(env.KEY_SECRET, "ut", claims);
}

/** Move a guest's votes and plays to the account it merged into, then fix the counts. */
export async function mergeUgc(env: Env, guest: string, into: string) {
  const touched = await env.DB.prepare("SELECT item_id FROM ugc_votes WHERE player_id = ? UNION SELECT item_id FROM ugc_plays WHERE player_id = ?").bind(guest, guest).all<{ item_id: string }>();
  await env.DB.batch([
    env.DB.prepare("UPDATE OR IGNORE ugc_votes SET player_id = ? WHERE player_id = ?").bind(into, guest),
    env.DB.prepare("DELETE FROM ugc_votes WHERE player_id = ?").bind(guest),
    env.DB.prepare("UPDATE OR IGNORE ugc_plays SET player_id = ? WHERE player_id = ?").bind(into, guest),
    env.DB.prepare("DELETE FROM ugc_plays WHERE player_id = ?").bind(guest),
    env.DB.prepare("UPDATE ugc_items SET author_id = ? WHERE author_id = ?").bind(into, guest),
    env.DB.prepare("UPDATE ugc_versions SET author_id = ? WHERE author_id = ?").bind(into, guest),
    env.DB.prepare("UPDATE OR IGNORE ugc_reports SET player_id = ? WHERE player_id = ?").bind(into, guest),
    env.DB.prepare("DELETE FROM ugc_reports WHERE player_id = ?").bind(guest),
    ...touched.results.map((t) => recount(env, t.item_id)),
  ]);
}

function recount(env: Env, id: string) {
  return env.DB.prepare(
    `UPDATE ugc_items SET
       up = (SELECT COUNT(*) FROM ugc_votes WHERE item_id = ?1 AND value = 1),
       down = (SELECT COUNT(*) FROM ugc_votes WHERE item_id = ?1 AND value = -1),
       score = (SELECT COALESCE(SUM(value), 0) FROM ugc_votes WHERE item_id = ?1),
       plays = (SELECT COUNT(*) FROM ugc_plays WHERE item_id = ?1)
     WHERE id = ?1`,
  ).bind(id);
}

/** An account was deleted: unpublish its items and drop its votes, plays and reports. */
export async function deleteUgcOf(env: Env, player: string) {
  const touched = await env.DB.prepare("SELECT item_id FROM ugc_votes WHERE player_id = ? UNION SELECT item_id FROM ugc_plays WHERE player_id = ?").bind(player, player).all<{ item_id: string }>();
  const mine = await env.DB.prepare("SELECT id FROM ugc_items WHERE author_id = ? AND deleted_at IS NULL").bind(player).all<{ id: string }>();
  await env.DB.batch([
    env.DB.prepare("UPDATE ugc_items SET deleted_at = ? WHERE author_id = ? AND deleted_at IS NULL").bind(now(), player),
    ...mine.results.map((m) => env.DB.prepare("DELETE FROM ugc_search WHERE item_id = ?").bind(m.id)),
    env.DB.prepare("DELETE FROM ugc_votes WHERE player_id = ?").bind(player),
    env.DB.prepare("DELETE FROM ugc_plays WHERE player_id = ?").bind(player),
    env.DB.prepare("DELETE FROM ugc_reports WHERE player_id = ?").bind(player),
    ...touched.results.map((t) => recount(env, t.item_id)),
  ]);
}

export const ugcHandlers: Handlers = {
  async ugcUploadStart({ env, req, caller, params, body, dryRun }) {
    await gameExists(env, params.game);
    const kind = String(body.kind ?? "file");
    if (kind !== "file" && kind !== "thumbnail") throw bad("kind is file or thumbnail");
    const size = Number(body.size);
    const max = kind === "file" ? UGC_LIMITS.file : UGC_LIMITS.thumbnail;
    if (!Number.isInteger(size) || size <= 0) throw bad("size is the file's byte count");
    if (size > max) throw bad(`${kind}s are limited to ${max / 1024} KB`);
    const hash = sha(body.sha256);
    const player = caller.player!.id;
    await requireSignedIn(env, player);
    const row = await env.DB.prepare("SELECT kind, size, hidden_at FROM ugc_blobs WHERE game_id = ? AND sha256 = ?").bind(params.game, hash).first<{ kind: string; size: number; hidden_at: number | null }>();
    if (row?.hidden_at) throw new ApiError(409, "removed", "this file was removed by moderation");
    if (row && row.kind !== kind) throw bad(`this hash was uploaded as a ${row.kind}`);
    if (row && (await files(env).head(blobKey(params.game, hash)))?.size === size) return { exists: true, sha256: hash };
    if ((await perHour(env, "SELECT COUNT(*) AS n FROM ugc_blobs WHERE uploader_id = ? AND created_at > ?", player)) >= UGC_LIMITS.uploadsPerHour) throw limited("uploads");
    if (dryRun) return { dry_run: true, sha256: hash };
    await env.DB.prepare("INSERT INTO ugc_blobs (game_id, sha256, kind, size, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET size = excluded.size")
      .bind(params.game, hash, kind, size, player, now())
      .run();
    const expires_at = now() + TICKET_TTL;
    const contentType = kind === "thumbnail" ? "image/png" : "application/octet-stream";
    if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ENDPOINT && env.R2_BUCKET) {
      const aws = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
      const url = new URL(`${env.R2_ENDPOINT.replace(/\/$/, "")}/${env.R2_BUCKET}/${blobKey(params.game, hash).split("/").map(encodeURIComponent).join("/")}`);
      url.searchParams.set("X-Amz-Expires", String(TICKET_TTL / 1000));
      // The checksum header is signed: R2 refuses bytes whose sha256 differs.
      const headers = { "x-amz-checksum-sha256": btoa(String.fromCharCode(...hash.match(/../g)!.map((h) => parseInt(h, 16)))), "content-type": contentType };
      const signed = await aws.sign(new Request(url, { method: "PUT", headers }), { aws: { signQuery: true } });
      return { exists: false, sha256: hash, upload: { url: signed.url, method: "PUT", headers, expires_at } };
    }
    const ticket = await uploadTicket(env, { g: params.game, h: hash, s: size, exp: expires_at });
    return { exists: false, sha256: hash, upload: { url: `${blobUrl(req, params.game, hash)}?ticket=${encodeURIComponent(ticket)}`, method: "PUT", headers: { "content-type": contentType }, expires_at } };
  },

  async ugcBlobPut({ env, req, params, query }) {
    const hash = sha(params.sha256);
    const t = await verifyClaims<{ g: string; h: string; s: number; exp: number }>(env.KEY_SECRET, "ut", String(query.ticket ?? ""));
    if (!t || t.g !== params.game || t.h !== hash) throw new ApiError(401, "unauthorized", "this upload ticket is invalid or expired", "start the upload again with ugcUploadStart");
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength !== t.s) throw bad(`expected ${t.s} bytes, got ${bytes.byteLength}`);
    if ((await sha256hex(bytes)) !== hash) throw bad("the bytes don't match the sha256 the upload was started with");
    await files(env).put(blobKey(params.game, hash), bytes, { contentType: "application/octet-stream" });
    return { stored: true, sha256: hash, size: bytes.byteLength };
  },

  async ugcBlob({ env, params }) {
    const hash = sha(params.sha256);
    const row = await env.DB.prepare("SELECT kind, hidden_at FROM ugc_blobs WHERE game_id = ? AND sha256 = ?").bind(params.game, hash).first<{ kind: string; hidden_at: number | null }>();
    const o = row && row.hidden_at === null ? await files(env).get(blobKey(params.game, hash)) : null;
    if (!o) throw new ApiError(404, "not_found", "no such file", row?.hidden_at ? "it was removed by moderation" : "");
    return new Response(o.body, {
      headers: { "content-type": row!.kind === "thumbnail" ? "image/png" : "application/octet-stream", "content-length": String(o.size), "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" },
    });
  },

  async ugcPublish({ env, req, caller, params, body, dryRun }) {
    await gameExists(env, params.game);
    const player = caller.player!.id;
    await requireSignedIn(env, player);
    const kind = String(body.kind ?? "");
    if (!(KINDS as readonly string[]).includes(kind)) throw bad(`kind is one of ${KINDS.join(", ")}`);
    const fields = {
      title: text(body.title, "title", TITLE_MAX, true),
      description: text(body.description, "description", DESCRIPTION_MAX),
      tags: tags(body.tags),
      visibility: visibility(body.visibility),
      client_version: String(body.client_version ?? ""),
      notes: text(body.notes, "notes", 500),
    };
    if (!VERSION.test(fields.client_version)) throw bad("client_version is required (letters, digits, . _ + -)");
    const hash = sha(body.sha256);
    const thumb = body.thumbnail_sha256 ? sha(body.thumbnail_sha256, "thumbnail_sha256") : null;
    const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM ugc_items WHERE author_id = ? AND game_id = ? AND deleted_at IS NULL").bind(player, params.game).first<{ n: number }>();
    if (Number(live?.n ?? 0) >= UGC_LIMITS.items) throw new ApiError(409, "too_many_items", `players can have ${UGC_LIMITS.items} items per game`, "unpublish some first");
    await checkPublishRate(env, player);
    const { size } = await storedBlob(env, params.game, hash, "file", "sha256");
    if (thumb) await storedBlob(env, params.game, thumb, "thumbnail", "thumbnail_sha256");
    const refs = await refsOf(env, params.game, body.refs);
    if (dryRun) return { dry_run: true, item: { kind, ...fields, sha256: hash, size } };
    const id = `u_${randomSlug(12)}`;
    const at = now();
    for (let tries = 0; ; tries++) {
      const code = shareCode();
      try {
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO ugc_items (id, game_id, author_id, kind, title, description, tags, visibility, share_code, version, sha256, size, client_version, thumbnail_sha256, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)",
          ).bind(id, params.game, player, kind, fields.title, fields.description, JSON.stringify(fields.tags), fields.visibility, code, hash, size, fields.client_version, thumb, at, at),
          env.DB.prepare("INSERT INTO ugc_versions (item_id, version, author_id, sha256, size, client_version, notes, refs, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)").bind(id, player, hash, size, fields.client_version, fields.notes, JSON.stringify(refs), at),
          env.DB.prepare("INSERT INTO ugc_search (item_id, title, description, tags) VALUES (?, ?, ?, ?)").bind(...searchRow({ id, ...fields })),
          queueReview(env, id, params.game, 1, "new"),
        ]);
        break;
      } catch (e) {
        if (tries < 3 && String(e).includes("share_code")) continue;
        throw e;
      }
    }
    return { item: itemView(req, (await item(env, id))!) };
  },

  async ugcList({ env, req, params, query }) {
    const sort = (String(query.sort ?? "new") as Sort);
    if (!(sort in SORTS)) throw bad("sort is new, top or played");
    const limit = Math.min(Math.max(Number(query.limit ?? 20) || 20, 1), PAGE_MAX);
    const where = ["i.game_id = ?", "i.visibility = 'public'", "i.deleted_at IS NULL", "i.hidden_at IS NULL"];
    const args: unknown[] = [params.game];
    if (query.kind) {
      if (!(KINDS as readonly string[]).includes(query.kind)) throw bad(`kind is one of ${KINDS.join(", ")}`);
      where.push("i.kind = ?");
      args.push(query.kind);
    }
    for (const t of tags(query.tags)) {
      where.push("EXISTS (SELECT 1 FROM json_each(i.tags) WHERE value = ?)");
      args.push(t);
    }
    if (query.author) {
      where.push("i.author_id = ?");
      args.push(query.author);
    }
    if (query.q) {
      const fts = ftsQuery(String(query.q));
      if (fts) {
        where.push("i.id IN (SELECT item_id FROM ugc_search WHERE ugc_search MATCH ?)");
        args.push(fts);
      }
    }
    if (query.cursor) {
      let c: unknown[];
      try {
        c = JSON.parse(atob(String(query.cursor)));
      } catch {
        throw bad("cursor is the next_cursor of a previous page");
      }
      const cols = SORTS[sort].cols;
      if (!Array.isArray(c) || c.length !== cols.length) throw bad("cursor belongs to another sort");
      where.push(`(${cols.join(", ")}) < (${cols.map(() => "?").join(", ")})`);
      args.push(...c);
    }
    const r = await env.DB.prepare(`${ITEM_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${SORTS[sort].order} LIMIT ?`).bind(...args, limit + 1).all<ItemRow>();
    const rows = r.results.slice(0, limit);
    const votes = await myVotes(env, await optionalPlayer(env, req), rows.map((x) => x.id));
    return {
      items: rows.map((x) => itemView(req, x, votes.size ? { my_vote: votes.get(x.id) ?? 0 } : {})),
      next_cursor: r.results.length > limit ? cursorOf(sort, rows[rows.length - 1]) : null,
    };
  },

  async ugcByCode({ env, req, params }) {
    const code = String(params.code ?? "").trim().toUpperCase();
    const row = await env.DB.prepare(`${ITEM_SELECT} WHERE i.game_id = ? AND i.share_code = ?`).bind(params.game, code).first<ItemRow>();
    const viewer = await optionalPlayer(env, req);
    const r = await visibleItem(env, row?.id ?? "", viewer);
    return { item: { ...itemView(req, r, viewer ? { my_vote: (await myVotes(env, viewer, [r.id])).get(r.id) ?? 0 } : {}), versions: await versionsOf(req, env, r) } };
  },

  async ugcByHash({ env, req, params }) {
    const hash = sha(params.sha256);
    const blob = await env.DB.prepare("SELECT size, hidden_at FROM ugc_blobs WHERE game_id = ? AND sha256 = ? AND kind = 'file'").bind(params.game, hash).first<{ size: number; hidden_at: number | null }>();
    if (!blob || blob.hidden_at !== null) throw new ApiError(404, "not_found", "no file with this hash");
    // Unpublished items still say what a pinned hash is; hidden ones don't.
    const v = await env.DB.prepare(
      "SELECT v.item_id, v.version, v.client_version, v.created_at, i.kind, i.title, i.deleted_at IS NOT NULL AS unpublished FROM ugc_versions v JOIN ugc_items i ON i.id = v.item_id WHERE i.game_id = ? AND v.sha256 = ? AND i.hidden_at IS NULL ORDER BY v.created_at",
    )
      .bind(params.game, hash)
      .all<{ unpublished: number }>();
    return { sha256: hash, size: blob.size, download_url: blobUrl(req, params.game, hash), versions: v.results.map((x) => ({ ...x, unpublished: !!x.unpublished })) };
  },

  async ugcGet({ env, req, params }) {
    const viewer = await optionalPlayer(env, req);
    const r = await visibleItem(env, params.id, viewer);
    return { item: { ...itemView(req, r, viewer ? { my_vote: (await myVotes(env, viewer, [r.id])).get(r.id) ?? 0 } : {}), versions: await versionsOf(req, env, r) } };
  },

  async ugcUpdate({ env, req, caller, params, body, dryRun }) {
    const r = await ownItem(env, caller, params.id);
    const next = {
      title: body.title !== undefined ? text(body.title, "title", TITLE_MAX, true) : r.title,
      description: body.description !== undefined ? text(body.description, "description", DESCRIPTION_MAX) : r.description,
      tags: body.tags !== undefined ? tags(body.tags) : (JSON.parse(r.tags) as string[]),
      visibility: body.visibility !== undefined ? visibility(body.visibility) : r.visibility,
      thumbnail_sha256: body.thumbnail_sha256 !== undefined ? (body.thumbnail_sha256 ? sha(body.thumbnail_sha256, "thumbnail_sha256") : null) : r.thumbnail_sha256,
    };
    if (next.thumbnail_sha256 && next.thumbnail_sha256 !== r.thumbnail_sha256) await storedBlob(env, r.game_id, next.thumbnail_sha256, "thumbnail", "thumbnail_sha256");
    if (dryRun) return { dry_run: true, item: next };
    await env.DB.batch([
      env.DB.prepare("UPDATE ugc_items SET title = ?, description = ?, tags = ?, visibility = ?, thumbnail_sha256 = ?, updated_at = ? WHERE id = ?").bind(
        next.title,
        next.description,
        JSON.stringify(next.tags),
        next.visibility,
        next.thumbnail_sha256,
        now(),
        r.id,
      ),
      env.DB.prepare("DELETE FROM ugc_search WHERE item_id = ?").bind(r.id),
      env.DB.prepare("INSERT INTO ugc_search (item_id, title, description, tags) VALUES (?, ?, ?, ?)").bind(...searchRow({ id: r.id, ...next })),
      ...(next.title !== r.title || next.description !== r.description || JSON.stringify(next.tags) !== r.tags || next.thumbnail_sha256 !== r.thumbnail_sha256 ? [queueReview(env, r.id, r.game_id, r.version, "edit")] : []),
    ]);
    return { item: itemView(req, (await item(env, r.id))!) };
  },

  async ugcDelete({ env, caller, params, dryRun }) {
    const r = await ownItem(env, caller, params.id);
    if (dryRun) return { dry_run: true, id: r.id };
    await env.DB.batch([
      env.DB.prepare("UPDATE ugc_items SET deleted_at = ? WHERE id = ?").bind(now(), r.id),
      env.DB.prepare("DELETE FROM ugc_search WHERE item_id = ?").bind(r.id),
    ]);
    return { deleted: true, id: r.id };
  },

  async ugcVersion({ env, req, caller, params, body, dryRun }) {
    const r = await ownItem(env, caller, params.id);
    const hash = sha(body.sha256);
    const client_version = String(body.client_version ?? "");
    if (!VERSION.test(client_version)) throw bad("client_version is required (letters, digits, . _ + -)");
    const notes = text(body.notes, "notes", 500);
    await checkPublishRate(env, caller.player!.id);
    const { size } = await storedBlob(env, r.game_id, hash, "file", "sha256");
    const refs = await refsOf(env, r.game_id, body.refs);
    const version = r.version + 1;
    if (dryRun) return { dry_run: true, version, sha256: hash, size };
    const at = now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO ugc_versions (item_id, version, author_id, sha256, size, client_version, notes, refs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(r.id, version, r.author_id, hash, size, client_version, notes, JSON.stringify(refs), at),
      env.DB.prepare("UPDATE ugc_items SET version = ?, sha256 = ?, size = ?, client_version = ?, updated_at = ? WHERE id = ? AND version = ?").bind(version, hash, size, client_version, at, r.id, r.version),
      queueReview(env, r.id, r.game_id, version, "version"),
    ]);
    const after = (await item(env, r.id))!;
    return { item: { ...itemView(req, after), versions: await versionsOf(req, env, after) } };
  },

  async ugcVote({ env, caller, params, body }) {
    const value = Number(body.value);
    if (![1, 0, -1].includes(value)) throw bad("value is 1 (up), -1 (down) or 0 (clear)");
    const r = await visibleItem(env, params.id, caller.player!.id);
    const player = caller.player!.id;
    if ((await perHour(env, "SELECT COUNT(*) AS n FROM ugc_votes WHERE player_id = ? AND updated_at > ?", player)) >= UGC_LIMITS.votesPerHour) throw limited("votes");
    await env.DB.batch([
      value === 0
        ? env.DB.prepare("DELETE FROM ugc_votes WHERE item_id = ? AND player_id = ?").bind(r.id, player)
        : env.DB.prepare("INSERT INTO ugc_votes (item_id, player_id, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(r.id, player, value, now()),
      recount(env, r.id),
    ]);
    const after = (await item(env, r.id))!;
    return { votes: { up: after.up, down: after.down, score: after.score }, my_vote: value };
  },

  async ugcPlay({ env, caller, params }) {
    const r = await visibleItem(env, params.id, caller.player!.id);
    const res = await env.DB.prepare("INSERT OR IGNORE INTO ugc_plays (item_id, player_id, created_at) VALUES (?, ?, ?)").bind(r.id, caller.player!.id, now()).run();
    const counted = (res.meta.changes ?? 0) > 0;
    if (counted) await env.DB.prepare("UPDATE ugc_items SET plays = plays + 1 WHERE id = ?").bind(r.id).run();
    return { counted };
  },

  async ugcReport({ env, caller, params, body }) {
    const reason = text(body.reason, "reason", 500, true);
    const r = await visibleItem(env, params.id, caller.player!.id);
    const player = caller.player!.id;
    if ((await perHour(env, "SELECT COUNT(*) AS n FROM ugc_reports WHERE player_id = ? AND created_at > ?", player)) >= UGC_LIMITS.reportsPerHour) throw limited("reports");
    const res = await env.DB.prepare("INSERT OR IGNORE INTO ugc_reports (item_id, player_id, reason, created_at) VALUES (?, ?, ?, ?)").bind(r.id, player, reason, now()).run();
    if ((res.meta.changes ?? 0) > 0) {
      await env.DB.batch([env.DB.prepare("UPDATE ugc_items SET reports = reports + 1 WHERE id = ?").bind(r.id), queueReview(env, r.id, r.game_id, r.version, "reports")]);
      // Enough players reporting it hides it until the moderator decides (their reports stay open).
      const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM ugc_reports WHERE item_id = ? AND resolved_at IS NULL").bind(r.id).first<{ n: number }>();
      if (r.hidden_at === null && Number(open?.n ?? 0) >= UGC_LIMITS.autoHideReports) await setHidden(env, r, "reported by players; waiting for review", null);
    }
    return { reported: true };
  },

  async ugcReports({ env, req, caller, params }) {
    await ownGame(env, caller, params.game);
    const r = await env.DB.prepare(
      `${ITEM_SELECT} WHERE i.game_id = ? AND i.deleted_at IS NULL AND EXISTS (SELECT 1 FROM ugc_reports x WHERE x.item_id = i.id AND x.resolved_at IS NULL) ORDER BY (SELECT COUNT(*) FROM ugc_reports x WHERE x.item_id = i.id AND x.resolved_at IS NULL) DESC LIMIT 100`,
    )
      .bind(params.game)
      .all<ItemRow>();
    const items = [];
    for (const x of r.results) {
      const reasons = await env.DB.prepare("SELECT reason, created_at FROM ugc_reports WHERE item_id = ? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 20").bind(x.id).all();
      items.push(itemView(req, x, { reports: reasons.results }));
    }
    return { items };
  },

  async ugcModerate({ env, req, caller, params, body }) {
    const r = await item(env, params.id);
    if (!r) throw new ApiError(404, "not_found", "no such item");
    await ownGame(env, caller, r.game_id);
    return moderate(env, req, r, body);
  },

  async adminUgcModerate({ env, req, params, body }) {
    const r = await item(env, params.id);
    if (!r) throw new ApiError(404, "not_found", "no such item");
    return moderate(env, req, r, body);
  },

  async adminUgcReview({ env, req, query }) {
    const after = Number(query.after ?? 0) || 0;
    const limit = Math.min(Math.max(Number(query.limit ?? 20) || 20, 1), PAGE_MAX);
    const all = query.all === "1" || query.all === "true";
    const rows = await env.DB.prepare(`SELECT * FROM ugc_review WHERE seq > ?${all ? "" : " AND done_at IS NULL"} ORDER BY seq LIMIT ?`)
      .bind(after, limit)
      .all<{ seq: number; item_id: string; game_id: string; version: number; cause: string; created_at: number; done_at: number | null; verdict: string | null; note: string | null }>();
    const pending = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(seq) AS last FROM ugc_review WHERE done_at IS NULL").first<{ n: number; last: number | null }>();
    const entries = [];
    for (const x of rows.results) {
      const r = await item(env, x.item_id);
      if (!r) continue;
      const reports = await env.DB.prepare("SELECT reason, created_at FROM ugc_reports WHERE item_id = ? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 20").bind(r.id).all();
      entries.push({
        seq: x.seq,
        cause: x.cause,
        version: x.version,
        queued_at: x.created_at,
        done_at: x.done_at,
        verdict: x.verdict,
        note: x.note,
        item: itemView(req, r, { hidden_reason: r.hidden_reason, deleted: r.deleted_at !== null }),
        // These work while the item is hidden (moderator only).
        file_url: adminBlobUrl(req, r.game_id, r.sha256),
        thumbnail_url: r.thumbnail_sha256 ? adminBlobUrl(req, r.game_id, r.thumbnail_sha256) : null,
        reports: reports.results,
      });
    }
    return { entries, pending: Number(pending?.n ?? 0), last_seq: pending?.last ?? null };
  },

  async adminUgcReviewDecide({ env, req, params, body }) {
    const row = await env.DB.prepare("SELECT item_id FROM ugc_review WHERE seq = ?").bind(Number(params.seq)).first<{ item_id: string }>();
    if (!row) throw new ApiError(404, "not_found", "no such review entry");
    const r = (await item(env, row.item_id))!;
    const verdict = String(body.verdict ?? "");
    if (verdict !== "ok" && verdict !== "hide") throw bad("verdict is ok or hide");
    const reason = text(body.reason, "reason", 500);
    if (verdict === "hide" && !reason) throw bad("say which rule it breaks (reason)", "e.g. \"sexual content (policy 1)\"");
    // ok: visible (undoes an automatic hide); hide: hidden with the reason the author sees.
    await setHidden(env, r, verdict === "hide" ? reason : null, { verdict, note: reason });
    return { item: itemView(req, (await item(env, r.id))!, { hidden_reason: verdict === "hide" ? reason : null }) };
  },

  async adminUgcBlob({ env, params }) {
    const hash = sha(params.sha256);
    const row = await env.DB.prepare("SELECT kind FROM ugc_blobs WHERE game_id = ? AND sha256 = ?").bind(params.game, hash).first<{ kind: string }>();
    const o = row ? await files(env).get(blobKey(params.game, hash)) : null;
    if (!o) throw new ApiError(404, "not_found", "no such file");
    return new Response(o.body, { headers: { "content-type": row!.kind === "thumbnail" ? "image/png" : "application/octet-stream", "content-length": String(o.size), "cache-control": "no-store" } });
  },

  async ugcMine({ env, req, caller, query }) {
    const game = query.game ? String(query.game) : null;
    const r = await env.DB.prepare(`${ITEM_SELECT} WHERE i.author_id = ? AND i.deleted_at IS NULL${game ? " AND i.game_id = ?" : ""} ORDER BY i.created_at DESC`)
      .bind(...(game ? [caller.player!.id, game] : [caller.player!.id]))
      .all<ItemRow>();
    return { items: r.results.map((x) => itemView(req, x, x.hidden_at !== null ? { hidden_reason: x.hidden_reason } : {})) };
  },
};


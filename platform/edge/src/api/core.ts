// Shared pieces of the HTTP API: errors, ids, hashing, tokens and auth.

import type { Env } from "../index";
import { verifyKey } from "../keys";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public hint = "",
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const bad = (message: string, hint = "") => new ApiError(400, "bad_request", message, hint);
export const notFound = (what: string, hint = "") => new ApiError(404, "not_found", `${what} not found`, hint);
export const forbidden = (message: string, hint = "") => new ApiError(403, "forbidden", message, hint);

export const now = () => Date.now();

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  let s = "";
  for (const b of bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}

export function randomId(bytes = 12): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Lowercase letters and digits only (for ids that end up in keys). */
export function randomSlug(len = 10): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => a[b % a.length]).join("");
}

export async function sha256hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const buf = typeof data === "string" ? enc.encode(data) : data;
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}

function eq(a: string, b: string) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** A signed claim set: `<prefix>_<payload>.<sig>` (player tokens, offline entitlements). */
export async function signClaims(secret: string, prefix: string, claims: Record<string, unknown>): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(claims)));
  return `${prefix}_${body}.${await hmac(secret, `${prefix}.${body}`)}`;
}

export async function verifyClaims<T extends { exp?: number }>(secret: string, prefix: string, token: string): Promise<T | null> {
  const m = new RegExp(`^${prefix}_([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)$`).exec(token);
  if (!m) return null;
  if (!eq(await hmac(secret, `${prefix}.${m[1]}`), m[2])) return null;
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(m[1]))) as T;
  if (claims.exp !== undefined && claims.exp < now()) return null;
  return claims;
}

export const PLAYER_TOKEN_TTL = 30 * 24 * 3600_000;

export async function playerToken(env: Env, playerId: string): Promise<string> {
  return signClaims(env.PLAYER_TOKEN_SECRET, "pt", { pid: playerId, exp: now() + PLAYER_TOKEN_TTL });
}

// ── Auth ──

export interface Caller {
  developer?: { id: string; email: string; name: string };
  tokenId?: string;
  project?: string;
  player?: { id: string; display_name: string; test_developer_id: string | null };
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/** The admin token; on the routes that allow it (moderator), the moderator's token too. */
export async function asAdmin(env: Env, req: Request, moderator = false) {
  const t = bearer(req);
  const ok = (secret?: string) => !!t && !!secret && eq(t, secret);
  if (!ok(env.ADMIN_TOKEN) && !(moderator && ok(env.MODERATOR_TOKEN))) throw new ApiError(401, "unauthorized", moderator ? "admin or moderator token required" : "admin token required", "operators only");
}

export async function asDeveloper(env: Env, req: Request): Promise<Caller> {
  const t = bearer(req);
  if (!t || !t.startsWith("pd_")) throw new ApiError(401, "unauthorized", "developer token required", "set PARTII_TOKEN (from `partii admin developers create` or `partii tokens create`)");
  const row = await env.DB.prepare(
    "SELECT d.id, d.email, d.name, t.id AS token_id FROM dev_tokens t JOIN developers d ON d.id = t.developer_id WHERE t.token_hash = ? AND t.revoked_at IS NULL",
  )
    .bind(await sha256hex(t))
    .first<{ id: string; email: string; name: string; token_id: string }>();
  if (!row) throw new ApiError(401, "unauthorized", "unknown or revoked developer token", "make a new one with `partii tokens create`");
  return { developer: { id: row.id, email: row.email, name: row.name }, tokenId: row.token_id };
}

const revokedCache = new Map<string, { revoked: boolean; at: number }>();

/** Drop a key from this isolate's revocation cache (others refresh within a minute). */
export function forgetKey(project: string, keyId: string) {
  revokedCache.delete(`${project}:${keyId}`);
}

/** The project of a publishable key in X-Partii-Key (signature + revocation). */
export async function asKey(env: Env, req: Request): Promise<Caller> {
  const k = req.headers.get("x-partii-key") ?? new URL(req.url).searchParams.get("key");
  const claims = await verifyKey(env.KEY_SECRET, k);
  if (!claims) throw new ApiError(401, "unauthorized", "a publishable key is required in X-Partii-Key", "make one with `partii keys create <project>`");
  const ck = `${claims.project}:${claims.keyId}`;
  const hit = revokedCache.get(ck);
  let revoked = hit && now() - hit.at < 60_000 ? hit.revoked : undefined;
  if (revoked === undefined) {
    const row = await env.DB.prepare("SELECT revoked_at FROM keys WHERE project_id = ? AND key_id = ?").bind(claims.project, claims.keyId).first<{ revoked_at: number | null }>();
    // Keys signed but never recorded (dev keys) are allowed; recorded and revoked are not.
    revoked = !!row?.revoked_at;
    revokedCache.set(ck, { revoked, at: now() });
  }
  if (revoked) throw new ApiError(401, "unauthorized", "this publishable key was revoked", "ship a current key");
  return { project: claims.project };
}

export async function asPlayer(env: Env, req: Request): Promise<Caller> {
  const caller = await asKey(env, req);
  const t = bearer(req);
  const claims = t ? await verifyClaims<{ pid: string; exp?: number }>(env.PLAYER_TOKEN_SECRET, "pt", t) : null;
  if (!claims) throw new ApiError(401, "unauthorized", "a player token is required", "sign in with POST /v1/players/guest or /v1/players/login");
  const player = await env.DB.prepare("SELECT id, display_name, test_developer_id FROM players WHERE id = ? AND deleted_at IS NULL")
    .bind(claims.pid)
    .first<{ id: string; display_name: string; test_developer_id: string | null }>();
  if (!player) throw new ApiError(401, "unauthorized", "this player no longer exists", "sign in again");
  return { ...caller, player };
}

/** The developer must own this project. */
export async function ownProject(env: Env, c: Caller, project: string) {
  const row = await env.DB.prepare("SELECT id, name, plan, created_at FROM projects WHERE id = ? AND developer_id = ?").bind(project, c.developer!.id).first();
  if (!row) throw notFound(`project ${project}`, "list yours with `partii projects list`");
  return row as { id: string; name: string; plan: string; created_at: number };
}

/** The developer must own this game (through its project). */
export async function ownGame(env: Env, c: Caller, game: string) {
  const row = await env.DB.prepare("SELECT g.* FROM games g JOIN projects p ON p.id = g.project_id WHERE g.id = ? AND p.developer_id = ?").bind(game, c.developer!.id).first();
  if (!row) throw notFound(`game ${game}`, "create it with `partii games put <game> --field project=<project>`");
  return row as unknown as GameRow;
}

export interface GameRow {
  id: string;
  project_id: string;
  title: string;
  tagline: string;
  description: string;
  price_cents: number;
  currency: string;
  sale: string | null;
  demo: string | null;
  platforms: string;
  store: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export function gameView(g: GameRow) {
  return {
    id: g.id,
    project: g.project_id,
    title: g.title,
    tagline: g.tagline,
    description: g.description,
    price_cents: g.price_cents,
    currency: g.currency,
    sale: g.sale ? JSON.parse(g.sale) : null,
    demo: g.demo ? JSON.parse(g.demo) : null,
    platforms: JSON.parse(g.platforms),
    store: JSON.parse(g.store),
    status: g.status,
    updated_at: g.updated_at,
  };
}

/** The price right now (sale applied while it runs). */
export function currentPrice(g: GameRow, at = now()): number {
  const sale = g.sale ? (JSON.parse(g.sale) as { percent: number; starts_at?: number; ends_at?: number }) : null;
  if (sale && (sale.starts_at ?? 0) <= at && at < (sale.ends_at ?? Infinity)) return Math.round((g.price_cents * (100 - sale.percent)) / 100);
  return g.price_cents;
}

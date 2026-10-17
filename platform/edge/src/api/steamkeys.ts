// Steam keys: a developer loads Steamworks keys for a game; each player who
// owns the game through partii (a purchase, a grant or a code) gets one key,
// shown in their library with a one-click "activate on Steam" link. A refund
// revokes the buyer's key here (the developer bans it in Steamworks: the key
// list shows which). Keys are encrypted at rest and only ever shown to the
// player they're assigned to, or to the game's developer.

import type { Env } from "../index";
import { reportPlatformError } from "./analytics";
import { ApiError, b64url, bad, fromB64url, now, ownGame, sha256hex } from "./core";
import type { Handlers } from "./index";
import { cryptoKey } from "./secrets";

export const STEAM_KEY_LIMITS = { perUpload: 5000, lowWater: 10 };
/** Steam product keys: 3–5 groups of 5 letters/digits (AAAAA-BBBBB-CCCCC). */
const KEY = /^[A-Z0-9]{5}(-[A-Z0-9]{5}){2,4}$/;
/** Ownership that comes with a Steam key: bought or given on partii (not App Store or Steam purchases). */
const KEYED_SOURCES = ["stripe", "fake", "grant", "code"];

const aad = (game: string) => new TextEncoder().encode(`partii-steam-key:${game}`);
export const activateUrl = (key: string) => `https://store.steampowered.com/account/registerkey?key=${encodeURIComponent(key)}`;

interface KeyRow {
  game_id: string;
  key_hash: string;
  key_enc: string;
  iv: string;
  last5: string;
  batch: string;
  added_at: number;
  player_id: string | null;
  source: string | null;
  ref: string | null;
  assigned_at: number | null;
  revoked_at: number | null;
  revoked_reason: string | null;
}

async function seal(env: Env, game: string, key: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(game) }, await cryptoKey(env), new TextEncoder().encode(key));
  return { key_enc: b64url(ct), iv: b64url(iv) };
}

async function unseal(env: Env, r: Pick<KeyRow, "game_id" | "key_enc" | "iv">): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(r.iv), additionalData: aad(r.game_id) }, await cryptoKey(env), fromB64url(r.key_enc));
  return new TextDecoder().decode(pt);
}

const free = (env: Env, game: string) =>
  env.DB.prepare("SELECT COUNT(*) AS n FROM steam_keys WHERE game_id = ? AND player_id IS NULL AND revoked_at IS NULL").bind(game).first<{ n: number }>().then((r) => Number(r?.n ?? 0));

/**
 * The player's Steam key for the game: the one they have, or the next free one when
 * they own the game through partii. Null when the game has no keys or they don't own it.
 */
export async function steamKeyFor(env: Env, player: string, game: string, assign = true): Promise<{ key: string; activate_url: string; assigned_at: number; revoked: boolean } | null> {
  const view = async (r: KeyRow) => {
    const key = await unseal(env, r);
    return { key, activate_url: activateUrl(key), assigned_at: r.assigned_at!, revoked: r.revoked_at !== null };
  };
  const mine = await env.DB.prepare("SELECT * FROM steam_keys WHERE game_id = ? AND player_id = ?").bind(game, player).first<KeyRow>();
  if (mine) return view(mine);
  if (!assign) return null;
  const ent = await env.DB.prepare(`SELECT source, ref FROM entitlements WHERE player_id = ? AND game_id = ? AND revoked_at IS NULL AND source IN (${KEYED_SOURCES.map(() => "?").join(",")})`)
    .bind(player, game, ...KEYED_SOURCES)
    .first<{ source: string; ref: string }>();
  if (!ent) return null;
  // One statement, so two requests can't take the same key; the unique index keeps it one per player.
  let r: KeyRow | null = null;
  try {
    r = await env.DB.prepare(
      "UPDATE steam_keys SET player_id = ?, source = ?, ref = ?, assigned_at = ? WHERE game_id = ? AND key_hash = (SELECT key_hash FROM steam_keys WHERE game_id = ? AND player_id IS NULL AND revoked_at IS NULL ORDER BY added_at, rowid LIMIT 1) AND player_id IS NULL RETURNING *",
    )
      .bind(player, ent.source, ent.ref, now(), game, game)
      .first<KeyRow>();
  } catch {
    // Another request assigned this player's key a moment ago.
    const again = await env.DB.prepare("SELECT * FROM steam_keys WHERE game_id = ? AND player_id = ?").bind(game, player).first<KeyRow>();
    return again ? view(again) : null;
  }
  const left = await free(env, game);
  if (!r) {
    // Keys were loaded once but ran out: tell the developer through partii's error dashboard.
    const any = await env.DB.prepare("SELECT 1 FROM steam_keys WHERE game_id = ? LIMIT 1").bind(game).first();
    if (any) await reportPlatformError(env, { kind: "error", message: `steam keys: ${game} is out of Steam keys`, context: { game } });
    return null;
  }
  if (left < STEAM_KEY_LIMITS.lowWater) await reportPlatformError(env, { kind: "warning", message: `steam keys: ${game} has fewer than ${STEAM_KEY_LIMITS.lowWater} Steam keys left`, context: { game, left } });
  return view(r);
}

/** A refund: the key bought with that payment is revoked (the developer bans it in Steamworks). */
export async function revokeSteamKeysFor(env: Env, ref: string, reason: string) {
  await env.DB.prepare("UPDATE steam_keys SET revoked_at = ?, revoked_reason = ? WHERE ref = ? AND revoked_at IS NULL").bind(now(), reason, ref).run();
}

/** A guest signing in: its key moves to the account (unless the account has one for that game). */
export async function mergeSteamKeys(env: Env, guest: string, into: string) {
  await env.DB.prepare("UPDATE OR IGNORE steam_keys SET player_id = ? WHERE player_id = ?").bind(into, guest).run();
}

export const steamKeyHandlers: Handlers = {
  async steamKeysAdd({ env, caller, params, body, dryRun }) {
    const g = await ownGame(env, caller, params.game);
    const raw = Array.isArray(body.keys) ? body.keys.map(String).join("\n") : String(body.keys ?? "");
    const tokens = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!tokens.length) throw bad("keys is the Steam keys, one per line (or an array)", "partii steam-keys add <game> --keys @keys.txt");
    if (tokens.length > STEAM_KEY_LIMITS.perUpload) throw bad(`at most ${STEAM_KEY_LIMITS.perUpload} keys per upload`);
    const invalid = tokens.filter((t) => !KEY.test(t));
    const valid = [...new Set(tokens.filter((t) => KEY.test(t)))];
    const batch = String(body.batch ?? "").slice(0, 60);
    const t = now();
    const rows = await Promise.all(valid.map(async (k) => ({ k, hash: await sha256hex(`${g.id}:${k}`) })));
    if (dryRun) return { dry_run: true, valid: valid.length, invalid: invalid.length, invalid_examples: invalid.slice(0, 5) };
    let added = 0;
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      const stmts = await Promise.all(
        chunk.map(async ({ k, hash }) => {
          const s = await seal(env, g.id, k);
          return env.DB.prepare("INSERT OR IGNORE INTO steam_keys (game_id, key_hash, key_enc, iv, last5, batch, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(g.id, hash, s.key_enc, s.iv, k.slice(-5), batch, t);
        }),
      );
      for (const r of await env.DB.batch(stmts)) added += r.meta.changes ?? 0;
    }
    return { added, already_loaded: valid.length - added, invalid: invalid.length, invalid_examples: invalid.slice(0, 5), available: await free(env, g.id) };
  },

  async steamKeysList({ env, caller, params, query }) {
    const g = await ownGame(env, caller, params.game);
    const counts = await env.DB.prepare(
      "SELECT SUM(player_id IS NULL AND revoked_at IS NULL) AS available, SUM(player_id IS NOT NULL AND revoked_at IS NULL) AS assigned, SUM(revoked_at IS NOT NULL) AS revoked, COUNT(*) AS total FROM steam_keys WHERE game_id = ?",
    )
      .bind(g.id)
      .first<Record<string, number | null>>();
    const status = String(query.status ?? "assigned");
    if (!["assigned", "revoked", "available"].includes(status)) throw bad("status is assigned, revoked or available");
    const where = status === "available" ? "player_id IS NULL AND revoked_at IS NULL" : status === "revoked" ? "revoked_at IS NOT NULL" : "player_id IS NOT NULL AND revoked_at IS NULL";
    const r = await env.DB.prepare(`SELECT * FROM steam_keys WHERE game_id = ? AND ${where} ORDER BY COALESCE(assigned_at, added_at) DESC LIMIT 500`).bind(g.id).all<KeyRow>();
    // Full keys for assigned and revoked ones (support, and banning refunds in Steamworks); free ones by their last 5.
    const keys = await Promise.all(
      r.results.map(async (k) => ({
        ...(status === "available" ? { last5: k.last5 } : { key: await unseal(env, k) }),
        batch: k.batch,
        added_at: k.added_at,
        ...(status === "available" ? {} : { player: k.player_id, source: k.source, ref: k.ref, assigned_at: k.assigned_at, revoked_at: k.revoked_at, revoked_reason: k.revoked_reason }),
      })),
    );
    const n = (x: number | null | undefined) => Number(x ?? 0);
    return { counts: { available: n(counts?.available), assigned: n(counts?.assigned), revoked: n(counts?.revoked), total: n(counts?.total) }, status, keys };
  },

  async steamKeysRemove({ env, caller, params, body, dryRun }) {
    const g = await ownGame(env, caller, params.game);
    const keys = (Array.isArray(body.keys) ? body.keys.map(String) : String(body.keys ?? "").split(/[\s,;]+/)).map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!keys.length) throw bad("keys is the unassigned keys to take out of the pool");
    const hashes = await Promise.all(keys.map((k) => sha256hex(`${g.id}:${k}`)));
    if (dryRun) return { dry_run: true, keys: keys.length };
    let removed = 0;
    for (const h of hashes) removed += (await env.DB.prepare("DELETE FROM steam_keys WHERE game_id = ? AND key_hash = ? AND player_id IS NULL").bind(g.id, h).run()).meta.changes ?? 0;
    return { removed, not_removed: keys.length - removed, hint: keys.length - removed ? "assigned keys stay (a player has them); unknown keys are skipped" : undefined, available: await free(env, g.id) };
  },

  async storeSteamKey({ env, caller, params }) {
    const g = await env.DB.prepare("SELECT id FROM games WHERE id = ?").bind(params.game).first<{ id: string }>();
    if (!g) throw new ApiError(404, "not_found", `no game ${params.game}`);
    const k = await steamKeyFor(env, caller.player!.id, g.id);
    if (!k) throw new ApiError(404, "no_steam_key", "no Steam key for you on this game", "Steam keys come with owning the game on partii, when the developer has loaded keys");
    return { steam_key: k };
  },
};

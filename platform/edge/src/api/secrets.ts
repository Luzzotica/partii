// Per-game secrets and config: credentials a game's developer stores for
// the platform to use on the game's behalf (Steam's Web API key, …). Secret
// values are encrypted with SECRETS_KEY (AES-GCM, bound to game and name) and
// are never returned, not even to the developer: only "set, last 4, when".
// Config values (Steam app ids) are not secret and are shown in full.
// Changing them takes a developer token, never the game's publishable key.

import type { Env } from "../index";
import { ApiError, b64url, bad, fromB64url, now, ownGame } from "./core";
import type { Handlers } from "./index";

interface Spec {
  secret: boolean;
  about: string;
  /** Validate and normalize a value. */
  check(v: string): string;
}

export const SECRET_NAMES: Record<string, Spec> = {
  "steam.web_api_key": {
    secret: true,
    about: "Steamworks publisher Web API key (Users & Permissions > Manage Groups); one key serves every app in the group",
    check(v) {
      if (!/^[0-9A-Fa-f]{32}$/.test(v)) throw bad("steam.web_api_key is the 32 hex characters from Steamworks");
      return v.toUpperCase();
    },
  },
  "steam.app_ids": {
    secret: false,
    about: "the game's Steam app ids, comma-separated (full game, demo, playtest)",
    check(v) {
      const ids = v.split(",").map((s) => s.trim()).filter(Boolean);
      if (!ids.length || ids.length > 10 || !ids.every((x) => /^\d{1,10}$/.test(x))) throw bad("steam.app_ids is up to 10 numeric app ids, comma-separated");
      return [...new Set(ids)].join(",");
    },
  },
};

async function cryptoKey(env: Env): Promise<CryptoKey> {
  if (!env.SECRETS_KEY) throw new ApiError(501, "secrets_unavailable", "this platform has no SECRETS_KEY, so it can't store secrets", "platform operators: set SECRETS_KEY (32 random bytes, base64url)");
  const raw = fromB64url(env.SECRETS_KEY);
  if (raw.byteLength !== 32) throw new ApiError(500, "internal", "SECRETS_KEY must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const aad = (game: string, name: string) => new TextEncoder().encode(`partii-secret:${game}:${name}`);

function spec(name: string): Spec {
  const s = SECRET_NAMES[name];
  if (!s) throw bad(`unknown secret ${name}`, `one of ${Object.keys(SECRET_NAMES).join(", ")}`);
  return s;
}

/** A game's secret or config value, decrypted (server-side use only). Null when not set. */
export async function gameSecret(env: Env, game: string, name: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT secret, value, iv FROM game_secrets WHERE game_id = ? AND name = ?").bind(game, name).first<{ secret: number; value: string; iv: string | null }>();
  if (!row) return null;
  if (!row.secret) return row.value;
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(row.iv!), additionalData: aad(game, name) }, await cryptoKey(env), fromB64url(row.value));
  return new TextDecoder().decode(plain);
}

export const secretHandlers: Handlers = {
  async secretsList({ env, caller, params }) {
    await ownGame(env, caller, params.game);
    const r = await env.DB.prepare("SELECT name, secret, value, last4, updated_at FROM game_secrets WHERE game_id = ? ORDER BY name").bind(params.game).all<{ name: string; secret: number; value: string; last4: string; updated_at: number }>();
    const set = new Map(r.results.map((x) => [x.name, x]));
    return {
      secrets: Object.entries(SECRET_NAMES).map(([name, s]) => {
        const x = set.get(name);
        return { name, secret: s.secret, about: s.about, set: !!x, ...(x ? (s.secret ? { last4: x.last4 } : { value: x.value }) : {}), updated_at: x?.updated_at ?? null };
      }),
    };
  },

  async secretsSet({ env, caller, params, body, dryRun }) {
    await ownGame(env, caller, params.game);
    const s = spec(params.name);
    const value = s.check(String(body.value ?? "").trim());
    const last4 = value.slice(-4);
    if (dryRun) return { dry_run: true, secret: { name: params.name, set: true, ...(s.secret ? { last4 } : { value }) } };
    let stored = value;
    let iv: string | null = null;
    if (s.secret) {
      const ivBytes = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: ivBytes, additionalData: aad(params.game, params.name) }, await cryptoKey(env), new TextEncoder().encode(value));
      stored = b64url(ct);
      iv = b64url(ivBytes);
    }
    const at = now();
    await env.DB.prepare(
      "INSERT INTO game_secrets (game_id, name, secret, value, iv, last4, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET secret = excluded.secret, value = excluded.value, iv = excluded.iv, last4 = excluded.last4, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    )
      .bind(params.game, params.name, s.secret ? 1 : 0, stored, iv, last4, at, caller.developer!.id)
      .run();
    return { secret: { name: params.name, set: true, ...(s.secret ? { last4 } : { value }), updated_at: at } };
  },

  async secretsDelete({ env, caller, params, dryRun }) {
    await ownGame(env, caller, params.game);
    spec(params.name);
    if (dryRun) return { dry_run: true, name: params.name };
    const r = await env.DB.prepare("DELETE FROM game_secrets WHERE game_id = ? AND name = ?").bind(params.game, params.name).run();
    return { deleted: (r.meta.changes ?? 0) > 0, name: params.name };
  },
};

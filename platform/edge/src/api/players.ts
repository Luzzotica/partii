import { files } from "../files";
// Players: guest sign-in, email codes, provider logins (merging a guest into
// the account it signs in to), the account itself, entitlements (with a
// signed copy games trust offline), key redemption, store receipts, and
// test players for developers.

import type { Env } from "../index";
import { ApiError, bad, now, playerToken, randomSlug, sha256hex, signClaims } from "./core";
import { grant } from "./games";
import type { Ctx, Handlers } from "./index";
import { verifyProvider } from "./providers";
import { steamTicketSubject } from "./steam";
import { deleteUgcOf, mergeUgc } from "./ugc";
import { deleteScoresOf, mergeScores } from "./leaderboards";

const OFFLINE_TTL = 7 * 86400_000;

async function providersOf(env: Env, player: string): Promise<string[]> {
  const r = await env.DB.prepare("SELECT provider FROM identities WHERE player_id = ? ORDER BY created_at").bind(player).all<{ provider: string }>();
  return r.results.map((x) => x.provider);
}

async function view(env: Env, p: { id: string; display_name: string; test_developer_id?: string | null; created_at?: number }) {
  return { id: p.id, display_name: p.display_name, providers: await providersOf(env, p.id), test: !!p.test_developer_id, created_at: p.created_at };
}

async function newPlayer(env: Env, name: string, testDeveloper: string | null = null) {
  const p = { id: `p_${randomSlug(14)}`, display_name: name.slice(0, 40), test_developer_id: testDeveloper, created_at: now() };
  await env.DB.prepare("INSERT INTO players (id, display_name, test_developer_id, created_at) VALUES (?, ?, ?, ?)").bind(p.id, p.display_name, testDeveloper, p.created_at).run();
  return p;
}

/** Move everything a guest has into `into`, then retire the guest. */
async function merge(env: Env, guest: string, into: string) {
  if (guest === into) return;
  // Saves: keep whichever copy of a slot is newer.
  const gs = await env.DB.prepare("SELECT game_id, slot, rev, updated_at FROM saves WHERE player_id = ?").bind(guest).all<{ game_id: string; slot: string; rev: number; updated_at: number }>();
  for (const s of gs.results) {
    const mine = await env.DB.prepare("SELECT updated_at FROM saves WHERE player_id = ? AND game_id = ? AND slot = ?").bind(into, s.game_id, s.slot).first<{ updated_at: number }>();
    if (mine && mine.updated_at >= s.updated_at) continue;
    const obj = await files(env).get(`saves/${guest}/${s.game_id}/${s.slot}/${s.rev}`);
    if (!obj) continue;
    const data = await obj.arrayBuffer();
    const rev = ((await env.DB.prepare("SELECT rev FROM saves WHERE player_id = ? AND game_id = ? AND slot = ?").bind(into, s.game_id, s.slot).first<{ rev: number }>())?.rev ?? 0) + 1;
    await files(env).put(`saves/${into}/${s.game_id}/${s.slot}/${rev}`, data);
    await env.DB.prepare("INSERT INTO saves (player_id, game_id, slot, rev, size, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET rev = excluded.rev, size = excluded.size, updated_at = excluded.updated_at")
      .bind(into, s.game_id, s.slot, rev, data.byteLength, s.updated_at)
      .run();
  }
  await mergeUgc(env, guest, into);
  await mergeScores(env, guest, into);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO entitlements (player_id, game_id, sku, source, ref, created_at, revoked_at) SELECT ?, game_id, sku, source, ref, created_at, revoked_at FROM entitlements WHERE player_id = ?").bind(into, guest),
    env.DB.prepare("DELETE FROM entitlements WHERE player_id = ?").bind(guest),
    env.DB.prepare("UPDATE identities SET player_id = ? WHERE player_id = ?").bind(into, guest),
    env.DB.prepare("UPDATE purchases SET player_id = ? WHERE player_id = ?").bind(into, guest),
    env.DB.prepare("UPDATE codes SET redeemed_by = ? WHERE redeemed_by = ?").bind(into, guest),
    env.DB.prepare("DELETE FROM saves WHERE player_id = ?").bind(guest),
    env.DB.prepare("UPDATE players SET deleted_at = ? WHERE id = ?").bind(now(), guest),
  ]);
}

/** The guest calling (if a valid player token came along). */
export async function currentPlayer(ctx: Ctx): Promise<string | null> {
  const h = ctx.req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer pt_")) return null;
  const { verifyClaims } = await import("./core");
  const c = await verifyClaims<{ pid: string; exp?: number }>(ctx.env.PLAYER_TOKEN_SECRET, "pt", h.slice(7));
  if (!c) return null;
  const p = await ctx.env.DB.prepare("SELECT id FROM players WHERE id = ? AND deleted_at IS NULL").bind(c.pid).first();
  return p ? c.pid : null;
}

async function sendEmail(env: Env, to: string, code: string): Promise<boolean> {
  if (env.EMAIL_MODE !== "resend" || !env.RESEND_API_KEY) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM ?? "partii <login@partii.dev>", to, subject: `Your partii code: ${code}`, text: `Your sign-in code is ${code}. It works for 10 minutes.` }),
  });
  return res.ok;
}

/**
 * Sign in to the player who owns this identity. A guest calling (`current`)
 * is linked to it, or merged into the player who already has it.
 */
export async function signIn(env: Env, provider: string, subject: string, current: string | null, name: string) {
  const owner = await env.DB.prepare("SELECT player_id FROM identities WHERE provider = ? AND subject = ?").bind(provider, subject).first<{ player_id: string }>();
  let playerId: string;
  let merged = false;
  if (owner) {
    playerId = owner.player_id;
    if (current && current !== playerId) {
      await merge(env, current, playerId);
      merged = true;
    }
  } else if (current) {
    playerId = current; // upgrade the guest: link this identity to it
    await env.DB.prepare("INSERT INTO identities (provider, subject, player_id, created_at) VALUES (?, ?, ?, ?)").bind(provider, subject, playerId, now()).run();
  } else {
    const p = await newPlayer(env, name);
    playerId = p.id;
    await env.DB.prepare("INSERT INTO identities (provider, subject, player_id, created_at) VALUES (?, ?, ?, ?)").bind(provider, subject, playerId, now()).run();
  }
  const p = await env.DB.prepare("SELECT id, display_name, test_developer_id, created_at FROM players WHERE id = ?").bind(playerId).first<{ id: string; display_name: string }>();
  return { player: await view(env, p!), player_token: await playerToken(env, playerId), merged };
}

export const playerHandlers: Handlers = {
  async playersGuest({ env, body }) {
    const device = String(body.device_id ?? "");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(device)) throw bad("device_id must be 8–80 chars of [A-Za-z0-9_-]", "generate a random id once per install and keep it");
    const known = await env.DB.prepare("SELECT p.id, p.display_name, p.test_developer_id, p.created_at FROM identities i JOIN players p ON p.id = i.player_id WHERE i.provider = 'device' AND i.subject = ? AND p.deleted_at IS NULL")
      .bind(device)
      .first<{ id: string; display_name: string; created_at: number }>();
    const p = known ?? (await newPlayer(env, String(body.display_name ?? "Player")));
    if (!known) await env.DB.prepare("INSERT INTO identities (provider, subject, player_id, created_at) VALUES ('device', ?, ?, ?)").bind(device, p.id, now()).run();
    return { player: await view(env, p), player_token: await playerToken(env, p.id), created: !known };
  },

  async playersEmailStart({ env, body }) {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad("a valid email is required");
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    await env.DB.prepare("INSERT INTO email_codes (email, code_hash, expires_at, tries) VALUES (?, ?, ?, 0) ON CONFLICT DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0")
      .bind(email, await sha256hex(`${email}:${code}`), now() + 10 * 60_000)
      .run();
    const sent = await sendEmail(env, email, code);
    if (sent) return { sent: true };
    // Production never hands the code to the caller: that would let anyone
    // sign in as any address.
    if (env.PARTII_ENV === "production") {
      throw new ApiError(503, "email_unavailable", "sign-in emails can't be sent right now", "sign in with another provider, or try again later");
    }
    // Without a mail provider (dev, staging) the code comes back so tests and
    // agents can finish the flow.
    return { sent: false, code, note: "no mail provider configured; the code is returned instead" };
  },

  async playersLogin(ctx) {
    const { env, body } = ctx;
    const provider = String(body.provider ?? "");
    // Steam checks the ticket with the game's own key when it has one.
    const subject = provider === "steam" ? await steamTicketSubject(env, ctx.caller.project!, body) : await verifyProvider(env, provider, body);
    const name = String(body.display_name ?? (provider === "email" ? String(body.email).split("@")[0] : "Player"));
    return signIn(env, provider, subject, await currentPlayer(ctx), name);
  },

  async playersMe({ env, caller }) {
    return { player: await view(env, caller.player!) };
  },

  async playersUpdate({ env, caller, body }) {
    const name = String(body.display_name ?? "").trim().slice(0, 40);
    if (!name) throw bad("display_name is required");
    await env.DB.prepare("UPDATE players SET display_name = ? WHERE id = ?").bind(name, caller.player!.id).run();
    return { player: await view(env, { ...caller.player!, display_name: name }) };
  },

  async playersDelete({ env, caller }) {
    const id = caller.player!.id;
    const saves = await files(env).list(`saves/${id}/`);
    for (const o of saves) await files(env).delete(o.key);
    await deleteUgcOf(env, id);
    await deleteScoresOf(env, id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM identities WHERE player_id = ?").bind(id),
      env.DB.prepare("DELETE FROM saves WHERE player_id = ?").bind(id),
      env.DB.prepare("DELETE FROM entitlements WHERE player_id = ?").bind(id),
      env.DB.prepare("UPDATE purchases SET player_id = NULL WHERE player_id = ?").bind(id),
      // Statistics stay, anonymous: the device's install id is all that's left.
      env.DB.prepare("UPDATE events SET player_id = NULL WHERE player_id = ?").bind(id),
      env.DB.prepare("UPDATE error_samples SET player_id = NULL WHERE player_id = ?").bind(id),
      env.DB.prepare("UPDATE players SET deleted_at = ?, display_name = '' WHERE id = ?").bind(now(), id),
    ]);
    return { deleted: true };
  },

  async playersEntitlements({ env, caller, query }) {
    const game = query.game ? String(query.game) : null;
    const r = await env.DB.prepare(`SELECT game_id AS game, sku, source, ref, created_at FROM entitlements WHERE player_id = ? AND revoked_at IS NULL${game ? " AND game_id = ?" : ""}`)
      .bind(...(game ? [caller.player!.id, game] : [caller.player!.id]))
      .all<{ game: string; sku: string }>();
    const signed = await signClaims(env.PLAYER_TOKEN_SECRET, "pe", { pid: caller.player!.id, owns: r.results.map((e) => `${e.game}:${e.sku}`), exp: now() + OFFLINE_TTL });
    return { entitlements: r.results, signed };
  },

  async playersRedeem({ env, caller, body }) {
    const code = String(body.code ?? "").trim().toUpperCase();
    const row = await env.DB.prepare("SELECT code, game_id, redeemed_by FROM codes WHERE code = ?").bind(code).first<{ game_id: string; redeemed_by: string | null }>();
    if (!row) throw new ApiError(404, "not_found", "no such key", "check the key for typos");
    if (row.redeemed_by && row.redeemed_by !== caller.player!.id) throw new ApiError(409, "used", "this key was already redeemed");
    await env.DB.prepare("UPDATE codes SET redeemed_by = ?, redeemed_at = ? WHERE code = ?").bind(caller.player!.id, now(), code).run();
    return { entitlement: await grant(env, caller.player!.id, row.game_id, "code", code) };
  },

  async playersReceipt({ env, caller, body }) {
    const { verifyReceipt } = await import("./receipts");
    const game = String(body.game ?? "");
    const g = await env.DB.prepare("SELECT id FROM games WHERE id = ?").bind(game).first();
    if (!g) throw bad(`no game ${game}`);
    const v = await verifyReceipt(env, String(body.store ?? ""), game, body);
    const me = caller.player!.id;
    // One partii account per store purchase. A guest's claim moves to whoever
    // presents it next (a reinstall or a new device); a signed-in account keeps it.
    const prior = await env.DB.prepare("SELECT player_id FROM purchases WHERE ref = ?").bind(v.ref).first<{ player_id: string | null }>();
    if (prior?.player_id && prior.player_id !== me) {
      const signedIn = await env.DB.prepare("SELECT 1 FROM identities WHERE player_id = ? AND provider <> 'device' LIMIT 1").bind(prior.player_id).first();
      const alive = await env.DB.prepare("SELECT 1 FROM players WHERE id = ? AND deleted_at IS NULL").bind(prior.player_id).first();
      if (signedIn && alive) throw new ApiError(409, "claimed_by_another_account", "this purchase already belongs to another partii account", "sign in to the account that bought it (the game is unlocked there on every platform)");
      await env.DB.batch([
        env.DB.prepare("UPDATE purchases SET player_id = ? WHERE ref = ?").bind(me, v.ref),
        env.DB.prepare("UPDATE entitlements SET revoked_at = ? WHERE player_id = ? AND game_id = ? AND ref = ? AND revoked_at IS NULL").bind(now(), prior.player_id, game, v.ref),
      ]);
    } else if (!prior) {
      await env.DB.prepare("INSERT OR IGNORE INTO purchases (id, player_id, game_id, store, ref, amount_cents, currency, status, test, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?)")
        .bind(randomSlug(14), me, game, v.store, v.ref, v.amount_cents ?? 0, v.currency ?? "usd", v.test ? 1 : 0, now())
        .run();
    }
    return { entitlement: await grant(env, me, game, v.store, v.ref), test: v.test };
  },

  async testPlayersCreate({ env, caller, body }) {
    const p = await newPlayer(env, String(body.name ?? "Test player"), caller.developer!.id);
    await env.DB.prepare("INSERT INTO identities (provider, subject, player_id, created_at) VALUES ('test', ?, ?, ?)").bind(`${caller.developer!.id}:${p.id}`, p.id, now()).run();
    return { player: await view(env, p), player_token: await playerToken(env, p.id) };
  },
};

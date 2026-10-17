import { files } from "../files";
// The store: published games, checkout (Stripe), the player's library and
// downloads, test purchases for developers, and Stripe's webhook. Stripe is
// called over plain fetch (no SDK in the Worker). Without a Stripe key the
// platform runs a fake store (dev).

import type { Env } from "../index";
import { ApiError, bad, currentPrice, gameView, now, randomSlug, type GameRow } from "./core";
import { grant } from "./games";
import type { Handlers } from "./index";
import { latestNote } from "./notes";
import { siteUrl } from "./web";
import { recordPlatformEvent } from "./analytics";

async function stripe(env: Env, path: string, form: Record<string, string>, fetcher: typeof fetch = fetch) {
  const res = await fetcher(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const j = (await res.json()) as Record<string, any>;
  if (!res.ok) throw new ApiError(502, "stripe_error", j.error?.message ?? `Stripe answered ${res.status}`, "check the Stripe key on the edge");
  return j;
}

/** Where to play in the browser: a web game's live site (not, say, a desktop game's phone-controller site). */
function playUrl(env: Env, g: GameRow, hasSite: boolean): string | null {
  return hasSite && (JSON.parse(g.platforms) as string[]).includes("web") ? siteUrl(env, g.id) : null;
}

async function published(env: Env, game: string): Promise<GameRow> {
  const g = await env.DB.prepare("SELECT * FROM games WHERE id = ? AND status = 'published'").bind(game).first<GameRow>();
  if (!g) throw new ApiError(404, "not_found", `no published game ${game}`);
  return g;
}

/** Record a paid purchase and grant the game (idempotent on the store ref). */
export async function recordPurchase(env: Env, p: { player: string | null; game: string; store: string; ref: string; amount: number; currency: string; test: boolean }) {
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO purchases (id, player_id, game_id, store, ref, amount_cents, currency, status, test, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?)")
    .bind(randomSlug(14), p.player, p.game, p.store, p.ref, p.amount, p.currency, p.test ? 1 : 0, now())
    .run();
  // Once per purchase: stores repeat their notifications.
  if (ins.meta.changes) await recordPlatformEvent(env, "purchase", { game: p.game, store: p.store, amount_cents: p.amount, currency: p.currency, test: p.test }, p.player);
  return p.player ? grant(env, p.player, p.game, p.store, p.ref) : null;
}

async function verifyStripeSignature(secret: string, header: string, payload: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 600) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${payload}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const sigs = header.split(",").filter((kv) => kv.startsWith("v1=")).map((kv) => kv.slice(3));
  return sigs.some((s) => s.length === hex.length && [...s].every((c, i) => c === hex[i]));
}

export const storeHandlers: Handlers = {
  async storeGames({ env }) {
    const r = await env.DB.prepare("SELECT g.*, w.deploy_id AS site FROM games g LEFT JOIN web_sites w ON w.game_id = g.id WHERE g.status = 'published' ORDER BY g.updated_at DESC").all<GameRow & { site: string | null }>();
    return { games: r.results.map((g) => ({ ...gameView(g), price_now_cents: currentPrice(g), play_url: playUrl(env, g, !!g.site) })) };
  },

  async storeGame({ env, params }) {
    const g = await published(env, params.game);
    const b = await env.DB.prepare(
      "SELECT platform, version, size, created_at FROM builds WHERE game_id = ? AND channel = 'stable' AND created_at = (SELECT MAX(created_at) FROM builds b2 WHERE b2.game_id = builds.game_id AND b2.platform = builds.platform AND b2.channel = 'stable')",
    )
      .bind(g.id)
      .all();
    const site = await env.DB.prepare("SELECT 1 FROM web_sites WHERE game_id = ?").bind(g.id).first();
    return { game: { ...gameView(g), price_now_cents: currentPrice(g), play_url: playUrl(env, g, !!site) }, builds: b.results, latest_note: await latestNote(env, g.id) };
  },

  async storeCheckout({ env, caller, params, body }) {
    const g = await published(env, params.game);
    const owned = await env.DB.prepare("SELECT 1 FROM entitlements WHERE player_id = ? AND game_id = ? AND revoked_at IS NULL").bind(caller.player!.id, g.id).first();
    if (owned) throw new ApiError(409, "owned", "you already own this game");
    const amount = currentPrice(g);
    if (!env.STRIPE_SECRET_KEY) {
      // Dev: the fake store completes at once.
      const ref = `fake:${randomSlug(12)}`;
      await recordPurchase(env, { player: caller.player!.id, game: g.id, store: "fake", ref, amount, currency: g.currency, test: true });
      return { url: null, session: ref, completed: true };
    }
    const base = env.STORE_URL ?? "https://partii.games";
    const s = await stripe(env, "checkout/sessions", {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": g.currency,
      "line_items[0][price_data][unit_amount]": String(amount),
      "line_items[0][price_data][product_data][name]": g.title,
      success_url: String(body.success_url ?? `${base}/library?bought=${g.id}`),
      cancel_url: String(body.cancel_url ?? `${base}/games/${g.id}`),
      client_reference_id: caller.player!.id,
      "metadata[player]": caller.player!.id,
      "metadata[game]": g.id,
      "payment_intent_data[metadata][player]": caller.player!.id,
      "payment_intent_data[metadata][game]": g.id,
      // Stripe promotion codes (giveaways, press, the owner's own tests); a 100%-off one completes with no payment.
      allow_promotion_codes: "true",
    });
    return { url: s.url, session: s.id, completed: false };
  },

  async storeLibrary({ env, caller }) {
    const r = await env.DB.prepare(
      "SELECT g.*, e.source, e.created_at AS owned_at FROM entitlements e JOIN games g ON g.id = e.game_id WHERE e.player_id = ? AND e.revoked_at IS NULL ORDER BY e.created_at DESC",
    )
      .bind(caller.player!.id)
      .all<GameRow & { source: string; owned_at: number }>();
    return { games: r.results.map((g) => ({ ...gameView(g), owned_via: g.source, owned_at: g.owned_at })) };
  },

  async storeDownload({ env, caller, params }) {
    const g = await env.DB.prepare("SELECT * FROM games WHERE id = ?").bind(params.game).first<GameRow>();
    if (!g) throw new ApiError(404, "not_found", `no game ${params.game}`);
    const owns = await env.DB.prepare("SELECT 1 FROM entitlements WHERE player_id = ? AND game_id = ? AND revoked_at IS NULL").bind(caller.player!.id, g.id).first();
    if (!owns && !g.demo && g.price_cents > 0) throw new ApiError(402, "not_owned", "buy the game to download it", "POST /v1/store/games/{game}/checkout");
    const b = await env.DB.prepare("SELECT r2_key, filename FROM builds WHERE game_id = ? AND platform = ? AND channel = 'stable' ORDER BY created_at DESC LIMIT 1").bind(g.id, params.platform).first<{ r2_key: string; filename: string }>();
    if (!b) throw new ApiError(404, "not_found", `no ${params.platform} build yet`);
    const o = await files(env).get(b.r2_key);
    if (!o) throw new ApiError(404, "not_found", "the build file is missing");
    return new Response(o.body, { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${b.filename}"`, "content-length": String(o.size) } });
  },

  async testPurchase({ env, caller, body }) {
    const game = String(body.game ?? "");
    const g = await env.DB.prepare("SELECT g.* FROM games g JOIN projects p ON p.id = g.project_id WHERE g.id = ? AND p.developer_id = ?").bind(game, caller.developer!.id).first<GameRow>();
    if (!g) throw new ApiError(404, "not_found", `game ${game} not found`, "test purchases are for your own games");
    const player = await env.DB.prepare("SELECT id FROM players WHERE id = ? AND deleted_at IS NULL").bind(String(body.player ?? "")).first<{ id: string }>();
    if (!player) throw bad(`no player ${body.player}`, "make one with `partii test players create`");
    const amount = currentPrice(g);
    if (!env.STRIPE_SECRET_KEY) {
      if (env.PARTII_ENV === "production") throw new ApiError(403, "live_mode", "production has no fake store", "make test purchases on staging");
      const ref = `fake:${randomSlug(12)}`;
      const entitlement = await recordPurchase(env, { player: player.id, game, store: "fake", ref, amount, currency: g.currency, test: true });
      return { purchase: { store: "fake", ref, amount_cents: amount }, entitlement };
    }
    if (!env.STRIPE_SECRET_KEY.startsWith("sk_test_")) throw new ApiError(403, "live_mode", "test purchases need a Stripe test key", "this edge runs with a live key");
    // A real Stripe test-mode payment, paid with Stripe's test card.
    const pi = await stripe(env, "payment_intents", {
      amount: String(Math.max(amount, 50)),
      currency: g.currency,
      payment_method: "pm_card_visa",
      confirm: "true",
      "automatic_payment_methods[enabled]": "true",
      "automatic_payment_methods[allow_redirects]": "never",
      "metadata[player]": player.id,
      "metadata[game]": game,
      "metadata[test]": "1",
    });
    if (pi.status !== "succeeded") throw new ApiError(402, "payment_failed", `Stripe says ${pi.status}`);
    const entitlement = await recordPurchase(env, { player: player.id, game, store: "stripe", ref: pi.id, amount: pi.amount, currency: pi.currency, test: true });
    return { purchase: { store: "stripe", ref: pi.id, amount_cents: pi.amount, status: pi.status }, entitlement };
  },

  async webhookStripe({ env, req }) {
    const payload = await req.text();
    if (!env.STRIPE_WEBHOOK_SECRET || !(await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, req.headers.get("stripe-signature") ?? "", payload))) {
      throw new ApiError(400, "bad_signature", "not a Stripe-signed event");
    }
    const ev = JSON.parse(payload) as { type: string; data: { object: Record<string, any> } };
    const o = ev.data.object;
    // "no_payment_required": a promotion code took the price to zero.
    if (ev.type === "checkout.session.completed" && (o.payment_status === "paid" || o.payment_status === "no_payment_required") && o.metadata?.game) {
      await recordPurchase(env, { player: o.metadata.player ?? null, game: o.metadata.game, store: "stripe", ref: o.payment_intent ?? o.id, amount: o.amount_total ?? 0, currency: o.currency ?? "usd", test: !o.livemode });
    } else if (ev.type === "payment_intent.succeeded" && o.metadata?.game) {
      await recordPurchase(env, { player: o.metadata.player ?? null, game: o.metadata.game, store: "stripe", ref: o.id, amount: o.amount ?? 0, currency: o.currency ?? "usd", test: !o.livemode });
    } else if (ev.type === "charge.refunded" && o.payment_intent) {
      await env.DB.prepare("UPDATE purchases SET status = 'refunded' WHERE ref = ?").bind(o.payment_intent).run();
      await env.DB.prepare("UPDATE entitlements SET revoked_at = ? WHERE ref = ?").bind(now(), o.payment_intent).run();
    }
    return { received: true };
  },
};

export { verifyStripeSignature };

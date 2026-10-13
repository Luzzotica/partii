// Steam sign-in for every game. Two ways in, one identity ("steam", the
// Steam id), so both reach the same player:
// * Ticket: the game gets a ticket from the Steam client and partii checks
//   it with the game's own Steamworks key (game secret steam.web_api_key)
//   against the game's app ids (steam.app_ids). A game without a key gets
//   steam_not_set_up, its cue to use the browser instead.
// * Browser ("Sign in through Steam", OpenID 2.0): needs no key. The game
//   gets a URL and a poll secret, the player signs in at steamcommunity.com,
//   Steam sends the browser back here, partii verifies the assertion with
//   Steam, and the game's next poll gets the player token.

import type { Env } from "../index";
import { allowed } from "../limits";
import { ApiError, bad, now, randomId, randomSlug, sha256hex } from "./core";
import type { Handlers } from "./index";
import { currentPlayer, signIn } from "./players";
import { steamTicket, verifySteamTicket } from "./providers";
import { gameSecret } from "./secrets";

const OPENID = "https://steamcommunity.com/openid/login";
const CLAIMED = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
/** Long enough for a player to find the browser tab, sign in to Steam and approve. */
const OPENID_TTL = 30 * 60_000;
/** Ticket checks tried per login when the game doesn't say which app issued it. */
const MAX_APPS_TRIED = 5;

/** The game a login is for: named, or the key's project's only game. It must belong to the key's project. */
async function loginGame(env: Env, project: string, game: unknown): Promise<string | null> {
  if (game !== undefined && game !== null && game !== "") {
    const g = await env.DB.prepare("SELECT id FROM games WHERE id = ? AND project_id = ?").bind(String(game), project).first<{ id: string }>();
    if (!g) throw new ApiError(404, "not_found", `no game ${game} in this key's project`);
    return g.id;
  }
  const r = await env.DB.prepare("SELECT id FROM games WHERE project_id = ? LIMIT 2").bind(project).all<{ id: string }>();
  return r.results.length === 1 ? r.results[0].id : null;
}

/** The Steam id behind a ticket, checked with the game's key (or the platform's, if it has one). */
export async function steamTicketSubject(env: Env, project: string, body: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<string> {
  const ticket = String(body.ticket ?? "");
  const identity = body.identity === undefined ? undefined : String(body.identity);
  const appId = body.app_id === undefined ? undefined : String(body.app_id);
  const game = await loginGame(env, project, body.game);
  const key = game ? await gameSecret(env, game, "steam.web_api_key") : null;
  if (!key) {
    if (env.STEAM_WEBAPI_KEY) return verifySteamTicket(env, ticket, fetcher, identity, appId);
    throw new ApiError(409, "steam_not_set_up", game ? `Steam sign-in isn't set up for ${game}` : "Steam sign-in isn't set up (and the key's project has several games: pass game)", "sign in through Steam in the browser (POST /v1/players/steam/openid/start), or the developer stores steam.web_api_key and steam.app_ids with `partii secrets set`");
  }
  const apps = ((await gameSecret(env, game!, "steam.app_ids")) ?? "").split(",").filter(Boolean);
  if (!apps.length) throw new ApiError(409, "steam_not_set_up", `${game} has a Steam key but no steam.app_ids`, "the developer sets them with `partii secrets set <game> steam.app_ids --value <ids>`");
  if (appId && !apps.includes(appId)) throw bad(`app_id ${appId} is not one of ${game}'s Steam apps`, `one of ${apps.join(", ")}`);
  let last: unknown;
  for (const app of appId ? [appId] : apps.slice(0, MAX_APPS_TRIED)) {
    try {
      return await steamTicket(key, app, ticket, identity, fetcher);
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== "bad_ticket") throw e;
      last = e;
    }
  }
  throw last;
}

function page(title: string, text: string, status = 200) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:18px/1.5 system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}h1{font-size:24px}</style></head><body><main><h1>${esc(title)}</h1><p>${esc(text)}</p></main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** Ask Steam whether these OpenID response fields are genuine (check_authentication). */
export async function checkWithSteam(fields: Record<string, string>, fetcher: typeof fetch = fetch): Promise<boolean> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (k.startsWith("openid.")) form.set(k, v);
  form.set("openid.mode", "check_authentication");
  const res = await fetcher(OPENID, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const text = await res.text();
  return res.ok && /(^|\n)is_valid:true(\n|$)/.test(text);
}

const returnUrl = (origin: string, id: string) => `${origin}/v1/players/steam/openid/return?state=${id}`;

export const steamHandlers: Handlers = {
  async steamOpenidStart(ctx) {
    const { env, req, caller, body } = ctx;
    if (!(await allowed(env, "login", req.headers.get("cf-connecting-ip") ?? ""))) throw new ApiError(429, "rate_limited", "too many sign-ins from this network", "try again in a minute");
    const game = await loginGame(env, caller.project!, body.game);
    const guest = await currentPlayer(ctx);
    const id = randomSlug(20);
    const poll = `sp_${randomId(24)}`;
    const at = now();
    const origin = new URL(req.url).origin;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM steam_openid WHERE expires_at < ?").bind(at - 3600_000),
      env.DB.prepare("INSERT INTO steam_openid (id, poll_hash, project_id, game_id, guest_id, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)").bind(
        id,
        await sha256hex(poll),
        caller.project!,
        game,
        guest,
        at,
        at + OPENID_TTL,
      ),
    ]);
    const url = new URL(OPENID);
    url.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
    url.searchParams.set("openid.mode", "checkid_setup");
    url.searchParams.set("openid.return_to", returnUrl(origin, id));
    url.searchParams.set("openid.realm", origin);
    url.searchParams.set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select");
    url.searchParams.set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select");
    return { url: url.toString(), poll, expires_at: at + OPENID_TTL };
  },

  async steamOpenidReturn({ env, req, query }) {
    const id = String(query.state ?? "");
    const row = /^[a-z0-9]{20}$/.test(id) ? await env.DB.prepare("SELECT status, expires_at FROM steam_openid WHERE id = ?").bind(id).first<{ status: string; expires_at: number }>() : null;
    if (!row || row.expires_at < now()) return page("Sign-in expired", "This sign-in timed out. Go back to the game and press Sign in with Steam again.", 410);
    if (row.status !== "pending") return page("Already signed in", "You can close this tab and go back to the game.");
    if (query["openid.mode"] !== "id_res") return page("Sign-in cancelled", "Steam didn't sign you in. Start again from the game.", 400);
    const claimed = CLAIMED.exec(String(query["openid.claimed_id"] ?? ""));
    // The assertion must be for this login (return_to) and from Steam, and Steam must vouch for it.
    const expected = returnUrl(new URL(req.url).origin, id);
    if (!claimed || query["openid.op_endpoint"] !== OPENID || query["openid.return_to"] !== expected || !(await checkWithSteam(query))) {
      return page("Couldn't verify", "Steam's answer didn't check out. Start again from the game.", 400);
    }
    const r = await env.DB.prepare("UPDATE steam_openid SET status = 'done', steam_id = ? WHERE id = ? AND status = 'pending'").bind(claimed[1], id).run();
    if (!(r.meta.changes ?? 0)) return page("Already signed in", "You can close this tab and go back to the game.");
    return page("Signed in with Steam", "You can close this tab and go back to the game.");
  },

  async steamOpenidPoll({ env, caller, body }) {
    const poll = String(body.poll ?? "");
    if (!/^sp_[A-Za-z0-9_-]{20,64}$/.test(poll)) throw bad("poll is the value steamOpenidStart returned");
    const row = await env.DB.prepare("SELECT id, project_id, guest_id, steam_id, status, expires_at FROM steam_openid WHERE poll_hash = ?")
      .bind(await sha256hex(poll))
      .first<{ id: string; project_id: string; guest_id: string | null; steam_id: string | null; status: string; expires_at: number }>();
    if (!row || row.project_id !== caller.project) throw new ApiError(404, "not_found", "no such sign-in", "start one with steamOpenidStart");
    if (row.status === "used") return { status: "used" };
    if (row.status === "pending") return { status: row.expires_at < now() ? "expired" : "pending" };
    // Done: hand out the token exactly once.
    const claim = await env.DB.prepare("UPDATE steam_openid SET status = 'used' WHERE id = ? AND status = 'done'").bind(row.id).run();
    if (!(claim.meta.changes ?? 0)) return { status: "used" };
    const guest = row.guest_id ? await env.DB.prepare("SELECT id FROM players WHERE id = ? AND deleted_at IS NULL").bind(row.guest_id).first<{ id: string }>() : null;
    return { status: "done", ...(await signIn(env, "steam", row.steam_id!, guest?.id ?? null, "Player")) };
  },
};

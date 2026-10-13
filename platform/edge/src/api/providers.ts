// Sign-in providers. Each turns a proof into a stable subject id:
// email (a code we sent), apple / google (an ID token checked against the
// provider's published keys), discord (an OAuth code), steam (a session
// ticket checked with Valve), fake (dev and staging only).

import type { Env } from "../index";
import { ApiError, bad, b64url, fromB64url, now, sha256hex } from "./core";

const unconfigured = (p: string, what: string) =>
  new ApiError(400, "provider_not_configured", `${p} sign-in is not configured on this platform`, `set ${what} on the edge`);

export async function verifyProvider(env: Env, provider: string, body: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<string> {
  switch (provider) {
    case "email":
      return verifyEmail(env, body);
    case "fake":
      if (env.ALLOW_FAKE_LOGIN !== "1") throw bad("the fake provider only exists in dev and staging");
      if (typeof body.subject !== "string" || !body.subject) throw bad("fake login needs a subject");
      return body.subject;
    case "apple":
      if (!env.APPLE_CLIENT_IDS) throw unconfigured("Apple", "APPLE_CLIENT_IDS");
      return (await verifyIdToken(String(body.id_token ?? ""), "https://appleid.apple.com/auth/keys", ["https://appleid.apple.com"], env.APPLE_CLIENT_IDS.split(","), fetcher)).sub;
    case "google":
      if (!env.GOOGLE_CLIENT_IDS) throw unconfigured("Google", "GOOGLE_CLIENT_IDS");
      return (await verifyIdToken(String(body.id_token ?? ""), "https://www.googleapis.com/oauth2/v3/certs", ["accounts.google.com", "https://accounts.google.com"], env.GOOGLE_CLIENT_IDS.split(","), fetcher)).sub;
    case "discord":
      return verifyDiscord(env, body, fetcher);
    case "steam":
      // Games sign in with their own Steam key (steam.ts); this is the platform-wide fallback.
      return verifySteamTicket(env, String(body.ticket ?? ""), fetcher, body.identity === undefined ? undefined : String(body.identity), body.app_id === undefined ? undefined : String(body.app_id));
    default:
      throw bad(`unknown provider ${provider}`, "one of email, apple, google, discord, steam");
  }
}

async function verifyEmail(env: Env, body: Record<string, unknown>): Promise<string> {
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();
  const row = await env.DB.prepare("SELECT code_hash, expires_at, tries FROM email_codes WHERE email = ?").bind(email).first<{ code_hash: string; expires_at: number; tries: number }>();
  if (!row || row.expires_at < now()) throw new ApiError(401, "code_expired", "no current code for this email", "ask for a new one with POST /v1/players/email/start");
  if (row.tries >= 5) throw new ApiError(429, "rate_limited", "too many wrong codes", "ask for a new code");
  if ((await sha256hex(`${email}:${code}`)) !== row.code_hash) {
    await env.DB.prepare("UPDATE email_codes SET tries = tries + 1 WHERE email = ?").bind(email).run();
    throw new ApiError(401, "bad_code", "that code is not right", "check the latest email");
  }
  await env.DB.prepare("DELETE FROM email_codes WHERE email = ?").bind(email).run();
  return email;
}

const jwksCache = new Map<string, { at: number; keys: JsonWebKey[] }>();

async function jwks(url: string, fetcher: typeof fetch): Promise<(JsonWebKey & { kid?: string })[]> {
  const hit = jwksCache.get(url);
  if (hit && now() - hit.at < 3600_000) return hit.keys;
  const res = await fetcher(url);
  if (!res.ok) throw new ApiError(502, "provider_down", `could not fetch ${url}`, "try again shortly");
  const keys = ((await res.json()) as { keys: JsonWebKey[] }).keys;
  jwksCache.set(url, { at: now(), keys });
  return keys;
}

/** Check an RS256 ID token's signature, issuer, audience and expiry. */
export async function verifyIdToken(token: string, jwksUrl: string, issuers: string[], audiences: string[], fetcher: typeof fetch = fetch): Promise<{ sub: string; email?: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) throw bad("id_token is not a JWT");
  const header = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
  if (header.alg !== "RS256") throw bad("id_token must be RS256");
  const jwk = (await jwks(jwksUrl, fetcher)).find((k) => k.kid === header.kid);
  if (!jwk) throw new ApiError(401, "bad_token", "id_token signed by an unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new ApiError(401, "bad_token", "id_token signature does not verify");
  if (!issuers.includes(claims.iss)) throw new ApiError(401, "bad_token", `id_token issuer ${claims.iss} is not accepted`);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.some((a: string) => audiences.includes(a))) throw new ApiError(401, "bad_token", "id_token is for another app");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now()) throw new ApiError(401, "bad_token", "id_token expired");
  return { sub: String(claims.sub), email: claims.email };
}

async function verifyDiscord(env: Env, body: Record<string, unknown>, fetcher: typeof fetch): Promise<string> {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) throw unconfigured("Discord", "DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET");
  const res = await fetcher("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: String(body.code ?? ""),
      redirect_uri: String(body.redirect_uri ?? ""),
    }),
  });
  if (!res.ok) throw new ApiError(401, "bad_code", "Discord did not accept the code");
  const { access_token } = (await res.json()) as { access_token: string };
  const me = await fetcher("https://discord.com/api/users/@me", { headers: { authorization: `Bearer ${access_token}` } });
  if (!me.ok) throw new ApiError(502, "provider_down", "Discord user lookup failed");
  return String(((await me.json()) as { id: string }).id);
}

/** The Steam app ids tickets are accepted for (STEAM_APP_ID: one id, or several comma-separated: full game, demo). */
export function steamAppIds(env: Env): string[] {
  return (env.STEAM_APP_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Check a Steam ticket with the platform's own key (STEAM_WEBAPI_KEY); the
 * Steam id. Games normally use their own key instead (steam.ts).
 */
export async function verifySteamTicket(env: Env, ticket: string, fetcher: typeof fetch = fetch, identity?: string, appId?: string): Promise<string> {
  const apps = steamAppIds(env);
  if (!env.STEAM_WEBAPI_KEY || !apps.length) throw unconfigured("Steam", "STEAM_WEBAPI_KEY and STEAM_APP_ID");
  const app = appId ?? apps[0];
  if (!apps.includes(app)) throw bad(`app_id ${app} is not a Steam app this platform accepts`, `one of ${apps.join(", ")}`);
  return steamTicket(env.STEAM_WEBAPI_KEY, app, ticket, identity, fetcher);
}

/**
 * Ask Valve whether `ticket` was issued for `app`; the Steam id. `identity`:
 * the string a GetAuthTicketForWebApi ticket was made for (none for
 * GetAuthSessionTicket).
 */
export async function steamTicket(key: string, app: string, ticket: string, identity: string | undefined, fetcher: typeof fetch = fetch): Promise<string> {
  if (!/^[0-9a-fA-F]{16,}$/.test(ticket)) throw bad("ticket must be the hex auth session ticket");
  const url = `https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/?key=${encodeURIComponent(key)}&appid=${encodeURIComponent(app)}&ticket=${ticket}${identity ? `&identity=${encodeURIComponent(identity)}` : ""}`;
  const res = await fetcher(url);
  const j = (await res.json().catch(() => ({}))) as { response?: { params?: { result: string; steamid: string }; error?: { errordesc?: string } } };
  const p = j.response?.params;
  if (!res.ok || p?.result !== "OK") throw new ApiError(401, "bad_ticket", `Steam did not accept the ticket${j.response?.error?.errordesc ? `: ${j.response.error.errordesc}` : ""}`, "make a fresh ticket; for GetAuthTicketForWebApi pass the same identity");
  return p.steamid;
}

export { b64url };

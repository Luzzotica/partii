// Purchases made in platform stores, verified server-to-server before they
// become entitlements: App Store (App Store Server API), Google Play (Play
// Developer API), Steam (app ownership), and a fake store for dev/staging.
// Credentials come from the edge's secrets; a store without them answers
// `store_not_configured`.

import type { Env } from "../index";
import { ApiError, bad, b64url, fromB64url, randomSlug } from "./core";
import { steamAppIds, steamTicket } from "./providers";
import { gameSecret } from "./secrets";

export interface Verified {
  store: string;
  ref: string;
  amount_cents?: number;
  currency?: string;
  test: boolean;
}

const unconfigured = (store: string, what: string) =>
  new ApiError(400, "store_not_configured", `${store} purchases are not configured on this platform`, `set ${what} on the edge`);

export async function verifyReceipt(env: Env, store: string, game: string, body: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<Verified> {
  const g = await env.DB.prepare("SELECT store FROM games WHERE id = ?").bind(game).first<{ store: string }>();
  const page = JSON.parse(g?.store ?? "{}") as { appstore_product_id?: string; play_product_id?: string; steam_app_id?: string };
  switch (store) {
    case "fake":
      if (env.ALLOW_FAKE_STORE !== "1") throw bad("the fake store only exists in dev and staging");
      // A given transaction id is the same purchase each time (to test restores).
      return { store: "fake", ref: `fake:${/^[A-Za-z0-9_-]{1,40}$/.test(String(body.transaction ?? "")) ? body.transaction : randomSlug(12)}`, test: true };
    case "appstore":
      return appStore(env, String(body.transaction ?? ""), page.appstore_product_id, fetcher);
    case "play":
      return play(env, String(body.purchase_token ?? ""), String(body.product_id ?? page.play_product_id ?? ""), fetcher);
    case "steam": {
      // The game's own Steam key and apps when it has them, else the platform's.
      const key = (await gameSecret(env, game, "steam.web_api_key")) ?? env.STEAM_WEBAPI_KEY;
      const apps = ((await gameSecret(env, game, "steam.app_ids")) ?? "").split(",").filter(Boolean);
      const appId = page.steam_app_id ?? apps[0] ?? steamAppIds(env)[0];
      if (!key || !appId) throw new ApiError(409, "steam_not_set_up", `Steam purchases aren't set up for ${game}`, "the developer stores steam.web_api_key and steam.app_ids with `partii secrets set`");
      const steamId = await steamTicket(key, appId, String(body.ticket ?? ""), body.identity === undefined ? undefined : String(body.identity), fetcher);
      const res = await fetcher(`https://partner.steam-api.com/ISteamUser/CheckAppOwnership/v2/?key=${encodeURIComponent(key)}&steamid=${steamId}&appid=${appId}`);
      const j = (await res.json().catch(() => ({}))) as { appownership?: { ownsapp: boolean } };
      if (!j.appownership?.ownsapp) throw new ApiError(402, "not_owned", "this Steam account does not own the game");
      return { store: "steam", ref: `steam:${steamId}:${appId}`, test: false };
    }
    default:
      throw bad(`unknown store ${store}`, "one of appstore, play, steam");
  }
}

// ── App Store: look the transaction up with the App Store Server API ──

async function es256Jwt(keyPem: string, header: Record<string, unknown>, claims: Record<string, unknown>): Promise<string> {
  const der = fromB64url(keyPem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc(header)}.${enc(claims)}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

async function appStore(env: Env, transactionId: string, productId: string | undefined, fetcher: typeof fetch): Promise<Verified> {
  if (!env.APPSTORE_ISSUER_ID || !env.APPSTORE_KEY_ID || !env.APPSTORE_PRIVATE_KEY || !env.APPSTORE_BUNDLE_ID) throw unconfigured("App Store", "APPSTORE_ISSUER_ID, APPSTORE_KEY_ID, APPSTORE_PRIVATE_KEY, APPSTORE_BUNDLE_ID");
  if (!/^\d+$/.test(transactionId)) throw bad("transaction must be the App Store transaction id");
  const iat = Math.floor(Date.now() / 1000);
  const jwt = await es256Jwt(env.APPSTORE_PRIVATE_KEY, { alg: "ES256", kid: env.APPSTORE_KEY_ID, typ: "JWT" }, { iss: env.APPSTORE_ISSUER_ID, iat, exp: iat + 600, aud: "appstoreconnect-v1", bid: env.APPSTORE_BUNDLE_ID });
  for (const [host, test] of [["api.storekit.itunes.apple.com", false], ["api.storekit-sandbox.itunes.apple.com", true]] as const) {
    const res = await fetcher(`https://${host}/inApps/v1/transactions/${transactionId}`, { headers: { authorization: `Bearer ${jwt}` } });
    if (res.status === 404) continue;
    if (!res.ok) throw new ApiError(502, "store_down", `App Store answered ${res.status}`);
    const { signedTransactionInfo } = (await res.json()) as { signedTransactionInfo: string };
    // Apple's own API over TLS: the payload is trustworthy as delivered.
    const t = JSON.parse(new TextDecoder().decode(fromB64url(signedTransactionInfo.split(".")[1]))) as { bundleId: string; productId: string; revocationDate?: number; price?: number; currency?: string };
    if (t.bundleId !== env.APPSTORE_BUNDLE_ID) throw new ApiError(402, "wrong_app", "the transaction is for another app");
    if (productId && t.productId !== productId) throw new ApiError(402, "wrong_product", "the transaction is for another product");
    if (t.revocationDate) throw new ApiError(402, "refunded", "the transaction was refunded");
    return { store: "appstore", ref: `appstore:${transactionId}`, amount_cents: t.price ? Math.round(t.price / 10) : undefined, currency: t.currency?.toLowerCase(), test };
  }
  throw new ApiError(404, "not_found", "the App Store has no such transaction");
}

// ── Google Play: purchases.products.get with a service account ──

async function googleAccessToken(env: Env, fetcher: typeof fetch): Promise<string> {
  const sa = JSON.parse(env.PLAY_SERVICE_ACCOUNT!) as { client_email: string; private_key: string };
  const der = fromB64url(sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 600 })}`;
  const sig = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)));
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${sig}` }),
  });
  if (!res.ok) throw new ApiError(502, "store_down", "Google token exchange failed");
  return ((await res.json()) as { access_token: string }).access_token;
}

async function play(env: Env, token: string, productId: string, fetcher: typeof fetch): Promise<Verified> {
  if (!env.PLAY_SERVICE_ACCOUNT || !env.PLAY_PACKAGE_NAME) throw unconfigured("Google Play", "PLAY_SERVICE_ACCOUNT and PLAY_PACKAGE_NAME");
  if (!token || !productId) throw bad("purchase_token and product_id are required");
  const at = await googleAccessToken(env, fetcher);
  const res = await fetcher(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${env.PLAY_PACKAGE_NAME}/purchases/products/${productId}/tokens/${token}`, {
    headers: { authorization: `Bearer ${at}` },
  });
  if (!res.ok) throw new ApiError(402, "not_purchased", "Google Play does not know this purchase");
  const p = (await res.json()) as { purchaseState: number; orderId: string; purchaseType?: number };
  if (p.purchaseState !== 0) throw new ApiError(402, "not_purchased", "the purchase is not complete");
  return { store: "play", ref: `play:${p.orderId}`, test: p.purchaseType === 0 };
}

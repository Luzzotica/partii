import type { AttestResult } from "./index";

// Steam auth-session-ticket verification.
//
// The desktop/Steam build (bouncy-blobs, App ID 4485010) calls
// GetAuthSessionTicket via the steamworks Rust crate in src-tauri, hands the
// hex-encoded ticket to the client, which sends it here. We validate it with
// the Steam Web API using a *publisher* Web API key, which proves the user
// genuinely owns and is running the game on Steam.
//
// Docs: https://partner.steamgames.com/doc/webapi/ISteamUserAuth#AuthenticateUserTicket

const AUTH_URL = "https://api.steampowered.com/ISteamUserAuth/AuthenticateUserTicket/v1/";

export async function verifySteamTicket(
  ticket: string | undefined,
  claimedSteamId: string | undefined,
): Promise<AttestResult> {
  const key = process.env.STEAM_WEBAPI_PUBLISHER_KEY;
  const appId = process.env.STEAM_APP_ID;

  if (!key || !appId) {
    if (process.env.NODE_ENV !== "production") return { ok: true };
    return { ok: false, reason: "STEAM_WEBAPI_PUBLISHER_KEY / STEAM_APP_ID not configured" };
  }
  if (!ticket) return { ok: false, reason: "missing Steam ticket" };

  const url = `${AUTH_URL}?key=${encodeURIComponent(key)}&appid=${encodeURIComponent(
    appId,
  )}&ticket=${encodeURIComponent(ticket)}`;

  let data: {
    response?: {
      params?: { result?: string; steamid?: string; ownersteamid?: string; vacbanned?: boolean };
      error?: { errorcode?: number; errordesc?: string };
    };
  };
  try {
    const res = await fetch(url);
    data = await res.json();
  } catch (e) {
    return { ok: false, reason: `Steam verify failed: ${(e as Error).message}` };
  }

  const params = data.response?.params;
  if (!params || params.result !== "OK" || !params.steamid) {
    const err = data.response?.error?.errordesc ?? "ticket not OK";
    return { ok: false, reason: `Steam rejected: ${err}` };
  }
  // Optional binding: if the client also told us which steamid it expects, make
  // sure the ticket actually belongs to that account.
  if (claimedSteamId && claimedSteamId !== params.steamid) {
    return { ok: false, reason: "Steam ticket steamid mismatch" };
  }
  // The ticket proves BOTH genuineness and identity — surface the SteamID so
  // the token mint can bind this session to a stable player identity.
  return { ok: true, playerId: `steam:${params.steamid}` };
}

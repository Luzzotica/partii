import { verifySteamTicket } from "@/lib/api/attest/steam";
import { verifyGameCenter } from "./gamecenter";
import { verifySiwa } from "./siwa";
import { verifyGoogle } from "./google";
import { verifyDiscord } from "./discord";

// ─────────────────────────────────────────────────────────────────────────────
// Player identity providers.
//
// Distinct from lib/api/attest (which answers "is this a genuine build of the
// game?"): identity answers "WHO is this person?" and returns a
// provider-stable subject that keys player_identities. Every provider's
// credentials are BYO per project (the platform env values only serve
// first-party games, same as attestation).
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderId = "anon" | "steam" | "gamecenter" | "apple" | "google" | "discord" | "dev";

export type ProviderResult =
  | { ok: true; subject: string; displayName?: string }
  | { ok: false; reason: string };

/** Per-project provider credentials (decrypted where applicable). */
export type ProjectProviderCreds = {
  steamPublisherKey?: string | null;
  steamAppId?: string | null;
  appleBundleId?: string | null;
  googleWebClientId?: string | null;
  discordClientId?: string | null;
  discordClientSecret?: string | null;
};

export type ProviderProof = {
  /** anon */
  device_id?: string;
  /** steam */
  ticket?: string;
  steam_id?: string;
  /** gamecenter */
  public_key_url?: string;
  signature?: string; // base64
  salt?: string; // base64
  timestamp?: number;
  player_id?: string; // teamPlayerID
  /** apple (SIWA) / google — the identity token JWT */
  id_token?: string;
  /** discord */
  code?: string;
  redirect_uri?: string;
  /** dev */
  subject?: string;
};

const isProd = () => process.env.NODE_ENV === "production";

export async function verifyProviderProof(
  provider: string,
  proof: ProviderProof,
  creds: ProjectProviderCreds,
): Promise<ProviderResult> {
  switch (provider as ProviderId) {
    case "anon": {
      const device = (proof.device_id ?? "").slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, "");
      if (!device) return { ok: false, reason: "device_id required" };
      return { ok: true, subject: device };
    }

    case "steam": {
      const res = await verifySteamTicket(
        proof.ticket,
        proof.steam_id,
        creds.steamPublisherKey,
        creds.steamAppId,
      );
      if (!res.ok) return { ok: false, reason: res.reason };
      // attest returns 'steam:<id64>' — the identity subject is the bare id64.
      const subject = (res.playerId ?? "").replace(/^steam:/, "");
      if (!subject) return { ok: false, reason: "Steam did not return a steamid" };
      return { ok: true, subject };
    }

    case "gamecenter":
      return verifyGameCenter(proof, creds.appleBundleId);

    case "apple":
      return verifySiwa(proof.id_token, creds.appleBundleId);

    case "google":
      return verifyGoogle(proof.id_token, creds.googleWebClientId);

    case "discord":
      return verifyDiscord(proof.code, proof.redirect_uri, creds.discordClientId, creds.discordClientSecret);

    case "dev": {
      // Local development convenience only — never a real identity in prod.
      if (isProd()) return { ok: false, reason: "dev provider not allowed in production" };
      const subject = (proof.subject ?? proof.device_id ?? "dev").slice(0, 64);
      return { ok: true, subject };
    }

    default:
      return { ok: false, reason: `Unknown provider: ${provider}` };
  }
}

import { isLocalOrigin } from "../origin";
import { verifyTurnstile } from "./turnstile";
import { verifySteamTicket } from "./steam";

// ─────────────────────────────────────────────────────────────────────────────
// Attestation
//
// Origin alone can't be trusted from native clients (Steam/Tauri, mobile can
// forge any Origin with a raw HTTP call), so each platform proves it's a genuine
// instance of one of our games before we mint a session token:
//
//   web    → Cloudflare Turnstile token   (verified via siteverify)
//   steam  → Steam auth session ticket     (verified via Steam Web API)
//   mobile → Play Integrity / App Attest   (stub — implement when a build ships)
//   dev    → allowed only for local dev / non-production
//
// Pluggable: add a provider file and a case here. Fails CLOSED in production —
// an unknown or unconfigured provider is rejected rather than waved through.
// ─────────────────────────────────────────────────────────────────────────────

export type AttestResult =
  | {
      ok: true;
      /** Verified platform identity ('steam:<id64>') when the provider proves
       *  one. Web/dev attestations prove genuineness, not identity — the caller
       *  derives an anonymous device identity instead. */
      playerId?: string;
    }
  | { ok: false; reason: string };

export type AttestInput = {
  platform: string;
  /** Provider-specific proof: Turnstile token, base64 Steam ticket, etc. */
  proof?: string;
  origin: string | null;
  /** Caller IP, when available, for providers that bind to it (Turnstile). */
  ip?: string | null;
  /** Steam ticket auth needs the steamid the client claims. */
  steamId?: string;
  /** BYO attestation credentials from the caller's project row (decrypted).
   *  Our Turnstile widget / Steam publisher key are scoped to OUR domains and
   *  apps, so customer projects supply their own; null/absent falls back to
   *  the platform env credentials (first-party games). */
  projectCreds?: {
    turnstileSecret?: string | null;
    steamPublisherKey?: string | null;
    steamAppId?: string | null;
  };
};

const isProd = () => process.env.NODE_ENV === "production";

export async function verifyAttestation(input: AttestInput): Promise<AttestResult> {
  const platform = (input.platform || "").toLowerCase();

  switch (platform) {
    case "web":
      return verifyTurnstile(input.proof, input.ip ?? null, input.projectCreds?.turnstileSecret);

    case "steam":
      return verifySteamTicket(
        input.proof,
        input.steamId,
        input.projectCreds?.steamPublisherKey,
        input.projectCreds?.steamAppId,
      );

    case "dev":
      // Local dev convenience only. Never trust 'dev' from a real origin in prod.
      if (!isProd() || isLocalOrigin(input.origin)) return { ok: true };
      return { ok: false, reason: "dev attestation not allowed in production" };

    case "mobile":
      // TODO: Play Integrity (Android) / App Attest (iOS). Until implemented,
      // fail closed in prod, allow locally.
      if (!isProd()) return { ok: true };
      return { ok: false, reason: "mobile attestation not yet implemented" };

    default:
      // Unknown platform: allow locally to avoid blocking dev, reject in prod.
      if (!isProd()) return { ok: true };
      return { ok: false, reason: `unknown platform '${platform}'` };
  }
}

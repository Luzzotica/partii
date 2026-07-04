import { createRemoteJWKSet, jwtVerify } from "jose";
import type { ProviderResult } from "./index";

// ─────────────────────────────────────────────────────────────────────────────
// Google — Sign in with Google ID-token verification.
//
// Android (Credential Manager) and web clients obtain an ID-token JWT with
// the developer's WEB OAuth client id as audience; we verify against Google's
// JWKS. `sub` is the stable Google-account id. BYO config: the web client id
// only (no secret needed for pure JWT verification).
//
// (Google Play Games Services v2 server_auth_code exchange — which yields a
// per-game PGS playerId — can be added later; it additionally needs the
// client secret.)
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function googleJwks() {
  jwks ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  return jwks;
}

/** Test hook: reset the cached JWKS (so fetch mocks apply). */
export function __resetGoogleJwks(): void {
  jwks = null;
}

export async function verifyGoogle(
  idToken: string | undefined,
  webClientId: string | null | undefined,
): Promise<ProviderResult> {
  if (!webClientId) {
    return { ok: false, reason: "Google sign-in not configured for this project (google_web_client_id)" };
  }
  if (!idToken) return { ok: false, reason: "id_token required" };
  try {
    const { payload } = await jwtVerify(idToken, googleJwks(), {
      issuer: GOOGLE_ISSUERS,
      audience: webClientId,
      algorithms: ["RS256"],
    });
    if (!payload.sub) return { ok: false, reason: "Google token missing sub" };
    return {
      ok: true,
      subject: String(payload.sub),
      displayName: typeof payload.name === "string" ? payload.name : undefined,
    };
  } catch (err) {
    return { ok: false, reason: `Google token rejected: ${(err as Error).message}` };
  }
}

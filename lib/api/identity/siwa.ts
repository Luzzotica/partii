import { createRemoteJWKSet, jwtVerify } from "jose";
import type { ProviderResult } from "./index";

// ─────────────────────────────────────────────────────────────────────────────
// Sign in with Apple — identity-token verification.
//
// The iOS/web client gets an ASAuthorizationAppleIDCredential and sends its
// identityToken (RS256 JWT). We verify it against Apple's JWKS with the
// project's bundle id as audience. `sub` is the stable, team-scoped user id.
// BYO config: apple_bundle_id (no keys needed for pure verification).
// Fails closed when unconfigured — there is no first-party fallback.
// ─────────────────────────────────────────────────────────────────────────────

const APPLE_ISSUER = "https://appleid.apple.com";

// Module-level: jose caches keys + handles rotation; survives warm invocations.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function appleJwks() {
  jwks ??= createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
  return jwks;
}

/** Test hook: reset the cached JWKS (so fetch mocks apply). */
export function __resetAppleJwks(): void {
  jwks = null;
}

export async function verifySiwa(
  idToken: string | undefined,
  bundleId: string | null | undefined,
): Promise<ProviderResult> {
  if (!bundleId) {
    return { ok: false, reason: "Sign in with Apple not configured for this project (apple_bundle_id)" };
  }
  if (!idToken) return { ok: false, reason: "id_token required" };
  try {
    const { payload } = await jwtVerify(idToken, appleJwks(), {
      issuer: APPLE_ISSUER,
      audience: bundleId,
      algorithms: ["RS256"],
    });
    if (!payload.sub) return { ok: false, reason: "Apple token missing sub" };
    return { ok: true, subject: String(payload.sub) };
  } catch (err) {
    return { ok: false, reason: `Apple token rejected: ${(err as Error).message}` };
  }
}

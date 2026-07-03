import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256Hex } from "./crypto";
import { verifySessionToken } from "./token";

export type ApiKeyContext = {
  apiKeyId: string;
  projectId: string;
  /** Platform that attested for this caller, when authed via session token. */
  platform?: string;
  /** Player identity ('steam:<id64>' | 'anon:<uuid>') from the session token. */
  playerId?: string;
};

/**
 * When true, signalling endpoints REQUIRE a short-lived session token (minted
 * at /api/auth/token after origin + attestation checks) and reject a raw API
 * key. Default false during the client rollout so games keep working until each
 * has been updated to do the token exchange. Flip to "true" once every game
 * ships the new RoomService.
 */
export function enforceSessionTokens(): boolean {
  const v = process.env.ENFORCE_SESSION_TOKENS;
  return v === "true" || v === "1";
}

const admin = createAdminClient();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
};

export const corsHeaders = CORS_HEADERS;

export function corsPreflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Resolve the caller's API key from the X-API-Key header (or Authorization: Bearer).
 * Returns NextResponse on failure (401), or { apiKeyId, projectId } on success.
 */
export async function requireApiKey(
  request: Request,
): Promise<{ ok: true; ctx: ApiKeyContext } | { ok: false; response: NextResponse }> {
  let secret = request.headers.get("x-api-key") ?? "";
  if (!secret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth.toLowerCase().startsWith("bearer ")) secret = auth.slice(7);
  }

  if (!secret) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing X-API-Key header" },
        { status: 401, headers: CORS_HEADERS },
      ),
    };
  }

  const hash = sha256Hex(secret);
  const { data, error } = await admin
    .from("api_keys")
    .select("id, project_id, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();

  if (error || !data || data.revoked_at) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or revoked API key" },
        { status: 401, headers: CORS_HEADERS },
      ),
    };
  }

  // Fire-and-forget last_used_at update.
  void admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return { ok: true, ctx: { apiKeyId: data.id, projectId: data.project_id } };
}

/**
 * Auth gate for signalling endpoints. Prefers a session token (Bearer JWT,
 * verified locally — no DB round-trip), and during the migration window falls
 * back to a raw API key. Once `enforceSessionTokens()` is on, a raw key is
 * rejected here (it's still accepted at /api/auth/token, the only place it's
 * meant to be used).
 *
 * Session-token revocation lag: a token stays valid until its short TTL
 * expires even if its API key is revoked mid-flight — the same model the TURN
 * credentials already use. Acceptable given the ~10 min TTL.
 */
export async function requireAuth(
  request: Request,
): Promise<{ ok: true; ctx: ApiKeyContext } | { ok: false; response: NextResponse }> {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  // A Bearer value that isn't a raw API key and looks like a JWT → session token.
  if (bearer && !bearer.startsWith("mpk_") && bearer.split(".").length === 3) {
    const claims = verifySessionToken(bearer);
    if (claims) {
      return {
        ok: true,
        ctx: {
          apiKeyId: claims.kid,
          projectId: claims.pid,
          platform: claims.plat,
          playerId: claims.sub,
        },
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or expired session token" },
        { status: 401, headers: CORS_HEADERS },
      ),
    };
  }

  // No session token present.
  if (enforceSessionTokens()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Session token required — exchange your API key at /api/auth/token" },
        { status: 401, headers: CORS_HEADERS },
      ),
    };
  }

  // Migration window: accept the raw API key directly — unless THIS project
  // opted into enforcement (per-project flag; the global env flag can't flip
  // until every customer has, which is never guaranteed).
  const viaKey = await requireApiKey(request);
  if (!viaKey.ok) return viaKey;
  const { data: proj } = await admin
    .from("projects")
    .select("require_session_tokens")
    .eq("id", viaKey.ctx.projectId)
    .maybeSingle();
  if (proj?.require_session_tokens) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Session token required — exchange your API key at /api/auth/token" },
        { status: 401, headers: CORS_HEADERS },
      ),
    };
  }
  return viaKey;
}

export function recordUsage(
  apiKeyId: string,
  eventType: string,
  refs: { roomId?: string } = {},
) {
  void admin
    .from("usage_events")
    .insert({
      api_key_id: apiKeyId,
      event_type: eventType,
      room_id: refs.roomId ?? null,
    });
}

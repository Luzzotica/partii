import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256Hex } from "./crypto";

export type ApiKeyContext = {
  apiKeyId: string;
  developerId: string;
};

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
 * Returns NextResponse on failure (401), or { apiKeyId, developerId } on success.
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
    .select("id, developer_id, revoked_at")
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

  return { ok: true, ctx: { apiKeyId: data.id, developerId: data.developer_id } };
}

export function recordUsage(
  apiKeyId: string,
  eventType: string,
  refs: { sessionId?: string; lobbyId?: string } = {},
) {
  void admin
    .from("usage_events")
    .insert({
      api_key_id: apiKeyId,
      event_type: eventType,
      session_id: refs.sessionId ?? null,
      lobby_id: refs.lobbyId ?? null,
    });
}

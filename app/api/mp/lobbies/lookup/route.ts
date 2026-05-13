import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiKey, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// GET /api/mp/lobbies/lookup?code=ABC123
export async function GET(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const code = (url.searchParams.get("code") ?? "").toUpperCase().trim();
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400, headers: CORS });
  }

  const { data: lobby, error } = await admin
    .from("mp_lobbies")
    .select("id, join_code, game_id, display_name, status, max_screens, is_password_protected, visibility, metadata, created_at, expires_at")
    .eq("join_code", code)
    .eq("api_key_id", auth.ctx.apiKeyId)
    .neq("status", "ended")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  if (!lobby) return NextResponse.json({ error: "Lobby not found" }, { status: 404, headers: CORS });

  const { data: screens } = await admin
    .from("mp_lobby_screens")
    .select("id")
    .eq("lobby_id", lobby.id)
    .in("status", ["joined", "connected"]);

  return NextResponse.json(
    {
      lobby_id: lobby.id,
      join_code: lobby.join_code,
      game_id: lobby.game_id,
      display_name: lobby.display_name,
      status: lobby.status,
      max_screens: lobby.max_screens,
      screen_count: screens?.length ?? 0,
      is_password_protected: lobby.is_password_protected,
      visibility: lobby.visibility,
      metadata: lobby.metadata,
      created_at: lobby.created_at,
      expires_at: lobby.expires_at,
    },
    { headers: CORS },
  );
}

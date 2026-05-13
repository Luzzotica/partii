import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiKey, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const code = (url.searchParams.get("code") ?? "").toUpperCase().trim();

  if (!code) {
    return NextResponse.json(
      { error: "code query parameter is required" },
      { status: 400, headers: CORS },
    );
  }

  const { data: session, error } = await admin
    .from("party_sessions")
    .select("id, join_code, game_id, status, max_players, metadata, created_at, expires_at, api_key_id")
    .eq("join_code", code)
    .eq("api_key_id", auth.ctx.apiKeyId)
    .neq("status", "ended")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: CORS },
    );
  }

  if (!session) {
    return NextResponse.json(
      { error: "No active session found with that code" },
      { status: 404, headers: CORS },
    );
  }

  const { data: players } = await admin
    .from("party_players")
    .select("id, display_name, slot, status, joined_at")
    .eq("session_id", session.id)
    .order("slot");

  return NextResponse.json(
    {
      session_id: session.id,
      join_code: session.join_code,
      game_id: session.game_id,
      status: session.status,
      max_players: session.max_players,
      player_count: players?.length ?? 0,
      metadata: session.metadata,
      created_at: session.created_at,
      expires_at: session.expires_at,
    },
    { headers: CORS },
  );
}

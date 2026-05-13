import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiKey, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ lobbyId: string }> },
) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;
  const { lobbyId } = await params;

  const { data: lobby, error } = await admin
    .from("mp_lobbies")
    .select("id, join_code, game_id, display_name, status, max_screens, is_password_protected, visibility, metadata, created_at, expires_at, host_screen_session_id")
    .eq("id", lobbyId)
    .eq("api_key_id", auth.ctx.apiKeyId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  if (!lobby) return NextResponse.json({ error: "Lobby not found" }, { status: 404, headers: CORS });

  const { data: screens } = await admin
    .from("mp_lobby_screens")
    .select("id, display_name, slot, status, is_host, joined_at")
    .eq("lobby_id", lobbyId)
    .order("slot");

  return NextResponse.json(
    {
      lobby_id: lobby.id,
      join_code: lobby.join_code,
      game_id: lobby.game_id,
      display_name: lobby.display_name,
      status: lobby.status,
      max_screens: lobby.max_screens,
      is_password_protected: lobby.is_password_protected,
      visibility: lobby.visibility,
      metadata: lobby.metadata,
      created_at: lobby.created_at,
      expires_at: lobby.expires_at,
      host_screen_session_id: lobby.host_screen_session_id,
      screens: (screens ?? []).map((s) => ({
        screen_id: s.id,
        display_name: s.display_name,
        slot: s.slot,
        status: s.status,
        is_host: s.is_host,
        joined_at: s.joined_at,
      })),
    },
    { headers: CORS },
  );
}

// PATCH — host_secret required. Allows ending the lobby or updating metadata.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ lobbyId: string }> },
) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;
  const { lobbyId } = await params;

  let body: {
    host_secret?: string;
    status?: string;
    visibility?: "public" | "private";
    metadata?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }
  if (!body.host_secret) {
    return NextResponse.json({ error: "host_secret is required" }, { status: 400, headers: CORS });
  }

  const { data: lobby } = await admin
    .from("mp_lobbies")
    .select("id, host_secret, api_key_id")
    .eq("id", lobbyId)
    .maybeSingle();
  if (!lobby || lobby.api_key_id !== auth.ctx.apiKeyId) {
    return NextResponse.json({ error: "Lobby not found" }, { status: 404, headers: CORS });
  }
  if (lobby.host_secret !== body.host_secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
  }

  const updates: Record<string, unknown> = {};
  if (body.status === "active" || body.status === "ended") {
    updates.status = body.status;
    if (body.status === "ended") updates.ended_at = new Date().toISOString();
  }
  if (body.visibility === "public" || body.visibility === "private") {
    updates.visibility = body.visibility;
  }
  if (body.metadata && typeof body.metadata === "object") {
    updates.metadata = body.metadata;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true }, { headers: CORS });
  }

  const { error: updErr } = await admin.from("mp_lobbies").update(updates).eq("id", lobbyId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500, headers: CORS });

  return NextResponse.json({ ok: true }, { headers: CORS });
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiKey, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// GET /api/rooms/lookup?code=ABC123
// Resolve a join code to a room summary. Used by both phone-pairing
// (controller scanned a QR code) and laptop-join-by-code flows.
export async function GET(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const code = (url.searchParams.get("code") ?? "").toUpperCase().trim();
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400, headers: CORS });
  }

  const { data: room, error } = await admin
    .from("rooms")
    .select(
      "id, join_code, game_id, display_name, status, max_peers, is_password_protected, visibility, joinable, metadata, created_at, expires_at",
    )
    .eq("join_code", code)
    .eq("api_key_id", auth.ctx.apiKeyId)
    .neq("status", "ended")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404, headers: CORS });

  const { data: peers } = await admin
    .from("room_peers")
    .select("id")
    .eq("room_id", room.id)
    .in("status", ["joined", "connected"]);

  return NextResponse.json(
    {
      room_id: room.id,
      join_code: room.join_code,
      game_id: room.game_id,
      display_name: room.display_name,
      status: room.status,
      max_peers: room.max_peers,
      peer_count: peers?.length ?? 0,
      is_password_protected: room.is_password_protected,
      visibility: room.visibility,
      joinable: room.joinable,
      metadata: room.metadata,
      created_at: room.created_at,
      expires_at: room.expires_at,
    },
    { headers: CORS },
  );
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const admin = createAdminClient();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; playerId: string }> },
) {
  const { sessionId, playerId } = await params;

  let body: { player_secret?: string; status?: string; metadata?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  if (!body.player_secret) {
    return NextResponse.json({ error: "player_secret is required" }, { status: 400, headers: CORS });
  }

  const { data: player, error: fetchError } = await admin
    .from("party_players")
    .select("id, player_secret, session_id")
    .eq("id", playerId)
    .eq("session_id", sessionId)
    .single();

  if (fetchError || !player) {
    return NextResponse.json({ error: "Player not found" }, { status: 404, headers: CORS });
  }

  if (player.player_secret !== body.player_secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
  }

  const updates: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
  if (body.status === "connected" || body.status === "disconnected") {
    updates.status = body.status;
  }
  if (body.metadata && typeof body.metadata === "object") {
    updates.metadata = body.metadata;
  }

  const { error: updateError } = await admin
    .from("party_players")
    .update(updates)
    .eq("id", playerId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500, headers: CORS });
  }

  return NextResponse.json({ ok: true }, { headers: CORS });
}

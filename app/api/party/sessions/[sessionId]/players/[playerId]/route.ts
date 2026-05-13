import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiKey, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; playerId: string }> },
) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;
  const { sessionId, playerId } = await params;

  const { data: ownerCheck } = await admin
    .from("party_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("api_key_id", auth.ctx.apiKeyId)
    .maybeSingle();
  if (!ownerCheck) {
    return NextResponse.json({ error: "Session not found" }, { status: 404, headers: CORS });
  }

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

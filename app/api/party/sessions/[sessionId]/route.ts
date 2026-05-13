import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiKey, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  const { sessionId } = await params;

  const { data: session, error } = await admin
    .from("party_sessions")
    .select("id, join_code, game_id, status, max_players, metadata, created_at, expires_at, api_key_id")
    .eq("id", sessionId)
    .eq("api_key_id", auth.ctx.apiKeyId)
    .single();

  if (error || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404, headers: CORS });
  }

  const { data: players } = await admin
    .from("party_players")
    .select("id, display_name, slot, status, joined_at, metadata")
    .eq("session_id", sessionId)
    .order("slot");

  return NextResponse.json(
    {
      session_id: session.id,
      join_code: session.join_code,
      game_id: session.game_id,
      status: session.status,
      max_players: session.max_players,
      player_count: players?.length ?? 0,
      players: (players ?? []).map((p) => ({
        player_id: p.id,
        display_name: p.display_name,
        slot: p.slot,
        status: p.status,
        joined_at: p.joined_at,
        metadata: p.metadata,
      })),
      metadata: session.metadata,
      created_at: session.created_at,
      expires_at: session.expires_at,
    },
    { headers: CORS },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  const { sessionId } = await params;

  let body: { host_secret?: string; status?: string; metadata?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  if (!body.host_secret) {
    return NextResponse.json({ error: "host_secret is required" }, { status: 400, headers: CORS });
  }

  const { data: session, error: fetchError } = await admin
    .from("party_sessions")
    .select("id, host_secret, status, api_key_id")
    .eq("id", sessionId)
    .eq("api_key_id", auth.ctx.apiKeyId)
    .single();

  if (fetchError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404, headers: CORS });
  }

  if (session.host_secret !== body.host_secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
  }

  const updates: Record<string, unknown> = {};
  if (body.status === "active" || body.status === "ended") {
    updates.status = body.status;
    if (body.status === "ended") updates.ended_at = new Date().toISOString();
  }
  if (body.metadata && typeof body.metadata === "object") {
    updates.metadata = body.metadata;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true }, { headers: CORS });
  }

  const { error: updateError } = await admin
    .from("party_sessions")
    .update(updates)
    .eq("id", sessionId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500, headers: CORS });
  }

  return NextResponse.json({ ok: true }, { headers: CORS });
}

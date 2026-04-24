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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const { data, error } = await admin
    .from("party_players")
    .select("id, display_name, slot, status, joined_at, metadata")
    .eq("session_id", sessionId)
    .order("slot");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }

  return NextResponse.json(
    {
      players: (data ?? []).map((p) => ({
        player_id: p.id,
        display_name: p.display_name,
        slot: p.slot,
        status: p.status,
        joined_at: p.joined_at,
        metadata: p.metadata,
      })),
    },
    { headers: CORS },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  let body: { display_name?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const displayName = typeof body.display_name === "string"
    ? body.display_name.trim().slice(0, 24) || "Player"
    : "Player";
  const playerSecret = crypto.randomUUID();

  const { data, error } = await admin.rpc("party_join_session", {
    p_session_id: sessionId,
    p_display_name: displayName,
    p_player_secret: playerSecret,
  });

  if (error) {
    if (error.message?.includes("session_not_found")) {
      return NextResponse.json({ error: "Session not found or not active" }, { status: 404, headers: CORS });
    }
    if (error.message?.includes("session_full")) {
      return NextResponse.json({ error: "Session is full" }, { status: 409, headers: CORS });
    }
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return NextResponse.json({ error: "Failed to join session" }, { status: 500, headers: CORS });
  }

  return NextResponse.json(
    {
      player_id: row.player_id,
      player_secret: playerSecret,
      slot: row.player_slot,
      display_name: displayName,
    },
    { status: 201, headers: CORS },
  );
}

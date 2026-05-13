import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiKey, recordUsage, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { verifyPassword } from "@/lib/api/crypto";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// POST /api/mp/lobbies/[lobbyId]/screens
// Body: { party_session_id, party_session_host_secret, display_name?, password? }
// Verifies the joining screen owns its party_session and that any required password matches.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ lobbyId: string }> },
) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;
  const { lobbyId } = await params;

  let body: {
    party_session_id?: string;
    party_session_host_secret?: string;
    display_name?: string;
    password?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  if (!body.party_session_id || !body.party_session_host_secret) {
    return NextResponse.json(
      { error: "party_session_id and party_session_host_secret are required" },
      { status: 400, headers: CORS },
    );
  }

  const { data: lobby } = await admin
    .from("mp_lobbies")
    .select("id, password_hash, api_key_id, status")
    .eq("id", lobbyId)
    .maybeSingle();
  if (!lobby || lobby.api_key_id !== auth.ctx.apiKeyId) {
    return NextResponse.json({ error: "Lobby not found" }, { status: 404, headers: CORS });
  }
  if (lobby.status === "ended") {
    return NextResponse.json({ error: "Lobby has ended" }, { status: 410, headers: CORS });
  }

  if (lobby.password_hash) {
    if (!body.password || !verifyPassword(body.password, lobby.password_hash)) {
      return NextResponse.json({ error: "Invalid password" }, { status: 403, headers: CORS });
    }
  }

  // Verify the joining screen owns its party_session.
  const { data: hostSession } = await admin
    .from("party_sessions")
    .select("id, host_secret, api_key_id")
    .eq("id", body.party_session_id)
    .maybeSingle();
  if (!hostSession || hostSession.host_secret !== body.party_session_host_secret) {
    return NextResponse.json({ error: "Invalid screen credentials" }, { status: 403, headers: CORS });
  }
  if (hostSession.api_key_id && hostSession.api_key_id !== auth.ctx.apiKeyId) {
    return NextResponse.json({ error: "Screen belongs to a different api_key" }, { status: 403, headers: CORS });
  }

  const screenSecret = crypto.randomUUID();
  const displayName = (body.display_name ?? "").trim().slice(0, 60) || "Screen";

  const { data, error } = await admin.rpc("mp_join_lobby", {
    p_lobby_id: lobbyId,
    p_party_session_id: body.party_session_id,
    p_display_name: displayName,
    p_screen_secret: screenSecret,
  });

  if (error) {
    if (error.message?.includes("lobby_not_found")) {
      return NextResponse.json({ error: "Lobby not found" }, { status: 404, headers: CORS });
    }
    if (error.message?.includes("lobby_full")) {
      return NextResponse.json({ error: "Lobby is full" }, { status: 409, headers: CORS });
    }
    if (error.message?.includes("already_joined")) {
      return NextResponse.json({ error: "Screen already joined" }, { status: 409, headers: CORS });
    }
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return NextResponse.json({ error: "Failed to join lobby" }, { status: 500, headers: CORS });
  }

  recordUsage(auth.ctx.apiKeyId, "mp.lobby.join", { lobbyId });

  return NextResponse.json(
    {
      screen_id: row.screen_id,
      screen_secret: screenSecret,
      slot: row.screen_slot,
      display_name: displayName,
    },
    { status: 201, headers: CORS },
  );
}

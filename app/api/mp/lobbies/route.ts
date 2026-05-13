import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiKey, recordUsage, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { hashPassword } from "@/lib/api/crypto";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// GET /api/mp/lobbies?game_id=...
// List active lobbies for this developer's api_key, optionally filtered by game_id.
export async function GET(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const gameId = url.searchParams.get("game_id") ?? "";

  const query = admin
    .from("mp_lobbies")
    .select("id, join_code, game_id, display_name, status, max_screens, is_password_protected, visibility, metadata, created_at, expires_at")
    .eq("api_key_id", auth.ctx.apiKeyId)
    .eq("visibility", "public")
    .in("status", ["waiting", "active"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (gameId) query.eq("game_id", gameId);

  const { data: lobbies, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });

  const ids = (lobbies ?? []).map((l) => l.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: screens } = await admin
      .from("mp_lobby_screens")
      .select("lobby_id")
      .in("lobby_id", ids)
      .in("status", ["joined", "connected"]);
    for (const s of screens ?? []) {
      counts[s.lobby_id] = (counts[s.lobby_id] ?? 0) + 1;
    }
  }

  return NextResponse.json(
    {
      lobbies: (lobbies ?? []).map((l) => ({
        lobby_id: l.id,
        join_code: l.join_code,
        game_id: l.game_id,
        display_name: l.display_name,
        status: l.status,
        max_screens: l.max_screens,
        screen_count: counts[l.id] ?? 0,
        is_password_protected: l.is_password_protected,
        visibility: l.visibility,
        metadata: l.metadata,
        created_at: l.created_at,
        expires_at: l.expires_at,
      })),
    },
    { headers: CORS },
  );
}

// POST /api/mp/lobbies
// Body: { game_id, display_name, max_screens?, password?, host_screen_session_id, host_screen_secret, metadata? }
// host_screen_secret must equal the party_session.host_secret of host_screen_session_id.
export async function POST(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  let body: {
    game_id?: string;
    display_name?: string;
    max_screens?: number;
    password?: string;
    host_screen_session_id?: string;
    host_screen_secret?: string;
    visibility?: "public" | "private";
    metadata?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  const gameId = typeof body.game_id === "string" ? body.game_id.slice(0, 100) : "";
  if (!gameId) {
    return NextResponse.json({ error: "game_id is required" }, { status: 400, headers: CORS });
  }
  if (!body.host_screen_session_id || !body.host_screen_secret) {
    return NextResponse.json(
      { error: "host_screen_session_id and host_screen_secret are required" },
      { status: 400, headers: CORS },
    );
  }

  // Verify the host owns this party_session AND it belongs to the same api_key.
  const { data: hostSession } = await admin
    .from("party_sessions")
    .select("id, host_secret, api_key_id")
    .eq("id", body.host_screen_session_id)
    .maybeSingle();
  if (!hostSession || hostSession.host_secret !== body.host_screen_secret) {
    return NextResponse.json({ error: "Invalid host screen credentials" }, { status: 403, headers: CORS });
  }
  if (hostSession.api_key_id && hostSession.api_key_id !== auth.ctx.apiKeyId) {
    return NextResponse.json({ error: "Host screen belongs to a different api_key" }, { status: 403, headers: CORS });
  }

  const displayName = typeof body.display_name === "string" ? body.display_name.slice(0, 60) : "";
  const maxScreens = Math.min(Math.max(Number(body.max_screens ?? 4), 2), 16);
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const passwordHash = body.password ? hashPassword(body.password) : null;
  const visibility = body.visibility === "public" ? "public" : "private";
  const hostSecret = crypto.randomUUID();

  // Generate a unique join code (retry on collision).
  let joinCode: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: code } = await admin.rpc("generate_join_code");
    const { data: conflict } = await admin
      .from("mp_lobbies")
      .select("id")
      .eq("join_code", code as string)
      .neq("status", "ended")
      .maybeSingle();
    if (!conflict) {
      joinCode = code as string;
      break;
    }
  }
  if (!joinCode) {
    return NextResponse.json({ error: "Failed to generate join code" }, { status: 500, headers: CORS });
  }

  const { data: lobby, error } = await admin
    .from("mp_lobbies")
    .insert({
      join_code: joinCode,
      host_secret: hostSecret,
      host_screen_session_id: body.host_screen_session_id,
      api_key_id: auth.ctx.apiKeyId,
      game_id: gameId,
      display_name: displayName,
      max_screens: maxScreens,
      password_hash: passwordHash,
      visibility,
      metadata,
    })
    .select("id, join_code, expires_at")
    .single();
  if (error || !lobby) {
    return NextResponse.json({ error: error?.message ?? "Failed to create lobby" }, { status: 500, headers: CORS });
  }

  // Insert the host screen as the first mp_lobby_screens row (slot 1, is_host).
  const screenSecret = crypto.randomUUID();
  const { data: hostScreen, error: screenErr } = await admin
    .from("mp_lobby_screens")
    .insert({
      lobby_id: lobby.id,
      party_session_id: body.host_screen_session_id,
      screen_secret: screenSecret,
      display_name: displayName || "Host",
      slot: 1,
      is_host: true,
    })
    .select("id")
    .single();
  if (screenErr || !hostScreen) {
    return NextResponse.json({ error: "Failed to register host screen" }, { status: 500, headers: CORS });
  }

  recordUsage(auth.ctx.apiKeyId, "mp.lobby.create", { lobbyId: lobby.id });
  void admin.rpc("cleanup_party_data");

  return NextResponse.json(
    {
      lobby_id: lobby.id,
      join_code: lobby.join_code,
      host_secret: hostSecret,
      host_screen_id: hostScreen.id,
      host_screen_secret: screenSecret,
      expires_at: lobby.expires_at,
    },
    { status: 201, headers: CORS },
  );
}

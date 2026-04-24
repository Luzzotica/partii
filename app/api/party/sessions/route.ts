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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const gameId = url.searchParams.get("game_id") ?? "";

  const query = admin
    .from("party_sessions")
    .select("id, join_code, game_id, status, max_players, metadata, created_at, expires_at")
    .in("status", ["waiting", "active"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (gameId) {
    query.eq("game_id", gameId);
  }

  const { data: sessions, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: CORS },
    );
  }

  // Fetch player counts for each session
  const sessionIds = (sessions ?? []).map((s) => s.id);
  let playerCounts: Record<string, number> = {};
  if (sessionIds.length > 0) {
    const { data: players } = await admin
      .from("party_players")
      .select("session_id")
      .in("session_id", sessionIds)
      .in("status", ["joined", "connected"]);

    if (players) {
      for (const p of players) {
        playerCounts[p.session_id] = (playerCounts[p.session_id] ?? 0) + 1;
      }
    }
  }

  return NextResponse.json(
    {
      sessions: (sessions ?? []).map((s) => ({
        session_id: s.id,
        join_code: s.join_code,
        game_id: s.game_id,
        status: s.status,
        max_players: s.max_players,
        player_count: playerCounts[s.id] ?? 0,
        metadata: s.metadata,
        created_at: s.created_at,
        expires_at: s.expires_at,
      })),
    },
    { headers: CORS },
  );
}

export async function POST(request: Request) {
  let body: { game_id?: string; max_players?: number; metadata?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const gameId = typeof body.game_id === "string" ? body.game_id.slice(0, 100) : "";
  const maxPlayers = Math.min(Math.max(Number(body.max_players ?? 8), 1), 16);
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const hostSecret = crypto.randomUUID();

  // Generate a unique join code (retry up to 5× on collision)
  let joinCode: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: code } = await admin.rpc("generate_join_code");
    const { data: conflict } = await admin
      .from("party_sessions")
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
    return NextResponse.json(
      { error: "Failed to generate join code" },
      { status: 500, headers: CORS },
    );
  }

  const { data, error } = await admin
    .from("party_sessions")
    .insert({ join_code: joinCode, host_secret: hostSecret, game_id: gameId, max_players: maxPlayers, metadata })
    .select("id, join_code, expires_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create session" },
      { status: 500, headers: CORS },
    );
  }

  // Fire-and-forget cleanup of expired data
  void admin.rpc("cleanup_party_data");

  return NextResponse.json(
    {
      session_id: data.id,
      join_code: data.join_code,
      host_secret: hostSecret,
      expires_at: data.expires_at,
    },
    { status: 201, headers: CORS },
  );
}

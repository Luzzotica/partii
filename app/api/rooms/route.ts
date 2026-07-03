import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, recordUsage, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { hashPassword } from "@/lib/api/crypto";
import { generateTurnCredentials, mintCloudflareIceServers } from "@/lib/api/turn";
import { mintRoomToken } from "@/lib/api/roomToken";
import { enforceRoomCreateQuota } from "@/lib/api/quota";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// GET /api/rooms?game_id=...
// Lists public, joinable rooms for the calling api_key. The single
// endpoint that both phone-pairing flows and laptop-discovery flows
// can call (filter on metadata client-side if needed).
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const gameId = url.searchParams.get("game_id") ?? "";

  const query = admin
    .from("rooms")
    .select(
      "id, join_code, game_id, display_name, status, max_peers, is_password_protected, visibility, joinable, metadata, created_at, expires_at",
    )
    .eq("api_key_id", auth.ctx.apiKeyId)
    .eq("visibility", "public")
    .eq("joinable", true)
    .in("status", ["waiting", "active"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (gameId) query.eq("game_id", gameId);

  const { data: rooms, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });

  const ids = (rooms ?? []).map((r) => r.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: peers } = await admin
      .from("room_peers")
      .select("room_id")
      .in("room_id", ids)
      .in("status", ["joined", "connected"]);
    for (const p of peers ?? []) counts[p.room_id] = (counts[p.room_id] ?? 0) + 1;
  }

  return NextResponse.json(
    {
      rooms: (rooms ?? []).map((r) => ({
        room_id: r.id,
        join_code: r.join_code,
        game_id: r.game_id,
        display_name: r.display_name,
        status: r.status,
        max_peers: r.max_peers,
        peer_count: counts[r.id] ?? 0,
        is_password_protected: r.is_password_protected,
        visibility: r.visibility,
        joinable: r.joinable,
        metadata: r.metadata,
        created_at: r.created_at,
        expires_at: r.expires_at,
      })),
    },
    { headers: CORS },
  );
}

// POST /api/rooms
// Creates the room and its host peer atomically. The host_kind defaults to
// 'screen' (which is what bouncy-blobs uses); callers can pass anything.
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  // Damage cap: bound how many rooms a (possibly leaked) key can spin up.
  // Sweep expired rooms BEFORE the quota gate. The concurrent-rooms cap counts
  // non-ended rooms, so running cleanup only after a successful create used to
  // deadlock: 50 stale rooms → every create 429s → the post-create sweep never
  // runs. (The daily cron is too coarse for a 2h room TTL.)
  await admin.rpc("cleanup_room_data");

  const overQuota = await enforceRoomCreateQuota(admin, auth.ctx.projectId, auth.ctx.apiKeyId);
  if (overQuota) return overQuota;

  let body: {
    game_id?: string;
    display_name?: string;
    host_kind?: string;
    host_display_name?: string;
    host_metadata?: Record<string, unknown>;
    max_peers?: number;
    password?: string;
    visibility?: "public" | "private";
    metadata?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const gameId = typeof body.game_id === "string" ? body.game_id.slice(0, 100) : "";
  if (!gameId) {
    return NextResponse.json({ error: "game_id is required" }, { status: 400, headers: CORS });
  }
  const displayName = typeof body.display_name === "string" ? body.display_name.slice(0, 60) : "";
  const hostKind = (typeof body.host_kind === "string" ? body.host_kind : "screen").slice(0, 32);
  const hostDisplayName = typeof body.host_display_name === "string"
    ? body.host_display_name.slice(0, 60)
    : (displayName || "Host");
  const hostMetadata = body.host_metadata && typeof body.host_metadata === "object" ? body.host_metadata : {};
  const maxPeers = Math.min(Math.max(Number(body.max_peers ?? 8), 1), 16);
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const passwordHash = body.password ? hashPassword(body.password) : null;
  const visibility = body.visibility === "public" ? "public" : "private";
  const hostSecret = crypto.randomUUID();

  // Find a unique join code among non-ended rooms.
  let joinCode: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: code } = await admin.rpc("generate_join_code");
    const { data: conflict } = await admin
      .from("rooms")
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

  const { data: room, error } = await admin
    .from("rooms")
    .insert({
      join_code: joinCode,
      host_secret: hostSecret,
      api_key_id: auth.ctx.apiKeyId,
      game_id: gameId,
      display_name: displayName,
      max_peers: maxPeers,
      password_hash: passwordHash,
      visibility,
      metadata,
    })
    .select("id, join_code, expires_at")
    .single();
  if (error || !room) {
    return NextResponse.json({ error: error?.message ?? "Failed to create room" }, { status: 500, headers: CORS });
  }

  // Host peer row — direct insert (not the join RPC), since the join RPC
  // refuses host=true and we want this in the same logical creation flow.
  const hostPeerSecret = crypto.randomUUID();
  const { data: hostPeer, error: peerErr } = await admin
    .from("room_peers")
    .insert({
      room_id: room.id,
      peer_secret: hostPeerSecret,
      kind: hostKind,
      display_name: hostDisplayName,
      slot: 1,
      is_host: true,
      metadata: hostMetadata,
    })
    .select("id")
    .single();
  if (peerErr || !hostPeer) {
    return NextResponse.json({ error: "Failed to register host peer" }, { status: 500, headers: CORS });
  }

  recordUsage(auth.ctx.apiKeyId, "room.create", { roomId: room.id });

  const turn = generateTurnCredentials(auth.ctx.apiKeyId, hostPeer.id, auth.ctx.playerId);
  const cfIce = await mintCloudflareIceServers();

  return NextResponse.json(
    {
      room_id: room.id,
      join_code: room.join_code,
      host_secret: hostSecret,
      host_peer_id: hostPeer.id,
      host_peer_secret: hostPeerSecret,
      expires_at: room.expires_at,
      // Scoped credential for room-level surfaces (realtime signal gateway):
      // proves "host of THIS room" and nothing else.
      room_token: mintRoomToken(room.id, "host", "host", room.expires_at),
      signal_gw: process.env.SIGNAL_GW_PUBLIC_URL || undefined,
      ice_servers: [...turn.ice_servers, ...cfIce],
    },
    { status: 201, headers: CORS },
  );
}

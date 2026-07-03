import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, recordUsage, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { verifyPassword } from "@/lib/api/crypto";
import { generateTurnCredentials, mintCloudflareIceServers } from "@/lib/api/turn";
import { mintRoomToken } from "@/lib/api/roomToken";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// POST /api/rooms/[roomId]/peers
// Body: { kind, display_name?, password?, metadata? }
// Generates a peer_secret server-side and calls room_join() atomically.
// Returns { peer_id, peer_secret, slot }.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const { roomId } = await params;

  let body: {
    kind?: string;
    display_name?: string;
    password?: string;
    metadata?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  if (!body.kind || typeof body.kind !== "string") {
    return NextResponse.json({ error: "kind is required" }, { status: 400, headers: CORS });
  }

  const { data: room } = await admin
    .from("rooms")
    .select("id, password_hash, api_key_id, status")
    .eq("id", roomId)
    .maybeSingle();
  if (!room || room.api_key_id !== auth.ctx.apiKeyId) {
    return NextResponse.json({ error: "Room not found" }, { status: 404, headers: CORS });
  }
  if (room.status === "ended") {
    return NextResponse.json({ error: "Room has ended" }, { status: 410, headers: CORS });
  }
  if (room.password_hash) {
    if (!body.password || !verifyPassword(body.password, room.password_hash)) {
      return NextResponse.json({ error: "Invalid password" }, { status: 403, headers: CORS });
    }
  }

  const peerSecret = crypto.randomUUID();
  const displayName = (body.display_name ?? "").trim().slice(0, 60) || "Peer";
  const kind = body.kind.slice(0, 32);
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};

  const { data, error } = await admin.rpc("room_join", {
    p_room_id: roomId,
    p_kind: kind,
    p_display_name: displayName,
    p_peer_secret: peerSecret,
    p_metadata: metadata,
  });

  if (error) {
    if (error.message?.includes("room_not_found")) {
      return NextResponse.json({ error: "Room not found" }, { status: 404, headers: CORS });
    }
    if (error.message?.includes("room_full")) {
      return NextResponse.json({ error: "Room is full" }, { status: 409, headers: CORS });
    }
    if (error.message?.includes("room_not_joinable")) {
      return NextResponse.json({ error: "Room is not accepting new peers" }, { status: 423, headers: CORS });
    }
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return NextResponse.json({ error: "Failed to join room" }, { status: 500, headers: CORS });
  }

  recordUsage(auth.ctx.apiKeyId, "room.peer.join", { roomId });

  const turn = generateTurnCredentials(auth.ctx.apiKeyId, row.peer_id, auth.ctx.playerId);
  const cfIce = await mintCloudflareIceServers();

  return NextResponse.json(
    {
      peer_id: row.peer_id,
      peer_secret: peerSecret,
      room_token: mintRoomToken(roomId, row.peer_id, "peer"),
      slot: row.peer_slot,
      kind,
      display_name: displayName,
      ice_servers: [...turn.ice_servers, ...cfIce],
    },
    { status: 201, headers: CORS },
  );
}

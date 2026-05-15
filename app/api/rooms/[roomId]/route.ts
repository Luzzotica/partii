import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiKey, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// GET /api/rooms/[roomId]
// Returns full room + peer roster.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;
  const { roomId } = await params;

  const { data: room, error } = await admin
    .from("rooms")
    .select(
      "id, join_code, game_id, display_name, status, max_peers, is_password_protected, visibility, joinable, metadata, created_at, expires_at",
    )
    .eq("id", roomId)
    .eq("api_key_id", auth.ctx.apiKeyId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404, headers: CORS });

  const { data: peers } = await admin
    .from("room_peers")
    .select("id, kind, display_name, slot, is_host, status, metadata, joined_at")
    .eq("room_id", roomId)
    .order("slot");

  return NextResponse.json(
    {
      room_id: room.id,
      join_code: room.join_code,
      game_id: room.game_id,
      display_name: room.display_name,
      status: room.status,
      max_peers: room.max_peers,
      is_password_protected: room.is_password_protected,
      visibility: room.visibility,
      joinable: room.joinable,
      metadata: room.metadata,
      created_at: room.created_at,
      expires_at: room.expires_at,
      peers: (peers ?? []).map((p) => ({
        peer_id: p.id,
        kind: p.kind,
        display_name: p.display_name,
        slot: p.slot,
        is_host: p.is_host,
        status: p.status,
        metadata: p.metadata,
        joined_at: p.joined_at,
      })),
    },
    { headers: CORS },
  );
}

// PATCH /api/rooms/[roomId]
// Host-only. Updates status / visibility / joinable / max_peers / metadata.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;
  const { roomId } = await params;

  let body: {
    host_secret?: string;
    status?: string;
    visibility?: "public" | "private";
    joinable?: boolean;
    max_peers?: number;
    metadata?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }
  if (!body.host_secret) {
    return NextResponse.json({ error: "host_secret is required" }, { status: 400, headers: CORS });
  }

  const { data: room } = await admin
    .from("rooms")
    .select("id, host_secret, api_key_id")
    .eq("id", roomId)
    .maybeSingle();
  if (!room || room.api_key_id !== auth.ctx.apiKeyId) {
    return NextResponse.json({ error: "Room not found" }, { status: 404, headers: CORS });
  }
  if (room.host_secret !== body.host_secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
  }

  const updates: Record<string, unknown> = {};
  if (body.status === "active" || body.status === "ended") {
    updates.status = body.status;
    if (body.status === "ended") updates.ended_at = new Date().toISOString();
  }
  if (body.visibility === "public" || body.visibility === "private") {
    updates.visibility = body.visibility;
  }
  if (typeof body.joinable === "boolean") {
    updates.joinable = body.joinable;
  }
  if (typeof body.max_peers === "number" && Number.isFinite(body.max_peers)) {
    updates.max_peers = Math.min(Math.max(Math.trunc(body.max_peers), 1), 16);
  }
  if (body.metadata && typeof body.metadata === "object") {
    updates.metadata = body.metadata;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true }, { headers: CORS });
  }

  const { error: updErr } = await admin.from("rooms").update(updates).eq("id", roomId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500, headers: CORS });

  return NextResponse.json({ ok: true }, { headers: CORS });
}

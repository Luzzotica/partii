import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, recordUsage, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { rateLimit, tooManyRequests } from "@/lib/api/quota";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

async function assertRoomOwned(roomId: string, apiKeyId: string) {
  const { data } = await admin
    .from("rooms")
    .select("id, host_secret")
    .eq("id", roomId)
    .eq("api_key_id", apiKeyId)
    .maybeSingle();
  return data ?? null;
}

// GET /api/rooms/[roomId]/signals?recipient_peer_id=X&since_id=Y&limit=Z
// since_id is a BIGSERIAL cursor; the client persists next_since_id between polls.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const { roomId } = await params;
  if (!(await assertRoomOwned(roomId, auth.ctx.apiKeyId))) {
    return NextResponse.json({ error: "Room not found" }, { status: 404, headers: CORS });
  }

  const url = new URL(request.url);
  const recipientId = url.searchParams.get("recipient_peer_id");
  if (!recipientId) {
    return NextResponse.json({ error: "recipient_peer_id is required" }, { status: 400, headers: CORS });
  }
  const sinceId = Math.max(0, Number(url.searchParams.get("since_id") ?? 0));
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? 20)), 50);

  const { data, error } = await admin
    .from("room_signals")
    .select("id, sender_peer_id, signal_type, payload, created_at")
    .eq("room_id", roomId)
    .eq("recipient_peer_id", recipientId)
    .gt("id", sinceId)
    .order("id")
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });

  const signals = data ?? [];
  const next = signals.length > 0 ? signals[signals.length - 1].id : sinceId;
  return NextResponse.json(
    {
      signals: signals.map((s) => ({
        signal_id: s.id,
        sender_peer_id: s.sender_peer_id,
        signal_type: s.signal_type,
        payload: s.payload,
        created_at: s.created_at,
      })),
      next_since_id: next,
    },
    { headers: CORS },
  );
}

// POST /api/rooms/[roomId]/signals
// Body: { recipient_peer_id, signal_type, payload, host_secret? | peer_secret? + sender_peer_id? }
//
// Auth modes:
//   - host: { host_secret } → sender becomes "host"
//   - peer: { peer_secret, sender_peer_id } → sender becomes the peer's id
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  // Best-effort burst cap on signal posts per project (600/min ≈ 10/s — far
  // above real WebRTC signalling, which is a handful of messages per peer).
  if (!rateLimit(`signal:${auth.ctx.projectId}`, 600, 60_000)) {
    return tooManyRequests("Signalling rate limit exceeded");
  }

  const { roomId } = await params;
  const room = await assertRoomOwned(roomId, auth.ctx.apiKeyId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404, headers: CORS });

  let body: {
    host_secret?: string;
    peer_secret?: string;
    sender_peer_id?: string;
    recipient_peer_id?: string;
    signal_type?: string;
    payload?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  if (!body.recipient_peer_id) {
    return NextResponse.json({ error: "recipient_peer_id is required" }, { status: 400, headers: CORS });
  }
  if (!body.signal_type || !["offer", "answer", "ice_candidate"].includes(body.signal_type)) {
    return NextResponse.json({ error: "Invalid signal_type" }, { status: 400, headers: CORS });
  }
  if (!body.payload || typeof body.payload !== "object") {
    return NextResponse.json({ error: "payload is required" }, { status: 400, headers: CORS });
  }

  let senderId: string;
  if (body.host_secret) {
    if (body.host_secret !== room.host_secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
    }
    senderId = "host";
  } else if (body.peer_secret && body.sender_peer_id) {
    const { data: peer } = await admin
      .from("room_peers")
      .select("id, peer_secret")
      .eq("id", body.sender_peer_id)
      .eq("room_id", roomId)
      .maybeSingle();
    if (!peer || peer.peer_secret !== body.peer_secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
    }
    senderId = peer.id;
  } else {
    return NextResponse.json(
      { error: "host_secret or (peer_secret + sender_peer_id) is required" },
      { status: 400, headers: CORS },
    );
  }

  const { data: ins, error: insErr } = await admin
    .from("room_signals")
    .insert({
      room_id: roomId,
      sender_peer_id: senderId,
      recipient_peer_id: body.recipient_peer_id,
      signal_type: body.signal_type,
      payload: body.payload,
    })
    .select("id")
    .single();
  if (insErr || !ins) {
    return NextResponse.json({ error: insErr?.message ?? "Failed to store signal" }, { status: 500, headers: CORS });
  }

  recordUsage(auth.ctx.apiKeyId, "room.signal.post", { roomId });

  // Realtime fast path: forward the stored row to the signal gateway, which
  // pushes it to the addressed peer's WebSocket instantly. Fire-and-forget —
  // the recipient's reconciliation poll covers any gateway failure, so this
  // must never delay or fail the durable POST.
  const gw = process.env.SIGNAL_GW_URL;
  const gwToken = process.env.SIGNAL_GW_TOKEN;
  if (gw && gwToken) {
    // after(): Vercel freezes a serverless function the moment the response is
    // sent — a bare `void fetch()` never completes in prod. after() keeps the
    // instance alive until the forward settles, without delaying the response.
    after(fetch(`${gw.replace(/\/$/, "")}/push`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gwToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        room_id: roomId,
        recipient_peer_id: body.recipient_peer_id,
        signal: {
          signal_id: ins.id,
          sender_peer_id: senderId,
          signal_type: body.signal_type,
          payload: body.payload,
          created_at: new Date().toISOString(),
        },
      }),
      signal: AbortSignal.timeout(1500),
    }).catch(() => { /* poll path reconciles */ }));
  }

  return NextResponse.json({ signal_id: ins.id }, { status: 201, headers: CORS });
}

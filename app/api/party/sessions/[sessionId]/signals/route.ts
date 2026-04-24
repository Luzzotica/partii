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

// GET /api/party/sessions/[sessionId]/signals
// Poll for signals addressed to a recipient since a cursor.
// Query params: recipient_id (required), since_id (default 0), limit (default 20, max 50)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const url = new URL(request.url);

  const recipientId = url.searchParams.get("recipient_id");
  if (!recipientId) {
    return NextResponse.json({ error: "recipient_id is required" }, { status: 400, headers: CORS });
  }

  const sinceId = Math.max(0, Number(url.searchParams.get("since_id") ?? 0));
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? 20)), 50);

  const { data, error } = await admin
    .from("party_signaling")
    .select("id, sender_id, signal_type, payload, created_at")
    .eq("session_id", sessionId)
    .eq("recipient_id", recipientId)
    .gt("id", sinceId)
    .order("id")
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }

  const signals = data ?? [];
  const nextSinceId = signals.length > 0 ? signals[signals.length - 1].id : sinceId;

  return NextResponse.json(
    {
      signals: signals.map((s) => ({
        signal_id: s.id,
        sender_id: s.sender_id,
        signal_type: s.signal_type,
        payload: s.payload,
        created_at: s.created_at,
      })),
      next_since_id: nextSinceId,
    },
    { headers: CORS },
  );
}

// POST /api/party/sessions/[sessionId]/signals
// Send a WebRTC signal. Auth via host_secret or player_secret.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  let body: {
    host_secret?: string;
    player_secret?: string;
    sender_player_id?: string;
    recipient_id?: string;
    signal_type?: string;
    payload?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  // Validate required fields
  if (!body.recipient_id) {
    return NextResponse.json({ error: "recipient_id is required" }, { status: 400, headers: CORS });
  }
  if (!body.signal_type || !["offer", "answer", "ice_candidate"].includes(body.signal_type)) {
    return NextResponse.json({ error: "signal_type must be offer, answer, or ice_candidate" }, { status: 400, headers: CORS });
  }
  if (!body.payload || typeof body.payload !== "object") {
    return NextResponse.json({ error: "payload is required" }, { status: 400, headers: CORS });
  }
  if (body.host_secret && body.player_secret) {
    return NextResponse.json({ error: "Provide host_secret or player_secret, not both" }, { status: 400, headers: CORS });
  }
  if (!body.host_secret && !body.player_secret) {
    return NextResponse.json({ error: "host_secret or player_secret is required" }, { status: 400, headers: CORS });
  }

  let senderId: string;

  if (body.host_secret) {
    // Verify host identity
    const { data: session, error } = await admin
      .from("party_sessions")
      .select("id, host_secret")
      .eq("id", sessionId)
      .single();

    if (error || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404, headers: CORS });
    }
    if (session.host_secret !== body.host_secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
    }
    senderId = "host";
  } else {
    // Verify controller identity
    if (!body.sender_player_id) {
      return NextResponse.json({ error: "sender_player_id is required when using player_secret" }, { status: 400, headers: CORS });
    }
    const { data: player, error } = await admin
      .from("party_players")
      .select("id, player_secret")
      .eq("id", body.sender_player_id)
      .eq("session_id", sessionId)
      .single();

    if (error || !player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404, headers: CORS });
    }
    if (player.player_secret !== body.player_secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
    }
    senderId = player.id;
  }

  const { data, error: insertError } = await admin
    .from("party_signaling")
    .insert({
      session_id: sessionId,
      sender_id: senderId,
      recipient_id: body.recipient_id,
      signal_type: body.signal_type,
      payload: body.payload,
    })
    .select("id")
    .single();

  if (insertError || !data) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to store signal" },
      { status: 500, headers: CORS },
    );
  }

  return NextResponse.json({ signal_id: data.id }, { status: 201, headers: CORS });
}

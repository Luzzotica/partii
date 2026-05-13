import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiKey, recordUsage, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

async function assertLobbyOwned(lobbyId: string, apiKeyId: string) {
  const { data } = await admin
    .from("mp_lobbies")
    .select("id, host_secret")
    .eq("id", lobbyId)
    .eq("api_key_id", apiKeyId)
    .maybeSingle();
  return data ?? null;
}

// GET /api/mp/lobbies/[lobbyId]/signals?recipient_id=X&since_id=Y&limit=Z
export async function GET(
  request: Request,
  { params }: { params: Promise<{ lobbyId: string }> },
) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;
  const { lobbyId } = await params;
  if (!(await assertLobbyOwned(lobbyId, auth.ctx.apiKeyId))) {
    return NextResponse.json({ error: "Lobby not found" }, { status: 404, headers: CORS });
  }

  const url = new URL(request.url);
  const recipientId = url.searchParams.get("recipient_id");
  if (!recipientId) {
    return NextResponse.json({ error: "recipient_id is required" }, { status: 400, headers: CORS });
  }
  const sinceId = Math.max(0, Number(url.searchParams.get("since_id") ?? 0));
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? 20)), 50);

  const { data, error } = await admin
    .from("mp_signaling")
    .select("id, sender_id, signal_type, payload, created_at")
    .eq("lobby_id", lobbyId)
    .eq("recipient_id", recipientId)
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
        sender_id: s.sender_id,
        signal_type: s.signal_type,
        payload: s.payload,
        created_at: s.created_at,
      })),
      next_since_id: next,
    },
    { headers: CORS },
  );
}

// POST /api/mp/lobbies/[lobbyId]/signals
// Body: { sender_screen_id?, sender_is_host?, host_secret? | screen_secret?, recipient_id, signal_type, payload }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ lobbyId: string }> },
) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;
  const { lobbyId } = await params;
  const lobby = await assertLobbyOwned(lobbyId, auth.ctx.apiKeyId);
  if (!lobby) return NextResponse.json({ error: "Lobby not found" }, { status: 404, headers: CORS });

  let body: {
    host_secret?: string;
    screen_secret?: string;
    sender_screen_id?: string;
    recipient_id?: string;
    signal_type?: string;
    payload?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  if (!body.recipient_id) {
    return NextResponse.json({ error: "recipient_id is required" }, { status: 400, headers: CORS });
  }
  if (!body.signal_type || !["offer", "answer", "ice_candidate"].includes(body.signal_type)) {
    return NextResponse.json({ error: "Invalid signal_type" }, { status: 400, headers: CORS });
  }
  if (!body.payload || typeof body.payload !== "object") {
    return NextResponse.json({ error: "payload is required" }, { status: 400, headers: CORS });
  }

  let senderId: string;
  if (body.host_secret) {
    if (body.host_secret !== lobby.host_secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
    }
    senderId = "host";
  } else if (body.screen_secret && body.sender_screen_id) {
    const { data: screen } = await admin
      .from("mp_lobby_screens")
      .select("id, screen_secret")
      .eq("id", body.sender_screen_id)
      .eq("lobby_id", lobbyId)
      .maybeSingle();
    if (!screen || screen.screen_secret !== body.screen_secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
    }
    senderId = screen.id;
  } else {
    return NextResponse.json(
      { error: "host_secret or (screen_secret + sender_screen_id) is required" },
      { status: 400, headers: CORS },
    );
  }

  const { data: ins, error: insErr } = await admin
    .from("mp_signaling")
    .insert({
      lobby_id: lobbyId,
      sender_id: senderId,
      recipient_id: body.recipient_id,
      signal_type: body.signal_type,
      payload: body.payload,
    })
    .select("id")
    .single();
  if (insErr || !ins) {
    return NextResponse.json({ error: insErr?.message ?? "Failed to store signal" }, { status: 500, headers: CORS });
  }

  recordUsage(auth.ctx.apiKeyId, "mp.signal.post", { lobbyId });
  return NextResponse.json({ signal_id: ins.id }, { status: 201, headers: CORS });
}

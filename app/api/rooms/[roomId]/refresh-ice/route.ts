import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { rateLimit, tooManyRequests } from "@/lib/api/quota";
import { generateTurnCredentials, mintCloudflareIceServers, stunOnlyIceServers } from "@/lib/api/turn";
import { relayCapStatus } from "@/lib/billing/relayCap";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// POST /api/rooms/[roomId]/refresh-ice
// Mint a FRESH set of ICE servers (coturn + Cloudflare, new short-TTL creds)
// for a peer already in the room. TURN credentials expire after ~10 minutes,
// so an ICE restart deep into a match re-gathers with DEAD relay creds and the
// restart silently fails — this endpoint powers the transport's tier-2
// recovery: full renegotiation with working relays.
//
// Auth mirrors the signals route: host_secret, or (peer_secret + peer_id).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (!rateLimit(`refresh-ice:${auth.ctx.projectId}`, 60, 60_000)) {
    return tooManyRequests("refresh-ice rate limit exceeded");
  }

  const { roomId } = await params;
  const { data: room } = await admin
    .from("rooms")
    .select("id, host_secret")
    .eq("id", roomId)
    .eq("api_key_id", auth.ctx.apiKeyId)
    .maybeSingle();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404, headers: CORS });

  let body: { host_secret?: string; peer_secret?: string; peer_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  let peerTag: string;
  if (body.host_secret) {
    if (body.host_secret !== room.host_secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
    }
    peerTag = "host";
  } else if (body.peer_secret && body.peer_id) {
    const { data: peer } = await admin
      .from("room_peers")
      .select("id, peer_secret")
      .eq("id", body.peer_id)
      .eq("room_id", roomId)
      .maybeSingle();
    if (!peer || peer.peer_secret !== body.peer_secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
    }
    peerTag = peer.id;
  } else {
    return NextResponse.json(
      { error: "host_secret or (peer_secret + peer_id) is required" },
      { status: 400, headers: CORS },
    );
  }

  const turn = generateTurnCredentials(auth.ctx.apiKeyId, peerTag, auth.ctx.playerId);
  const { data: projRow } = await admin
    .from("projects")
    .select("id, plan, relay_included_gb")
    .eq("id", auth.ctx.projectId)
    .maybeSingle();
  const cap = await relayCapStatus(admin, projRow ?? { id: auth.ctx.projectId, plan: "free", relay_included_gb: 5 });
  const cfIce = cap.capped ? [] : await mintCloudflareIceServers();
  return NextResponse.json(
    { ice_servers: cap.capped ? stunOnlyIceServers() : [...turn.ice_servers, ...cfIce] },
    { headers: CORS },
  );
}

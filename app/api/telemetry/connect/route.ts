import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { rateLimit, tooManyRequests } from "@/lib/api/quota";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

const OUTCOMES = new Set(["connected", "timeout", "failed", "recovered", "gave_up"]);
const CANDIDATE_TYPES = new Set(["host", "srflx", "prflx", "relay"]);
const SIGNALING_PATHS = new Set(["poll", "push"]);
const ROLES = new Set(["host", "peer"]);

const clampInt = (v: unknown, max: number): number | null => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.round(n), max);
};
const short = (v: unknown, max = 64): string | null =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;

// POST /api/telemetry/connect
// Fire-and-forget connection-outcome telemetry from game clients. This is the
// measurement layer for connection reliability: every attempt reports what
// happened, how long it took, which ICE candidate type won, and which
// signaling path delivered the handshake. Clients must never block gameplay
// on this call.
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (!rateLimit(`telemetry:${auth.ctx.apiKeyId}`, 300, 60_000)) {
    return tooManyRequests("telemetry rate limit");
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers: CORS });
  }

  const outcome = short(body.outcome, 16) ?? "";
  if (!OUTCOMES.has(outcome)) {
    return NextResponse.json({ error: "invalid outcome" }, { status: 400, headers: CORS });
  }
  const role = short(body.role, 8) ?? "";
  const candidateType = short(body.candidate_type, 8);
  const signalingPath = short(body.signaling_path, 8);

  // room_id must be a UUID or omitted (column is typed UUID).
  const roomIdRaw = short(body.room_id, 40);
  const roomId = roomIdRaw && /^[0-9a-f-]{36}$/i.test(roomIdRaw) ? roomIdRaw : null;

  const { error } = await admin.from("connection_events").insert({
    api_key_id: auth.ctx.apiKeyId,
    game_id: short(body.game_id, 64) ?? "",
    room_id: roomId,
    role: ROLES.has(role) ? role : "",
    outcome,
    connect_ms: clampInt(body.connect_ms, 120_000),
    candidate_type: candidateType && CANDIDATE_TYPES.has(candidateType) ? candidateType : null,
    relay_host: short(body.relay_host, 128),
    ice_restarts: clampInt(body.ice_restarts, 100) ?? 0,
    signaling_path: signalingPath && SIGNALING_PATHS.has(signalingPath) ? signalingPath : null,
    ua_hint: short(body.ua_hint, 64),
    player_id: auth.ctx.playerId ?? short(body.player_id, 128),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });

  return NextResponse.json({ ok: true }, { headers: CORS });
}

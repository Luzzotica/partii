import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const admin = createAdminClient();

// POST /api/turn/usage
// Called by the arcade-turn Fly app's usage reporter on session close.
//
// Auth: Authorization: Bearer <TURN_USAGE_TOKEN>  (shared with Fly secret).
// Body: { events: TurnUsageEvent[] }
//
// Each event already has an authoritative `api_key_id`: it came from a
// coturn-validated HMAC username minted by hexii/lib/api/turn.ts, so we
// know Vercel signed it. We still defend against malformed payloads.

type Event = {
  session_id?: string;
  api_key_id?: string;
  peer_tag?: string;
  realm?: string;
  bytes_sent?: number;
  bytes_received?: number;
  packets_sent?: number;
  packets_received?: number;
  started_at?: string;
  ended_at?: string;
};

const MAX_EVENTS = 500;

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function isNonNeg(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

export async function POST(request: Request) {
  const expected = process.env.TURN_USAGE_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ") || auth.slice(7) !== expected) {
    return unauthorized();
  }

  let body: { events?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json({ error: "events[] required" }, { status: 400 });
  }
  if (body.events.length > MAX_EVENTS) {
    return NextResponse.json({ error: `max ${MAX_EVENTS} events per request` }, { status: 400 });
  }

  const rows: Array<{
    api_key_id: string;
    session_id: string | null;
    peer_tag: string | null;
    realm: string | null;
    bytes_sent: number;
    bytes_received: number;
    packets_sent: number;
    packets_received: number;
    started_at: string | null;
    ended_at: string;
  }> = [];

  for (const raw of body.events as Event[]) {
    if (!raw || typeof raw !== "object") continue;
    if (typeof raw.api_key_id !== "string" || raw.api_key_id.length < 8) continue;
    if (!isNonNeg(raw.bytes_sent) || !isNonNeg(raw.bytes_received)) continue;
    rows.push({
      api_key_id: raw.api_key_id,
      session_id: typeof raw.session_id === "string" ? raw.session_id.slice(0, 64) : null,
      peer_tag: typeof raw.peer_tag === "string" ? raw.peer_tag.slice(0, 64) : null,
      realm: typeof raw.realm === "string" ? raw.realm.slice(0, 128) : null,
      bytes_sent: Math.floor(raw.bytes_sent),
      bytes_received: Math.floor(raw.bytes_received),
      packets_sent: isNonNeg(raw.packets_sent) ? Math.floor(raw.packets_sent) : 0,
      packets_received: isNonNeg(raw.packets_received) ? Math.floor(raw.packets_received) : 0,
      started_at: typeof raw.started_at === "string" ? raw.started_at : null,
      ended_at: typeof raw.ended_at === "string" ? raw.ended_at : new Date().toISOString(),
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 });
  }

  // UPSERT on (api_key_id, session_id) so a retry from the reporter is idempotent.
  const { error, count } = await admin
    .from("turn_usage")
    .upsert(rows, { onConflict: "api_key_id,session_id", count: "exact", ignoreDuplicates: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, inserted: count ?? rows.length });
}

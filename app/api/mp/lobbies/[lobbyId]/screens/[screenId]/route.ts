import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiKey, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// PATCH — update screen status / display name. Auth: screen_secret.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ lobbyId: string; screenId: string }> },
) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;
  const { lobbyId, screenId } = await params;

  let body: { screen_secret?: string; status?: string; display_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }
  if (!body.screen_secret) {
    return NextResponse.json({ error: "screen_secret is required" }, { status: 400, headers: CORS });
  }

  const { data: screen } = await admin
    .from("mp_lobby_screens")
    .select("id, lobby_id, screen_secret")
    .eq("id", screenId)
    .eq("lobby_id", lobbyId)
    .maybeSingle();
  if (!screen) return NextResponse.json({ error: "Screen not found" }, { status: 404, headers: CORS });
  if (screen.screen_secret !== body.screen_secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
  }

  const updates: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
  if (body.status === "joined" || body.status === "connected" || body.status === "disconnected") {
    updates.status = body.status;
  }
  if (typeof body.display_name === "string") {
    updates.display_name = body.display_name.slice(0, 60);
  }

  const { error: updErr } = await admin.from("mp_lobby_screens").update(updates).eq("id", screenId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500, headers: CORS });

  return NextResponse.json({ ok: true }, { headers: CORS });
}

// DELETE — voluntary leave.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ lobbyId: string; screenId: string }> },
) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;
  const { lobbyId, screenId } = await params;

  const url = new URL(request.url);
  const screenSecret = url.searchParams.get("screen_secret") ?? "";
  if (!screenSecret) {
    return NextResponse.json({ error: "screen_secret is required" }, { status: 400, headers: CORS });
  }

  const { data: screen } = await admin
    .from("mp_lobby_screens")
    .select("id, screen_secret")
    .eq("id", screenId)
    .eq("lobby_id", lobbyId)
    .maybeSingle();
  if (!screen || screen.screen_secret !== screenSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
  }

  await admin
    .from("mp_lobby_screens")
    .update({ status: "disconnected", last_seen_at: new Date().toISOString() })
    .eq("id", screenId);

  return NextResponse.json({ ok: true }, { headers: CORS });
}

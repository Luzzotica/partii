import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { verifyPlayerToken } from "@/lib/api/playerToken";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// GET /api/players/me — the signed-in player + linked identities.
// Auth: Bearer <player_token>.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const claims = verifyPlayerToken(auth.replace(/^bearer\s+/i, ""));
  if (!claims) return NextResponse.json({ error: "Invalid player token" }, { status: 401, headers: CORS });

  const { data: player } = await admin
    .from("players")
    .select("id, display_name, banned, created_at, last_seen_at")
    .eq("id", claims.pid)
    .eq("project_id", claims.proj)
    .maybeSingle();
  if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404, headers: CORS });

  const { data: identities } = await admin
    .from("player_identities")
    .select("provider, subject, created_at")
    .eq("player_id", claims.pid)
    .order("created_at");

  return NextResponse.json(
    {
      player_id: player.id,
      display_name: player.display_name,
      banned: player.banned,
      created_at: player.created_at,
      identities: (identities ?? []).map((i) => ({
        provider: i.provider,
        // Mask subjects — enough to recognize ("…1234"), not enough to leak.
        subject_hint: `…${String(i.subject).slice(-4)}`,
        linked_at: i.created_at,
      })),
    },
    { headers: CORS },
  );
}

// PATCH /api/players/me — update display_name.
export async function PATCH(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const claims = verifyPlayerToken(auth.replace(/^bearer\s+/i, ""));
  if (!claims) return NextResponse.json({ error: "Invalid player token" }, { status: 401, headers: CORS });

  let body: { display_name?: string };
  try { body = await request.json(); } catch { body = {}; }
  const displayName = (body.display_name ?? "").trim().slice(0, 60);
  if (!displayName) return NextResponse.json({ error: "display_name required" }, { status: 400, headers: CORS });

  const { data, error } = await admin
    .from("players")
    .update({ display_name: displayName })
    .eq("id", claims.pid)
    .eq("project_id", claims.proj)
    .eq("banned", false)
    .select("id, display_name")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  if (!data) return NextResponse.json({ error: "Player not found or banned" }, { status: 404, headers: CORS });
  return NextResponse.json({ player_id: data.id, display_name: data.display_name }, { headers: CORS });
}

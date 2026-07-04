import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { verifyPlayerToken } from "@/lib/api/playerToken";
import { verifyProviderProof, type ProviderProof } from "@/lib/api/identity";
import { PROVIDER_CRED_COLUMNS, credsFromProjectRow } from "@/lib/api/identity/store";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// POST /api/players/link — attach another provider identity to the signed-in
// player (e.g. an anonymous player links Steam to become recoverable).
// Auth: Bearer <player_token>. Body: { provider, ...proof }.
// 409 if that identity already belongs to a different player (no force-link).
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const claims = verifyPlayerToken(auth.replace(/^bearer\s+/i, ""));
  if (!claims) return NextResponse.json({ error: "Invalid player token" }, { status: 401, headers: CORS });

  let body: ProviderProof & { provider?: string };
  try { body = await request.json(); } catch { body = {}; }
  const provider = (body.provider ?? "").slice(0, 16);
  if (!provider) return NextResponse.json({ error: "provider required" }, { status: 400, headers: CORS });

  const { data: player } = await admin
    .from("players")
    .select("id, banned")
    .eq("id", claims.pid)
    .eq("project_id", claims.proj)
    .maybeSingle();
  if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404, headers: CORS });
  if (player.banned) return NextResponse.json({ error: "player_banned" }, { status: 403, headers: CORS });

  const { data: project } = await admin
    .from("projects")
    .select(`id, ${PROVIDER_CRED_COLUMNS}`)
    .eq("id", claims.proj)
    .maybeSingle();
  const verified = await verifyProviderProof(provider, body, credsFromProjectRow(project));
  if (!verified.ok) {
    return NextResponse.json({ error: `Link rejected: ${verified.reason}` }, { status: 403, headers: CORS });
  }

  const { error } = await admin
    .from("player_identities")
    .insert({ player_id: claims.pid, project_id: claims.proj, provider, subject: verified.subject });
  if (error) {
    // Unique violation → that identity already belongs to someone.
    if (error.code === "23505") {
      const { data: existing } = await admin
        .from("player_identities")
        .select("player_id")
        .eq("project_id", claims.proj)
        .eq("provider", provider)
        .eq("subject", verified.subject)
        .maybeSingle();
      if (existing?.player_id === claims.pid) {
        return NextResponse.json({ linked: true, already: true }, { headers: CORS });
      }
      return NextResponse.json({ error: "identity_already_linked" }, { status: 409, headers: CORS });
    }
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }
  return NextResponse.json({ linked: true, provider }, { headers: CORS });
}

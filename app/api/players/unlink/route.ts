import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { verifyPlayerToken } from "@/lib/api/playerToken";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// POST /api/players/unlink — remove a linked provider identity.
// Auth: Bearer <player_token>. Body: { provider, subject_hint? }.
// The LAST identity can never be unlinked (the account would be unreachable).
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const claims = verifyPlayerToken(auth.replace(/^bearer\s+/i, ""));
  if (!claims) return NextResponse.json({ error: "Invalid player token" }, { status: 401, headers: CORS });

  let body: { provider?: string };
  try { body = await request.json(); } catch { body = {}; }
  const provider = (body.provider ?? "").slice(0, 16);
  if (!provider) return NextResponse.json({ error: "provider required" }, { status: 400, headers: CORS });

  const { data: identities } = await admin
    .from("player_identities")
    .select("id, provider")
    .eq("player_id", claims.pid);
  const mine = identities ?? [];
  const target = mine.find((i) => i.provider === provider);
  if (!target) return NextResponse.json({ error: "identity_not_linked" }, { status: 404, headers: CORS });
  if (mine.length <= 1) {
    return NextResponse.json({ error: "cannot_unlink_last_identity" }, { status: 400, headers: CORS });
  }

  const { error } = await admin.from("player_identities").delete().eq("id", target.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  return NextResponse.json({ unlinked: true, provider }, { headers: CORS });
}

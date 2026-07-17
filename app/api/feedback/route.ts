import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { rateLimit, tooManyRequests } from "@/lib/api/quota";
import { verifyPlayerToken } from "@/lib/api/playerToken";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// POST /api/feedback — player-submitted match rating and/or freeform feedback.
// Auth: Bearer <player_token>. Anonymous players ARE allowed — feedback is
// input, not published content, so playerHasRealIdentity does not apply. The
// token still gives attribution, the banned kill switch, and a stable pid to
// rate-limit on.
// Body: { rating?, text?, game_id?, context?, match_id? } — at least one of
// rating/text required.
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const claims = verifyPlayerToken(auth.replace(/^bearer\s+/i, ""));
  if (!claims) return NextResponse.json({ error: "Invalid player token" }, { status: 401, headers: CORS });
  if (!rateLimit(`feedback:pid:${claims.pid}`, 5, 60_000)) return tooManyRequests("feedback rate limit");
  if (!rateLimit(`feedback:proj:${claims.proj}`, 120, 60_000)) return tooManyRequests("feedback rate limit");

  let body: { rating?: unknown; text?: unknown; game_id?: unknown; context?: unknown; match_id?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  const rating = typeof body.rating === "number" && Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5
    ? body.rating : null;
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
  if (rating === null && !text) {
    return NextResponse.json({ error: "rating (int 1-5) or text required" }, { status: 400, headers: CORS });
  }

  const { data: player } = await admin
    .from("players").select("id, banned").eq("id", claims.pid).eq("project_id", claims.proj).maybeSingle();
  if (!player || player.banned) {
    return NextResponse.json({ error: "Player not found or banned" }, { status: 403, headers: CORS });
  }

  const { data: row, error } = await admin
    .from("feedback")
    .insert({
      project_id: claims.proj,
      player_id: claims.pid,
      game_id: (typeof body.game_id === "string" ? body.game_id.slice(0, 64) : "") || null,
      rating,
      text: text || null,
      context: (typeof body.context === "string" ? body.context.slice(0, 120) : "") || null,
      match_id: (typeof body.match_id === "string" ? body.match_id.slice(0, 64) : "") || null,
      status: "new",
    })
    .select("id")
    .single();
  if (error || !row) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500, headers: CORS });

  return NextResponse.json({ id: row.id }, { status: 201, headers: CORS });
}

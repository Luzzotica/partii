import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { rateLimit, tooManyRequests } from "@/lib/api/quota";
import { verifyPlayerToken } from "@/lib/api/playerToken";
import { playerHasRealIdentity } from "@/lib/api/identity/store";
import { checkContentQuota, shareCode } from "@/lib/api/contentQuota";

const admin = createAdminClient();
const BUCKET = "player-content";
const INLINE_LIMIT = 512 * 1024;

export async function OPTIONS() {
  return corsPreflight();
}

function playerFromRequest(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  return verifyPlayerToken(auth.replace(/^bearer\s+/i, ""));
}

// POST /api/player-content — inline create (JSON ≤ 512KB).
// Auth: Bearer <player_token>.
// Body: { content_type, name, description?, game_id?, visibility?, data }
export async function POST(request: Request) {
  const claims = playerFromRequest(request);
  if (!claims) return NextResponse.json({ error: "Invalid player token" }, { status: 401, headers: CORS });
  if (!rateLimit(`content:${claims.proj}`, 120, 60_000)) return tooManyRequests("content rate limit");

  let body: {
    content_type?: string; name?: string; description?: string;
    game_id?: string; visibility?: string; data?: unknown;
  };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }
  const contentType = (body.content_type ?? "").slice(0, 32);
  const name = (body.name ?? "").trim().slice(0, 100);
  if (!contentType || !name) {
    return NextResponse.json({ error: "content_type and name are required" }, { status: 400, headers: CORS });
  }
  const visibility = ["private", "unlisted", "public"].includes(body.visibility ?? "")
    ? (body.visibility as string) : "private";
  if (body.data === undefined) {
    return NextResponse.json({ error: "data required (use /upload-url for binary/large content)" }, { status: 400, headers: CORS });
  }
  const blob = JSON.stringify(body.data);
  const size = Buffer.byteLength(blob);
  if (size > INLINE_LIMIT) {
    return NextResponse.json({ error: "data exceeds 512KB — use /api/player-content/upload-url" }, { status: 413, headers: CORS });
  }

  // Owner must exist + not be banned.
  const { data: player } = await admin
    .from("players").select("id, banned").eq("id", claims.pid).eq("project_id", claims.proj).maybeSingle();
  if (!player || player.banned) {
    return NextResponse.json({ error: "Player not found or banned" }, { status: 403, headers: CORS });
  }
  // Global publish gate: anonymous players can save locally but must sign in
  // to publish to the cloud (maps, replays — everything).
  if (!(await playerHasRealIdentity(admin, claims.pid))) {
    return NextResponse.json({ error: "login_required" }, { status: 403, headers: CORS });
  }

  const quota = await checkContentQuota(admin, claims.proj, size);
  if (!quota.allowed) return NextResponse.json({ error: quota.reason, quota: true }, { status: 402, headers: CORS });

  const { data: row, error } = await admin
    .from("player_content")
    .insert({
      project_id: claims.proj,
      owner_player_id: claims.pid,
      game_id: (body.game_id ?? "").slice(0, 64) || null,
      content_type: contentType,
      name,
      description: (body.description ?? "").slice(0, 500) || null,
      visibility,
      share_code: shareCode(),
      status: "ready",
      size_bytes: size,
      content_mime: "application/json",
      storage_path: "",
    })
    .select("id, share_code")
    .single();
  if (error || !row) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500, headers: CORS });

  const path = `${claims.proj}/${row.id}`;
  const up = await admin.storage.from(BUCKET).upload(path, blob, { contentType: "application/json", upsert: true });
  if (up.error) {
    await admin.from("player_content").delete().eq("id", row.id);
    return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500, headers: CORS });
  }
  await admin.from("player_content").update({ storage_path: path }).eq("id", row.id);

  return NextResponse.json(
    { id: row.id, share_code: row.share_code, size_bytes: size },
    { status: 201, headers: CORS },
  );
}

// GET /api/player-content — list.
//   ?mine=true                        (player token) → own content, any status/visibility
//   ?visibility=public&content_type=&game_id=&share_code=&limit=&before=
//                                     (API key or player token) → public browse
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mine = url.searchParams.get("mine") === "true";
  const claims = playerFromRequest(request);

  let projectId: string;
  if (claims) {
    projectId = claims.proj;
  } else {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    projectId = auth.ctx.projectId;
  }

  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? 20)), 50);
  let q = admin
    .from("player_content")
    .select("id, owner_player_id, game_id, content_type, name, description, visibility, share_code, size_bytes, content_mime, created_at, updated_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (mine) {
    if (!claims) return NextResponse.json({ error: "player token required for mine=true" }, { status: 401, headers: CORS });
    q = q.eq("owner_player_id", claims.pid);
  } else {
    const shareCodeParam = url.searchParams.get("share_code");
    if (shareCodeParam) {
      q = q.eq("share_code", shareCodeParam.toUpperCase()).in("visibility", ["public", "unlisted"]).eq("status", "ready");
    } else {
      q = q.eq("visibility", "public").eq("status", "ready");
    }
    const ct = url.searchParams.get("content_type");
    if (ct) q = q.eq("content_type", ct);
    const game = url.searchParams.get("game_id");
    if (game) q = q.eq("game_id", game);
  }
  const before = url.searchParams.get("before");
  if (before) q = q.lt("created_at", before);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  return NextResponse.json({ content: data ?? [] }, { headers: CORS });
}

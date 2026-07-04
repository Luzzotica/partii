import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { rateLimit, tooManyRequests } from "@/lib/api/quota";
import { verifyPlayerToken } from "@/lib/api/playerToken";
import { playerHasRealIdentity } from "@/lib/api/identity/store";
import { checkContentQuota, shareCode } from "@/lib/api/contentQuota";

const admin = createAdminClient();
const BUCKET = "player-content";
const MAX_UPLOAD = 10 * 1024 * 1024; // bucket cap

export async function OPTIONS() {
  return corsPreflight();
}

// POST /api/player-content/upload-url — large/binary content (replays!).
// Auth: Bearer <player_token>.
// Body: { content_type, name, description?, game_id?, visibility?, size_bytes, content_mime }
// → { id, share_code, upload_url, token } — PUT the bytes to upload_url, then
// POST /api/player-content/{id}/finalize. Declared size counts against quota
// immediately (pending rows can't reserve unbounded space).
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const claims = verifyPlayerToken(auth.replace(/^bearer\s+/i, ""));
  if (!claims) return NextResponse.json({ error: "Invalid player token" }, { status: 401, headers: CORS });
  if (!rateLimit(`content:${claims.proj}`, 120, 60_000)) return tooManyRequests("content rate limit");

  let body: {
    content_type?: string; name?: string; description?: string; game_id?: string;
    visibility?: string; size_bytes?: number; content_mime?: string;
  };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }
  const contentType = (body.content_type ?? "").slice(0, 32);
  const name = (body.name ?? "").trim().slice(0, 100);
  const size = Math.round(Number(body.size_bytes ?? 0));
  if (!contentType || !name) {
    return NextResponse.json({ error: "content_type and name are required" }, { status: 400, headers: CORS });
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD) {
    return NextResponse.json({ error: `size_bytes must be 1..${MAX_UPLOAD}` }, { status: 400, headers: CORS });
  }

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

  const visibility = ["private", "unlisted", "public"].includes(body.visibility ?? "")
    ? (body.visibility as string) : "private";

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
      status: "pending",
      size_bytes: size, // declared; verified at finalize
      content_mime: (body.content_mime ?? "application/octet-stream").slice(0, 100),
      storage_path: "",
    })
    .select("id, share_code")
    .single();
  if (error || !row) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500, headers: CORS });

  const path = `${claims.proj}/${row.id}`;
  const signed = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signed.error) {
    await admin.from("player_content").delete().eq("id", row.id);
    return NextResponse.json({ error: `Failed to mint upload URL: ${signed.error.message}` }, { status: 500, headers: CORS });
  }
  await admin.from("player_content").update({ storage_path: path }).eq("id", row.id);

  return NextResponse.json(
    { id: row.id, share_code: row.share_code, upload_url: signed.data.signedUrl, token: signed.data.token },
    { status: 201, headers: CORS },
  );
}

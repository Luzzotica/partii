import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { verifyPlayerToken } from "@/lib/api/playerToken";

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

// GET /api/player-content/{id} — metadata + download.
// Owner (player token) sees own content in any state; others need it
// public/unlisted + ready, authenticated by API key (or a player token from
// the same project). `?inline=true` proxies small JSON directly.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const claims = playerFromRequest(request);
  let projectId: string | null = claims?.proj ?? null;
  if (!projectId) {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    projectId = auth.ctx.projectId;
  }

  const { data: row } = await admin
    .from("player_content")
    .select("*")
    .eq("id", id)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });

  const isOwner = claims?.pid === row.owner_player_id;
  const readable = isOwner || (row.status === "ready" && (row.visibility === "public" || row.visibility === "unlisted"));
  if (!readable) return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });

  const url = new URL(request.url);
  if (url.searchParams.get("inline") === "true" && row.content_mime === "application/json" && row.size_bytes <= INLINE_LIMIT) {
    const dl = await admin.storage.from(BUCKET).download(row.storage_path);
    if (dl.error) return NextResponse.json({ error: dl.error.message }, { status: 500, headers: CORS });
    const text = await dl.data.text();
    return NextResponse.json(
      { ...metaOf(row), data: JSON.parse(text) },
      { headers: CORS },
    );
  }

  const signed = await admin.storage.from(BUCKET).createSignedUrl(row.storage_path, 3600);
  if (signed.error) return NextResponse.json({ error: signed.error.message }, { status: 500, headers: CORS });
  return NextResponse.json(
    { ...metaOf(row), download_url: signed.data.signedUrl, download_expires_in: 3600 },
    { headers: CORS },
  );
}

function metaOf(row: Record<string, unknown>) {
  return {
    id: row.id,
    owner_player_id: row.owner_player_id,
    game_id: row.game_id,
    content_type: row.content_type,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    share_code: row.share_code,
    status: row.status,
    size_bytes: row.size_bytes,
    content_mime: row.content_mime,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// PATCH — owner updates metadata (name/description/visibility).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const claims = playerFromRequest(request);
  if (!claims) return NextResponse.json({ error: "Invalid player token" }, { status: 401, headers: CORS });

  let body: { name?: string; description?: string; visibility?: string };
  try { body = await request.json(); } catch { body = {}; }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = body.name.trim().slice(0, 100);
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400, headers: CORS });
    patch.name = name;
  }
  if (body.description !== undefined) patch.description = body.description.slice(0, 500) || null;
  if (body.visibility !== undefined) {
    if (!["private", "unlisted", "public"].includes(body.visibility)) {
      return NextResponse.json({ error: "invalid visibility" }, { status: 400, headers: CORS });
    }
    patch.visibility = body.visibility;
  }

  const { data, error } = await admin
    .from("player_content")
    .update(patch)
    .eq("id", id)
    .eq("project_id", claims.proj)
    .eq("owner_player_id", claims.pid)
    .select("id, name, description, visibility, share_code")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });
  return NextResponse.json({ content: data }, { headers: CORS });
}

// DELETE — owner removes content (storage object then row).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const claims = playerFromRequest(request);
  if (!claims) return NextResponse.json({ error: "Invalid player token" }, { status: 401, headers: CORS });

  const { data: row } = await admin
    .from("player_content")
    .select("id, storage_path")
    .eq("id", id)
    .eq("project_id", claims.proj)
    .eq("owner_player_id", claims.pid)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });

  if (row.storage_path) await admin.storage.from(BUCKET).remove([row.storage_path]);
  const { error } = await admin.from("player_content").delete().eq("id", row.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  return NextResponse.json({ deleted: true }, { headers: CORS });
}

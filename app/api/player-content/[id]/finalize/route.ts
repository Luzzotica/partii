import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { verifyPlayerToken } from "@/lib/api/playerToken";

const admin = createAdminClient();
const BUCKET = "player-content";

export async function OPTIONS() {
  return corsPreflight();
}

// POST /api/player-content/{id}/finalize — after PUTting bytes to the signed
// upload URL. Verifies the object landed and its REAL size is within the
// declared size (+small slack), then flips status to 'ready'.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = request.headers.get("authorization") ?? "";
  const claims = verifyPlayerToken(auth.replace(/^bearer\s+/i, ""));
  if (!claims) return NextResponse.json({ error: "Invalid player token" }, { status: 401, headers: CORS });

  const { data: row } = await admin
    .from("player_content")
    .select("id, storage_path, size_bytes, status")
    .eq("id", id)
    .eq("project_id", claims.proj)
    .eq("owner_player_id", claims.pid)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });
  if (row.status === "ready") return NextResponse.json({ finalized: true, already: true }, { headers: CORS });

  // Locate the object + its actual size.
  const dir = row.storage_path.split("/").slice(0, -1).join("/");
  const base = row.storage_path.split("/").pop()!;
  const { data: objects, error } = await admin.storage.from(BUCKET).list(dir, { search: base });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  const obj = (objects ?? []).find((o) => o.name === base);
  if (!obj) return NextResponse.json({ error: "upload_not_found — PUT the file to upload_url first" }, { status: 409, headers: CORS });

  const actual = Number((obj.metadata as { size?: number } | null)?.size ?? 0);
  // Enforce the declared budget (small slack for metadata variance).
  if (actual > row.size_bytes * 1.05 + 4096) {
    await admin.storage.from(BUCKET).remove([row.storage_path]);
    await admin.from("player_content").delete().eq("id", row.id);
    return NextResponse.json({ error: "uploaded object exceeds declared size — rejected" }, { status: 413, headers: CORS });
  }

  await admin
    .from("player_content")
    .update({ status: "ready", size_bytes: actual || row.size_bytes, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  return NextResponse.json({ finalized: true, size_bytes: actual || row.size_bytes }, { headers: CORS });
}

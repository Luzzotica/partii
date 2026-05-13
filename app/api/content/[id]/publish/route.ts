import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getApiUser } from "@/lib/supabase/apiAuth";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getApiUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  let body: { is_public?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  if (typeof body.is_public !== "boolean") {
    return NextResponse.json({ error: "is_public (boolean) is required" }, { status: 400, headers: CORS });
  }

  const admin = createAdminClient();
  const { data: row, error: fetchError } = await admin
    .from("game_content")
    .select("id,creator_id")
    .eq("id", id)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Content not found" }, { status: 404, headers: CORS });
  }

  if ((row as { creator_id: string }).creator_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
  }

  const { error: updateError } = await admin
    .from("game_content")
    .update({ is_public: body.is_public })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500, headers: CORS });
  }

  return NextResponse.json({ ok: true, is_public: body.is_public }, { headers: CORS });
}

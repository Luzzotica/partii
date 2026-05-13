import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getApiUser } from "@/lib/supabase/apiAuth";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type ContentRow = {
  id: string;
  game_id: string;
  creator_id: string;
  name: string;
  description: string | null;
  storage_path: string;
  is_public: boolean;
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getApiUser(request);

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("game_content")
    .select("id,game_id,creator_id,name,description,storage_path,is_public")
    .eq("id", id)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "Content not found" }, { status: 404, headers: CORS });
  }

  const contentRow = row as ContentRow;
  const canAccess =
    contentRow.is_public || (user?.id && contentRow.creator_id === user.id);

  if (!canAccess) {
    return NextResponse.json({ error: "Content not found" }, { status: 404, headers: CORS });
  }

  const { data: fileData, error: downloadError } = await admin.storage
    .from("game-content")
    .download(contentRow.storage_path);

  if (downloadError || !fileData) {
    return NextResponse.json(
      { error: "Failed to load content data" },
      { status: 500, headers: CORS },
    );
  }

  const text = await fileData.text();
  let contentJson: object;
  try {
    contentJson = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid content data" }, { status: 500, headers: CORS });
  }

  return NextResponse.json(contentJson, { headers: CORS });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getApiUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  const admin = createAdminClient();
  const { data: row, error: fetchError } = await admin
    .from("game_content")
    .select("id,creator_id,storage_path")
    .eq("id", id)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Content not found" }, { status: 404, headers: CORS });
  }

  if ((row as ContentRow).creator_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
  }

  let body: { name?: string; description?: string; contentJson?: object };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) {
    updates.name = String(body.name).trim().slice(0, 100);
  }
  if (body.description !== undefined) {
    updates.description = body.description
      ? String(body.description).trim().slice(0, 500)
      : null;
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await admin
      .from("game_content")
      .update(updates)
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500, headers: CORS });
    }
  }

  if (body.contentJson !== undefined && typeof body.contentJson === "object") {
    const jsonStr = JSON.stringify(body.contentJson);
    const { error: uploadError } = await admin.storage
      .from("game-content")
      .upload((row as ContentRow).storage_path, jsonStr, {
        contentType: "application/json",
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: "Failed to update content JSON" },
        { status: 500, headers: CORS },
      );
    }
  }

  return NextResponse.json({ ok: true }, { headers: CORS });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getApiUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  const admin = createAdminClient();
  const { data: row, error: fetchError } = await admin
    .from("game_content")
    .select("id,creator_id,storage_path")
    .eq("id", id)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Content not found" }, { status: 404, headers: CORS });
  }

  if ((row as ContentRow).creator_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: CORS });
  }

  await admin.storage.from("game-content").remove([(row as ContentRow).storage_path]);

  const { error: deleteError } = await admin
    .from("game_content")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500, headers: CORS });
  }

  return NextResponse.json({ ok: true }, { headers: CORS });
}

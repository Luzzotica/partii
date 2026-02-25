import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type MapRow = {
  id: string;
  creator_id: string;
  name: string;
  description: string | null;
  storage_path: string;
  is_public: boolean;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("gyrii_maps")
    .select("id,creator_id,name,description,storage_path,is_public")
    .eq("id", id)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  const mapRow = row as MapRow;
  const canAccess =
    mapRow.is_public || (user?.id && mapRow.creator_id === user.id);

  if (!canAccess) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  const { data: fileData, error: downloadError } = await admin.storage
    .from("gyrii-maps")
    .download(mapRow.storage_path);

  if (downloadError || !fileData) {
    return NextResponse.json(
      { error: "Failed to load map data" },
      { status: 500 },
    );
  }

  const text = await fileData.text();
  let mapJson: object;
  try {
    mapJson = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid map data" }, { status: 500 });
  }

  return NextResponse.json(mapJson);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: row, error: fetchError } = await admin
    .from("gyrii_maps")
    .select("id,creator_id,storage_path")
    .eq("id", id)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  const mapRow = row as MapRow;
  if (mapRow.creator_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { name?: string; description?: string; mapJson?: object };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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
      .from("gyrii_maps")
      .update(updates)
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  if (body.mapJson !== undefined && typeof body.mapJson === "object") {
    const jsonStr = JSON.stringify(body.mapJson);
    const { error: uploadError } = await admin.storage
      .from("gyrii-maps")
      .upload(mapRow.storage_path, jsonStr, {
        contentType: "application/json",
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: "Failed to update map JSON" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: row, error: fetchError } = await admin
    .from("gyrii_maps")
    .select("id,creator_id,storage_path")
    .eq("id", id)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  const mapRow = row as MapRow;
  if (mapRow.creator_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await admin.storage.from("gyrii-maps").remove([mapRow.storage_path]);

  const { error: deleteError } = await admin
    .from("gyrii_maps")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

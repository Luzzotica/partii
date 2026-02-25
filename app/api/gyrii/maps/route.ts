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
  created_at: string;
  updated_at: string;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("gyrii_maps")
    .select(
      "id,creator_id,name,description,storage_path,is_public,created_at,updated_at",
    )
    .or(`creator_id.eq.${user.id},is_public.eq.true`);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as MapRow[];
  return NextResponse.json({
    maps: rows.map((m) => ({
      id: m.id,
      creatorId: m.creator_id,
      name: m.name,
      description: m.description,
      isPublic: m.is_public,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    })),
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name: string; description?: string; mapJson: object };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!body.mapJson || typeof body.mapJson !== "object") {
    return NextResponse.json({ error: "mapJson is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const mapId = crypto.randomUUID();
  const storagePath = `maps/${mapId}.json`;

  const { error: insertError } = await admin.from("gyrii_maps").insert({
    id: mapId,
    creator_id: user.id,
    name: body.name.trim().slice(0, 100),
    description: body.description?.trim().slice(0, 500) ?? null,
    storage_path: storagePath,
  });

  if (insertError) {
    return NextResponse.json(
      { error: insertError.message ?? "Failed to create map" },
      { status: 500 },
    );
  }

  const jsonStr = JSON.stringify(body.mapJson);
  const { error: uploadError } = await admin.storage
    .from("gyrii-maps")
    .upload(storagePath, jsonStr, {
      contentType: "application/json",
      upsert: true,
    });

  if (uploadError) {
    await admin.from("gyrii_maps").delete().eq("id", mapId);
    return NextResponse.json(
      { error: "Failed to upload map JSON" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id: mapId,
    name: body.name.trim().slice(0, 100),
    description: body.description?.trim().slice(0, 500) ?? null,
    storagePath,
  });
}

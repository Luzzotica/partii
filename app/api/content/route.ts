import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getApiUser } from "@/lib/supabase/apiAuth";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type ContentRow = {
  id: string;
  game_id: string;
  content_type: string;
  creator_id: string;
  name: string;
  description: string | null;
  storage_path: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gameId = searchParams.get("game_id");
  const publicOnly = searchParams.get("public") === "true";

  const user = await getApiUser(request);

  // Allow unauthenticated access when requesting public content only
  if (!user && !publicOnly) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  const admin = createAdminClient();
  let query = admin
    .from("game_content")
    .select("id,game_id,content_type,creator_id,name,description,is_public,created_at,updated_at");

  if (publicOnly) {
    query = query.eq("is_public", true);
  } else {
    query = query.or(`creator_id.eq.${user!.id},is_public.eq.true`);
  }

  if (gameId) {
    query = query.eq("game_id", gameId);
  }

  const { data, error } = await query.order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }

  const rows = (data ?? []) as ContentRow[];
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      gameId: r.game_id,
      contentType: r.content_type,
      creatorId: r.creator_id,
      name: r.name,
      description: r.description,
      isPublic: r.is_public,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  }, { headers: CORS });
}

export async function POST(request: Request) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  let body: {
    game_id?: string;
    content_type?: string;
    name?: string;
    description?: string;
    contentJson?: object;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  if (!body.game_id || typeof body.game_id !== "string") {
    return NextResponse.json({ error: "game_id is required" }, { status: 400, headers: CORS });
  }
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400, headers: CORS });
  }
  if (!body.contentJson || typeof body.contentJson !== "object") {
    return NextResponse.json({ error: "contentJson is required" }, { status: 400, headers: CORS });
  }

  const admin = createAdminClient();
  const contentId = crypto.randomUUID();
  const gameId = body.game_id.trim().slice(0, 100);
  const storagePath = `${gameId}/${contentId}.json`;

  const { error: insertError } = await admin.from("game_content").insert({
    id: contentId,
    game_id: gameId,
    content_type: (body.content_type ?? "level").trim().slice(0, 50),
    creator_id: user.id,
    name: body.name.trim().slice(0, 100),
    description: body.description?.trim().slice(0, 500) ?? null,
    storage_path: storagePath,
  });

  if (insertError) {
    return NextResponse.json(
      { error: insertError.message ?? "Failed to create content" },
      { status: 500, headers: CORS },
    );
  }

  const jsonStr = JSON.stringify(body.contentJson);
  const { error: uploadError } = await admin.storage
    .from("game-content")
    .upload(storagePath, jsonStr, {
      contentType: "application/json",
      upsert: true,
    });

  if (uploadError) {
    await admin.from("game_content").delete().eq("id", contentId);
    return NextResponse.json(
      { error: "Failed to upload content JSON" },
      { status: 500, headers: CORS },
    );
  }

  return NextResponse.json({
    id: contentId,
    name: body.name.trim().slice(0, 100),
    description: body.description?.trim().slice(0, 500) ?? null,
    storagePath,
  }, { headers: CORS });
}

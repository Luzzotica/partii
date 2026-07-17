import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { rateLimit, tooManyRequests } from "@/lib/api/quota";
import { verifyPlayerToken } from "@/lib/api/playerToken";

const admin = createAdminClient();
const BUCKET = "task-screenshots";
// A viewport JPEG is a few hundred KB; the bucket caps objects at 5 MB.
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export async function OPTIONS() {
  return corsPreflight();
}

// POST /api/tasks/report — file a task into the project inbox from INSIDE the
// game (the ⌥D debug reporter). Admin players only: role='admin' on the
// players row, granted from the developer dashboard — a leaked build can't
// write into the task list.
// Auth: Bearer <player_token>.
// Body: { title, description?, context?, game_id?, screenshot? } where
// screenshot is a data URL (image/png or image/jpeg).
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const claims = verifyPlayerToken(auth.replace(/^bearer\s+/i, ""));
  if (!claims) return NextResponse.json({ error: "Invalid player token" }, { status: 401, headers: CORS });
  if (!rateLimit(`taskreport:${claims.pid}`, 10, 60_000)) return tooManyRequests("report rate limit");

  const { data: player } = await admin
    .from("players").select("id, banned, role").eq("id", claims.pid).eq("project_id", claims.proj).maybeSingle();
  if (!player || player.banned) {
    return NextResponse.json({ error: "Player not found or banned" }, { status: 403, headers: CORS });
  }
  if (player.role !== "admin") {
    return NextResponse.json({ error: "admin_required" }, { status: 403, headers: CORS });
  }

  let body: { title?: unknown; description?: unknown; context?: unknown; game_id?: unknown; screenshot?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }
  const title = (typeof body.title === "string" ? body.title : "").trim().slice(0, 200);
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400, headers: CORS });

  // Decode the screenshot up front so a bad payload fails before any insert.
  let screenshot: { bytes: Buffer; mime: string } | null = null;
  if (typeof body.screenshot === "string" && body.screenshot) {
    const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(body.screenshot);
    if (!m) return NextResponse.json({ error: "screenshot must be a png/jpeg data URL" }, { status: 400, headers: CORS });
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > MAX_SCREENSHOT_BYTES) {
      return NextResponse.json({ error: "screenshot exceeds 5MB" }, { status: 413, headers: CORS });
    }
    screenshot = { bytes, mime: m[1] };
  }

  const gameId = (typeof body.game_id === "string" ? body.game_id.slice(0, 64) : "") || null;
  const context = (typeof body.context === "string" ? body.context.slice(0, 120) : "") || null;
  const description = (typeof body.description === "string" ? body.description.slice(0, 5000) : "") || null;

  const { data: task, error } = await admin
    .from("tasks")
    .insert({
      project_id: claims.proj,
      title,
      description,
      context: context ?? gameId,
      source: "debug",
    })
    .select("id")
    .single();
  if (error || !task) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500, headers: CORS });

  if (screenshot) {
    const ext = screenshot.mime === "image/png" ? "png" : "jpg";
    const path = `${claims.proj}/${task.id}.${ext}`;
    const up = await admin.storage.from(BUCKET).upload(path, screenshot.bytes, {
      contentType: screenshot.mime,
      upsert: true,
    });
    if (!up.error) {
      await admin.from("tasks").update({ screenshot_path: path }).eq("id", task.id);
    }
    // Upload failure keeps the task (text is the valuable part) — just no image.
  }

  return NextResponse.json({ id: task.id }, { status: 201, headers: CORS });
}

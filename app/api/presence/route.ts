import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { corsHeaders as CORS, corsPreflight, requireApiKey } from "@/lib/api/auth";
import { verifyPlayerToken } from "@/lib/api/playerToken";
import { rateLimit, tooManyRequests } from "@/lib/api/quota";
import {
  presenceCountsForProject,
  type PresenceStatus,
} from "@/lib/api/presence";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

/**
 * GET /api/presence — live online counts for a project.
 *
 * Auth (either):
 *   - X-API-Key (game / host / dashboard tooling)
 *   - Authorization: Bearer <player_token>
 *
 * Query: ?game_id=hexii  (optional filter)
 */
export async function GET(request: Request) {
  const projectId = await resolveProjectId(request);
  if (!projectId.ok) return projectId.response;

  if (!rateLimit(`presence:get:${projectId.id}`, 120, 60_000)) {
    return tooManyRequests("presence rate limit");
  }

  const url = new URL(request.url);
  const gameId = url.searchParams.get("game_id");
  const counts = await presenceCountsForProject(admin, projectId.id, {
    gameId: gameId || undefined,
  });
  return NextResponse.json(counts, { headers: CORS });
}

/**
 * POST /api/presence — heartbeat: "I am online / in game".
 *
 * Auth: Authorization: Bearer <player_token>
 * Body: { game_id?: string, status?: "online" | "playing" }
 *
 * Response includes current project counts so clients need not poll separately.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const claims = verifyPlayerToken(auth.replace(/^bearer\s+/i, ""));
  if (!claims) {
    return NextResponse.json({ error: "Invalid player token" }, { status: 401, headers: CORS });
  }
  if (!rateLimit(`presence:hb:${claims.pid}`, 12, 60_000)) {
    return tooManyRequests("presence heartbeat rate limit");
  }

  let body: { game_id?: unknown; status?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const status: PresenceStatus =
    body.status === "playing" ? "playing" : "online";
  const gameId =
    typeof body.game_id === "string" ? body.game_id.trim().slice(0, 64) || null : null;

  const { data: player } = await admin
    .from("players")
    .select("id, banned")
    .eq("id", claims.pid)
    .eq("project_id", claims.proj)
    .maybeSingle();
  if (!player || player.banned) {
    return NextResponse.json(
      { error: "Player not found or banned" },
      { status: 403, headers: CORS },
    );
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("player_presence").upsert(
    {
      project_id: claims.proj,
      player_id: claims.pid,
      game_id: gameId,
      status,
      last_seen: now,
    },
    { onConflict: "project_id,player_id" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }

  // Touch player last_seen for the Players panel.
  await admin
    .from("players")
    .update({ last_seen_at: now })
    .eq("id", claims.pid)
    .eq("project_id", claims.proj);

  const counts = await presenceCountsForProject(admin, claims.proj, {
    gameId: gameId ?? undefined,
  });
  return NextResponse.json(
    { ok: true, status, game_id: gameId, ...counts },
    { headers: CORS },
  );
}

/**
 * DELETE /api/presence — go offline (leave / app backgrounded).
 * Auth: Bearer <player_token>
 */
export async function DELETE(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const claims = verifyPlayerToken(auth.replace(/^bearer\s+/i, ""));
  if (!claims) {
    return NextResponse.json({ error: "Invalid player token" }, { status: 401, headers: CORS });
  }

  await admin
    .from("player_presence")
    .delete()
    .eq("project_id", claims.proj)
    .eq("player_id", claims.pid);

  const counts = await presenceCountsForProject(admin, claims.proj);
  return NextResponse.json({ ok: true, ...counts }, { headers: CORS });
}

async function resolveProjectId(
  request: Request,
): Promise<{ ok: true; id: string } | { ok: false; response: NextResponse }> {
  // Prefer API key when present (host tooling).
  const keyHeader = request.headers.get("x-api-key");
  if (keyHeader) {
    const key = await requireApiKey(request);
    if (!key.ok) return { ok: false, response: key.response };
    return { ok: true, id: key.ctx.projectId };
  }

  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    // Could be player token or (less common) raw key as bearer — try player first.
    const claims = verifyPlayerToken(auth.slice(7));
    if (claims) return { ok: true, id: claims.proj };
    const key = await requireApiKey(request);
    if (key.ok) return { ok: true, id: key.ctx.projectId };
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: "X-API-Key or player Bearer token required" },
      { status: 401, headers: CORS },
    ),
  };
}

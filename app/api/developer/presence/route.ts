import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ownedProject } from "@/lib/api/ownedProject";
import { presenceCountsForProject, PRESENCE_STALE_MS } from "@/lib/api/presence";

const admin = createAdminClient();

// GET /api/developer/presence?project_id=&detail=1
// Counts (+ optional list of live players) for Studio.
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id") ?? "";
  if (!(await ownedProject(admin, auth.user.userId, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const counts = await presenceCountsForProject(admin, projectId);
  if (url.searchParams.get("detail") !== "1") {
    return NextResponse.json(counts);
  }

  const cutoff = new Date(Date.now() - PRESENCE_STALE_MS).toISOString();
  const { data: rows } = await admin
    .from("player_presence")
    .select("player_id, game_id, status, last_seen, players(display_name)")
    .eq("project_id", projectId)
    .gte("last_seen", cutoff)
    .order("last_seen", { ascending: false })
    .limit(100);

  type Row = {
    player_id: string;
    game_id: string | null;
    status: string;
    last_seen: string;
    players: { display_name: string | null } | null;
  };

  return NextResponse.json({
    ...counts,
    players: ((rows ?? []) as unknown as Row[]).map((r) => ({
      player_id: r.player_id,
      display_name: r.players?.display_name ?? null,
      game_id: r.game_id,
      status: r.status,
      last_seen: r.last_seen,
    })),
  });
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";

const admin = createAdminClient();

async function ownedProject(userId: string, projectId: string): Promise<boolean> {
  const { data } = await admin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

// GET /api/developer/players?project_id=&limit=&before= — the developer's view
// of THEIR project's players (dashboard only; never exposed to game clients).
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id") ?? "";
  if (!projectId || !(await ownedProject(auth.user.userId, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? 25)), 100);
  let q = admin
    .from("players")
    .select("id, display_name, banned, created_at, last_seen_at, player_identities(provider)")
    .eq("project_id", projectId)
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  const before = url.searchParams.get("before");
  if (before) q = q.lt("last_seen_at", before);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count } = await admin
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  return NextResponse.json({
    total: count ?? 0,
    players: (data ?? []).map((p) => ({
      id: p.id,
      display_name: p.display_name,
      banned: p.banned,
      created_at: p.created_at,
      last_seen_at: p.last_seen_at,
      providers: ((p.player_identities as { provider: string }[] | null) ?? []).map((i) => i.provider),
    })),
  });
}

// PATCH /api/developer/players — ban/unban a player (moderation).
export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { project_id?: string; player_id?: string; banned?: boolean };
  try { body = await request.json(); } catch { body = {}; }
  if (!body.project_id || !body.player_id || typeof body.banned !== "boolean") {
    return NextResponse.json({ error: "project_id, player_id, banned required" }, { status: 400 });
  }
  if (!(await ownedProject(auth.user.userId, body.project_id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await admin
    .from("players")
    .update({ banned: body.banned })
    .eq("id", body.player_id)
    .eq("project_id", body.project_id)
    .select("id, banned")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Player not found" }, { status: 404 });
  return NextResponse.json({ player: data });
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ownedProject as ownedProjectShared } from "@/lib/api/ownedProject";

const admin = createAdminClient();

const ownedProject = (userId: string, projectId: string) => ownedProjectShared(admin, userId, projectId);

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
    .select("id, display_name, banned, role, created_at, last_seen_at, player_identities(provider)")
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
      role: p.role,
      created_at: p.created_at,
      last_seen_at: p.last_seen_at,
      providers: ((p.player_identities as { provider: string }[] | null) ?? []).map((i) => i.provider),
    })),
  });
}

// PATCH /api/developer/players — moderation: ban/unban and/or set role.
// Anonymous-only players cannot be banned or promoted (no durable identity).
export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { project_id?: string; player_id?: string; banned?: boolean; role?: string };
  try { body = await request.json(); } catch { body = {}; }
  const patch: Record<string, unknown> = {};
  if (typeof body.banned === "boolean") patch.banned = body.banned;
  if (body.role !== undefined) {
    if (body.role !== "player" && body.role !== "admin") {
      return NextResponse.json({ error: "role must be player or admin" }, { status: 400 });
    }
    patch.role = body.role;
  }
  if (!body.project_id || !body.player_id || Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "project_id, player_id and banned and/or role required" }, { status: 400 });
  }
  if (!(await ownedProject(auth.user.userId, body.project_id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: identities } = await admin
    .from("player_identities")
    .select("provider")
    .eq("player_id", body.player_id);
  const providers = (identities ?? []).map((i) => i.provider as string);
  const isAnon =
    providers.length === 0 || providers.every((p) => p === "anon");
  if (isAnon) {
    return NextResponse.json(
      { error: "Anonymous players cannot be banned or made admin — they need a linked identity first" },
      { status: 400 },
    );
  }

  const { data, error } = await admin
    .from("players")
    .update(patch)
    .eq("id", body.player_id)
    .eq("project_id", body.project_id)
    .select("id, banned, role")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Player not found" }, { status: 404 });
  return NextResponse.json({ player: data });
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ownedProject } from "@/lib/api/ownedProject";

const admin = createAdminClient();

// GET /api/developer/feedback/summary?project_id=&days=30 — ratings analytics.
// In-route aggregation is fine at this volume; days capped at 90.
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id") ?? "";
  if (!(await ownedProject(admin, auth.user.userId, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const days = Math.min(Math.max(1, Number(url.searchParams.get("days") ?? 30)), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("feedback")
    .select("rating, game_id, created_at")
    .eq("project_id", projectId)
    .not("rating", "is", null)
    .gte("created_at", since)
    .limit(10000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as { rating: number; game_id: string | null; created_at: string }[];
  const byGame = new Map<string, { count: number; sum: number }>();
  const byDay = new Map<string, { count: number; sum: number }>();
  let sum = 0;
  for (const r of rows) {
    sum += r.rating;
    const g = r.game_id ?? "(none)";
    const gAgg = byGame.get(g) ?? { count: 0, sum: 0 };
    gAgg.count += 1; gAgg.sum += r.rating; byGame.set(g, gAgg);
    const d = r.created_at.slice(0, 10);
    const dAgg = byDay.get(d) ?? { count: 0, sum: 0 };
    dAgg.count += 1; dAgg.sum += r.rating; byDay.set(d, dAgg);
  }

  return NextResponse.json({
    days,
    total: rows.length,
    avg: rows.length ? sum / rows.length : null,
    byGame: [...byGame.entries()]
      .map(([game_id, a]) => ({ game_id, count: a.count, avg: a.sum / a.count }))
      .sort((a, b) => b.count - a.count),
    byDay: [...byDay.entries()]
      .map(([date, a]) => ({ date, count: a.count, avg: a.sum / a.count }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
  });
}

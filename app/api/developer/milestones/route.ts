import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ownedProject } from "@/lib/api/ownedProject";

const admin = createAdminClient();

const MILESTONE_FIELDS = "id, name, description, target_date, state, sort_order, created_at, updated_at";
const STATES = new Set(["active", "done", "archived"]);

// GET /api/developer/milestones?project_id= — all milestones + open/done task counts.
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id") ?? "";
  if (!(await ownedProject(admin, auth.user.userId, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await admin
    .from("milestones")
    .select(MILESTONE_FIELDS)
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // One grouped scan for the counts badge (open/done per milestone).
  const { data: taskRows } = await admin
    .from("tasks")
    .select("milestone_id, status")
    .eq("project_id", projectId)
    .not("milestone_id", "is", null);
  const counts = new Map<string, { open: number; done: number }>();
  for (const t of taskRows ?? []) {
    const c = counts.get(t.milestone_id as string) ?? { open: 0, done: 0 };
    if (t.status === "done") c.done += 1; else c.open += 1;
    counts.set(t.milestone_id as string, c);
  }

  return NextResponse.json({
    milestones: (data ?? []).map((m) => ({ ...m, ...(counts.get(m.id) ?? { open: 0, done: 0 }) })),
  });
}

// POST /api/developer/milestones — create.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { project_id?: string; name?: string; description?: string; target_date?: string; sort_order?: number };
  try { body = await request.json(); } catch { body = {}; }
  const name = (body.name ?? "").trim().slice(0, 120);
  if (!body.project_id || !name) {
    return NextResponse.json({ error: "project_id and name required" }, { status: 400 });
  }
  if (!(await ownedProject(admin, auth.user.userId, body.project_id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await admin
    .from("milestones")
    .insert({
      project_id: body.project_id,
      name,
      description: (body.description ?? "").slice(0, 2000) || null,
      target_date: body.target_date || null,
      sort_order: Number.isFinite(body.sort_order) ? Math.trunc(body.sort_order as number) : 0,
    })
    .select(MILESTONE_FIELDS)
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500 });
  return NextResponse.json({ milestone: { ...data, open: 0, done: 0 } }, { status: 201 });
}

// PATCH /api/developer/milestones — update name/description/target_date/state/sort_order.
export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    project_id?: string; id?: string; name?: string; description?: string | null;
    target_date?: string | null; state?: string; sort_order?: number;
  };
  try { body = await request.json(); } catch { body = {}; }
  if (!body.project_id || !body.id) {
    return NextResponse.json({ error: "project_id and id required" }, { status: 400 });
  }
  if (!(await ownedProject(admin, auth.user.userId, body.project_id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    patch.name = name;
  }
  if (body.description !== undefined) patch.description = body.description ? String(body.description).slice(0, 2000) : null;
  if (body.target_date !== undefined) patch.target_date = body.target_date || null;
  if (body.sort_order !== undefined && Number.isFinite(body.sort_order)) patch.sort_order = Math.trunc(body.sort_order as number);
  if (body.state !== undefined) {
    if (!STATES.has(body.state)) return NextResponse.json({ error: "invalid state" }, { status: 400 });
    patch.state = body.state;
  }

  const { data, error } = await admin
    .from("milestones")
    .update(patch)
    .eq("id", body.id)
    .eq("project_id", body.project_id)
    .select(MILESTONE_FIELDS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
  return NextResponse.json({ milestone: data });
}

// DELETE /api/developer/milestones?project_id=&id= — tasks fall back to the
// inbox (FK is ON DELETE SET NULL).
export async function DELETE(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!(await ownedProject(admin, auth.user.userId, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await admin.from("milestones").delete().eq("id", id).eq("project_id", projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

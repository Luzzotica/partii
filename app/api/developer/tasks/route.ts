import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ownedProject } from "@/lib/api/ownedProject";

const admin = createAdminClient();

const TASK_FIELDS = "id, milestone_id, title, description, context, status, source, feedback_id, screenshot_path, sort_order, done_at, created_at, updated_at";
const STATUSES = new Set(["open", "done"]);
const SCREENSHOT_BUCKET = "task-screenshots";

// GET /api/developer/tasks?project_id=&status=&milestone_id=
//   milestone_id=none → inbox (milestone_id IS NULL); omitted → all.
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id") ?? "";
  if (!(await ownedProject(admin, auth.user.userId, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let q = admin
    .from("tasks")
    .select(TASK_FIELDS)
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(500);
  const status = url.searchParams.get("status");
  if (status && STATUSES.has(status)) q = q.eq("status", status);
  const milestoneId = url.searchParams.get("milestone_id");
  if (milestoneId === "none") q = q.is("milestone_id", null);
  else if (milestoneId) q = q.eq("milestone_id", milestoneId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Debug-report screenshots live in a private bucket — hand the dashboard
  // short-lived signed URLs.
  const tasks = await Promise.all(
    (data ?? []).map(async (t) => {
      if (!t.screenshot_path) return { ...t, screenshot_url: null };
      const { data: signed } = await admin.storage
        .from(SCREENSHOT_BUCKET)
        .createSignedUrl(t.screenshot_path, 60 * 60);
      return { ...t, screenshot_url: signed?.signedUrl ?? null };
    }),
  );
  return NextResponse.json({ tasks });
}

// POST /api/developer/tasks — create (milestone_id omitted → inbox).
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { project_id?: string; title?: string; description?: string; context?: string; milestone_id?: string };
  try { body = await request.json(); } catch { body = {}; }
  const title = (body.title ?? "").trim().slice(0, 200);
  if (!body.project_id || !title) {
    return NextResponse.json({ error: "project_id and title required" }, { status: 400 });
  }
  if (!(await ownedProject(admin, auth.user.userId, body.project_id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await admin
    .from("tasks")
    .insert({
      project_id: body.project_id,
      milestone_id: body.milestone_id || null,
      title,
      description: (body.description ?? "").slice(0, 5000) || null,
      context: (body.context ?? "").slice(0, 120) || null,
    })
    .select(TASK_FIELDS)
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500 });
  return NextResponse.json({ task: data }, { status: 201 });
}

// PATCH /api/developer/tasks — update any of title/description/context/status/
// milestone_id/sort_order. status:'done' stamps done_at; reopening clears it.
export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    project_id?: string; id?: string; title?: string; description?: string | null;
    context?: string | null; status?: string; milestone_id?: string | null; sort_order?: number;
  };
  try { body = await request.json(); } catch { body = {}; }
  if (!body.project_id || !body.id) {
    return NextResponse.json({ error: "project_id and id required" }, { status: 400 });
  }
  if (!(await ownedProject(admin, auth.user.userId, body.project_id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.title !== undefined) {
    const title = String(body.title).trim().slice(0, 200);
    if (!title) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    patch.title = title;
  }
  if (body.description !== undefined) patch.description = body.description ? String(body.description).slice(0, 5000) : null;
  if (body.context !== undefined) patch.context = body.context ? String(body.context).slice(0, 120) : null;
  if (body.milestone_id !== undefined) patch.milestone_id = body.milestone_id || null;
  if (body.sort_order !== undefined && Number.isFinite(body.sort_order)) patch.sort_order = Math.trunc(body.sort_order as number);
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
    patch.status = body.status;
    patch.done_at = body.status === "done" ? new Date().toISOString() : null;
  }

  const { data, error } = await admin
    .from("tasks")
    .update(patch)
    .eq("id", body.id)
    .eq("project_id", body.project_id)
    .select(TASK_FIELDS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json({ task: data });
}

// DELETE /api/developer/tasks?project_id=&id=
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

  const { error } = await admin.from("tasks").delete().eq("id", id).eq("project_id", projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

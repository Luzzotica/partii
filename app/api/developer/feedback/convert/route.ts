import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ownedProject } from "@/lib/api/ownedProject";

const admin = createAdminClient();

// POST /api/developer/feedback/convert — the explicit feedback→task step.
// Body: { project_id, feedback_id, title?, milestone_id? }. Creates a task
// (source:'feedback', linked back) and stamps the feedback 'converted'.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { project_id?: string; feedback_id?: string; title?: string; milestone_id?: string };
  try { body = await request.json(); } catch { body = {}; }
  if (!body.project_id || !body.feedback_id) {
    return NextResponse.json({ error: "project_id and feedback_id required" }, { status: 400 });
  }
  if (!(await ownedProject(admin, auth.user.userId, body.project_id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: fb } = await admin
    .from("feedback")
    .select("id, text, context, status")
    .eq("id", body.feedback_id)
    .eq("project_id", body.project_id)
    .maybeSingle();
  if (!fb) return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
  if (fb.status === "converted") {
    return NextResponse.json({ error: "Already converted" }, { status: 409 });
  }

  const title = (body.title ?? "").trim().slice(0, 200) || (fb.text ?? "").trim().slice(0, 100) || "Player feedback";
  const { data: task, error } = await admin
    .from("tasks")
    .insert({
      project_id: body.project_id,
      milestone_id: body.milestone_id || null,
      title,
      description: fb.text || null,
      context: fb.context || null,
      source: "feedback",
      feedback_id: fb.id,
    })
    .select("id, milestone_id, title, description, context, status, source, feedback_id, sort_order, done_at, created_at, updated_at")
    .single();
  if (error || !task) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500 });

  await admin.from("feedback").update({ status: "converted" }).eq("id", fb.id);

  return NextResponse.json({ task }, { status: 201 });
}

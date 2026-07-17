import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ownedProject } from "@/lib/api/ownedProject";

const admin = createAdminClient();

const FEEDBACK_FIELDS = "id, game_id, player_id, rating, text, context, match_id, status, created_at, players(display_name)";
const STATUSES = new Set(["new", "triaged", "dismissed", "converted"]);
// Manual triage transitions only — 'converted' is set by /convert.
const PATCHABLE = new Set(["new", "triaged", "dismissed"]);

type FeedbackRow = {
  id: string; game_id: string | null; player_id: string | null; rating: number | null;
  text: string | null; context: string | null; match_id: string | null; status: string;
  created_at: string; players: { display_name: string | null } | null;
};

// GET /api/developer/feedback?project_id=&status=&has_text=true&limit=&before=
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id") ?? "";
  if (!(await ownedProject(admin, auth.user.userId, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? 50)), 200);
  let q = admin
    .from("feedback")
    .select(FEEDBACK_FIELDS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const status = url.searchParams.get("status");
  if (status && STATUSES.has(status)) q = q.eq("status", status);
  if (url.searchParams.get("has_text") === "true") q = q.not("text", "is", null);
  const before = url.searchParams.get("before");
  if (before) q = q.lt("created_at", before);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    feedback: ((data ?? []) as unknown as FeedbackRow[]).map((f) => ({
      ...f,
      players: undefined,
      player_name: f.players?.display_name ?? null,
    })),
  });
}

// PATCH /api/developer/feedback — triage: status new/triaged/dismissed.
export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { project_id?: string; id?: string; status?: string };
  try { body = await request.json(); } catch { body = {}; }
  if (!body.project_id || !body.id || !body.status || !PATCHABLE.has(body.status)) {
    return NextResponse.json({ error: "project_id, id, status (new|triaged|dismissed) required" }, { status: 400 });
  }
  if (!(await ownedProject(admin, auth.user.userId, body.project_id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await admin
    .from("feedback")
    .update({ status: body.status })
    .eq("id", body.id)
    .eq("project_id", body.project_id)
    .select("id, status")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
  return NextResponse.json({ feedback: data });
}

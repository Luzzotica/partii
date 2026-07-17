import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ownedProject } from "@/lib/api/ownedProject";
import { requireApiKey, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { rateLimit, tooManyRequests } from "@/lib/api/quota";

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

/**
 * Studio cookie OR project API key (X-API-Key / Bearer mpk_…).
 * Agents use the project key + project_id so they can triage without Studio login.
 * API key may only access its own project (project_id must match).
 */
async function authorizeProject(
  request: Request,
  projectId: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (!projectId) {
    return { ok: false, response: NextResponse.json({ error: "project_id required" }, { status: 400, headers: CORS }) };
  }

  const hasApiKeyHeader =
    !!request.headers.get("x-api-key") ||
    (() => {
      const auth = request.headers.get("authorization") ?? "";
      return auth.toLowerCase().startsWith("bearer mpk_");
    })();

  if (hasApiKeyHeader) {
    const keyAuth = await requireApiKey(request);
    if (!keyAuth.ok) return keyAuth;
    if (keyAuth.ctx.projectId !== projectId) {
      return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS }) };
    }
    if (!rateLimit(`dev-feedback:key:${keyAuth.ctx.apiKeyId}`, 60, 60_000)) {
      return { ok: false, response: tooManyRequests("feedback triage rate limit") };
    }
    return { ok: true };
  }

  const userAuth = await requireUser();
  if (!userAuth.ok) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS }) };
  }
  if (!(await ownedProject(admin, userAuth.user.userId, projectId))) {
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS }) };
  }
  return { ok: true };
}

export async function OPTIONS() {
  return corsPreflight();
}

// GET /api/developer/feedback?project_id=&status=&has_text=true&limit=&before=
// Auth: Studio session cookie OR X-API-Key (project key).
// Agent triage example:
//   curl -H "X-API-Key: $KEY" \
//     "https://www.sterlinglong.me/api/developer/feedback?project_id=$PROJECT_ID&status=new&has_text=true"
export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id") ?? "";
  const gate = await authorizeProject(request, projectId);
  if (!gate.ok) return gate.response;

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
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  return NextResponse.json(
    {
      feedback: ((data ?? []) as unknown as FeedbackRow[]).map((f) => ({
        ...f,
        players: undefined,
        player_name: f.players?.display_name ?? null,
      })),
    },
    { headers: CORS },
  );
}

// PATCH /api/developer/feedback — triage: status new/triaged/dismissed.
// Auth: Studio session cookie OR X-API-Key (project key).
export async function PATCH(request: Request) {
  let body: { project_id?: string; id?: string; status?: string };
  try { body = await request.json(); } catch { body = {}; }
  if (!body.project_id || !body.id || !body.status || !PATCHABLE.has(body.status)) {
    return NextResponse.json(
      { error: "project_id, id, status (new|triaged|dismissed) required" },
      { status: 400, headers: CORS },
    );
  }

  const gate = await authorizeProject(request, body.project_id);
  if (!gate.ok) return gate.response;

  const { data, error } = await admin
    .from("feedback")
    .update({ status: body.status })
    .eq("id", body.id)
    .eq("project_id", body.project_id)
    .select("id, status")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  if (!data) return NextResponse.json({ error: "Feedback not found" }, { status: 404, headers: CORS });
  return NextResponse.json({ feedback: data }, { headers: CORS });
}

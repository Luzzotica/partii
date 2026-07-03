import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { accountPlan } from "@/lib/billing/plans";
import { generateApiKey } from "@/lib/api/crypto";

const admin = createAdminClient();

async function userOwnsProject(userId: string, projectId: string): Promise<boolean> {
  const { data } = await admin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  if (!(await userOwnsProject(auth.user.userId, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await admin
    .from("api_keys")
    .select("id, key_prefix, name, created_at, last_used_at, revoked_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: string; projectId?: string };
  try { body = await request.json(); } catch { body = {}; }
  const projectId = body.projectId;
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  if (!(await userOwnsProject(auth.user.userId, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Free accounts get ONE active key per project; Pro is unlimited.
  const plan = await accountPlan(admin, auth.user.userId);
  if (plan !== "pro") {
    const { count } = await admin
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("revoked_at", null);
    if ((count ?? 0) >= 1) {
      return NextResponse.json(
        { error: "Free includes one active API key — revoke the existing key first, or upgrade to Pro ($5/mo) for unlimited keys.", upgrade: true },
        { status: 402 },
      );
    }
  }

  const name = (body.name ?? "").slice(0, 80) || "Untitled key";
  const { secret, hash, prefix } = generateApiKey();
  const { data, error } = await admin
    .from("api_keys")
    .insert({ project_id: projectId, key_prefix: prefix, key_hash: hash, name })
    .select("id, key_prefix, name, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500 });

  return NextResponse.json({ key: data, secret });
}

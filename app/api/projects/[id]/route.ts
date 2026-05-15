import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";

const admin = createAdminClient();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: { name?: string };
  try { body = await request.json(); } catch { body = {}; }
  const name = (body.name ?? "").trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const { data, error } = await admin
    .from("projects")
    .update({ name })
    .eq("id", id)
    .eq("user_id", auth.user.userId)
    .select("id, name, slug, created_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ project: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const { error, count } = await admin
    .from("projects")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", auth.user.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";

const admin = createAdminClient();

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "project";
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await admin
    .from("projects")
    .select("id, name, slug, created_at")
    .eq("user_id", auth.user.userId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ projects: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: string; slug?: string };
  try { body = await request.json(); } catch { body = {}; }
  const name = (body.name ?? "").trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const baseSlug = body.slug ? slugify(body.slug) : slugify(name);

  // Find a non-colliding slug under this user.
  let slug = baseSlug;
  for (let i = 2; i < 100; i++) {
    const { data: existing } = await admin
      .from("projects")
      .select("id")
      .eq("user_id", auth.user.userId)
      .eq("slug", slug)
      .maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${i}`;
  }

  const { data, error } = await admin
    .from("projects")
    .insert({ user_id: auth.user.userId, name, slug })
    .select("id, name, slug, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500 });
  return NextResponse.json({ project: data });
}

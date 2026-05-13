import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPassword, generateSessionToken } from "@/lib/api/crypto";
import { setDeveloperSessionCookie } from "@/lib/api/developerAuth";

const admin = createAdminClient();

export async function POST(request: Request) {
  let body: { email?: string; password?: string; display_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const displayName = (body.display_name ?? "").trim().slice(0, 80);

  if (!email.includes("@") || password.length < 8) {
    return NextResponse.json({ error: "Email required and password must be at least 8 characters" }, { status: 400 });
  }

  const { data: existing } = await admin.from("developers").select("id").eq("email", email).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const { data: dev, error } = await admin
    .from("developers")
    .insert({ email, password_hash: hashPassword(password), display_name: displayName })
    .select("id")
    .single();
  if (error || !dev) return NextResponse.json({ error: error?.message ?? "Failed to create account" }, { status: 500 });

  const { secret, hash } = generateSessionToken();
  await admin.from("developer_sessions").insert({ developer_id: dev.id, token_hash: hash });
  await setDeveloperSessionCookie(secret);

  return NextResponse.json({ ok: true, developer_id: dev.id });
}

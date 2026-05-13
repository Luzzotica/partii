import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPassword, generateSessionToken } from "@/lib/api/crypto";
import { setDeveloperSessionCookie } from "@/lib/api/developerAuth";

const admin = createAdminClient();

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const { data: dev } = await admin
    .from("developers")
    .select("id, password_hash")
    .eq("email", email)
    .maybeSingle();
  if (!dev || !verifyPassword(password, dev.password_hash)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const { secret, hash } = generateSessionToken();
  await admin.from("developer_sessions").insert({ developer_id: dev.id, token_hash: hash });
  await setDeveloperSessionCookie(secret);

  return NextResponse.json({ ok: true });
}

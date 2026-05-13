import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDeveloperFromCookie } from "@/lib/api/developerAuth";
import { generateApiKey } from "@/lib/api/crypto";

const admin = createAdminClient();

export async function GET() {
  const dev = await getDeveloperFromCookie();
  if (!dev) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await admin
    .from("api_keys")
    .select("id, key_prefix, name, created_at, last_used_at, revoked_at")
    .eq("developer_id", dev.developerId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(request: Request) {
  const dev = await getDeveloperFromCookie();
  if (!dev) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: string };
  try { body = await request.json(); } catch { body = {}; }
  const name = (body.name ?? "").slice(0, 80) || "Untitled key";

  const { secret, hash, prefix } = generateApiKey();
  const { data, error } = await admin
    .from("api_keys")
    .insert({ developer_id: dev.developerId, key_prefix: prefix, key_hash: hash, name })
    .select("id, key_prefix, name, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500 });

  // Secret is returned only here, never stored or returned again.
  return NextResponse.json({ key: data, secret });
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDeveloperFromCookie } from "@/lib/api/developerAuth";

const admin = createAdminClient();

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ keyId: string }> },
) {
  const dev = await getDeveloperFromCookie();
  if (!dev) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { keyId } = await params;

  const { error } = await admin
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("developer_id", dev.developerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

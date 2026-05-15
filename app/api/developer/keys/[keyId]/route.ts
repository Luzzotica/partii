import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";

const admin = createAdminClient();

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ keyId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { keyId } = await params;

  // Look up the key's project and verify the caller owns it.
  const { data: key } = await admin
    .from("api_keys")
    .select("id, project_id, projects!inner(user_id)")
    .eq("id", keyId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ownerId = (key as any)?.projects?.user_id as string | undefined;
  if (!key || ownerId !== auth.user.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await admin
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

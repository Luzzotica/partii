import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function isAdmin(userId: string): boolean {
  const adminIds = process.env.GYRII_ADMIN_USER_IDS;
  if (!adminIds) return false;
  return adminIds
    .split(",")
    .map((s) => s.trim())
    .includes(userId);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(user.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: row, error: fetchError } = await admin
    .from("gyrii_maps")
    .select("id")
    .eq("id", id)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  const { error: updateError } = await admin
    .from("gyrii_maps")
    .update({ is_public: true })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

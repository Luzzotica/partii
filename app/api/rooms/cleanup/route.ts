import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const admin = createAdminClient();

// GET /api/rooms/cleanup
// Called by Vercel cron every 5 minutes. Idempotent; safe to invoke manually
// from a browser when debugging. Wraps the cleanup_room_data() SQL function.
export async function GET() {
  const { error } = await admin.rpc("cleanup_room_data");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

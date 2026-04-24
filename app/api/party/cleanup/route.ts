import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const admin = createAdminClient();

// GET /api/party/cleanup
// Called by Vercel cron job every 5 minutes.
// Also available to call manually for testing.
export async function GET() {
  const { error } = await admin.rpc("cleanup_party_data");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// GET /api/players/providers — which sign-in methods this project supports,
// plus the connection info for hosted email accounts. Lets a game render the
// right login buttons and reach the auth host without hardcoding anything.
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { data: p } = await admin
    .from("projects")
    .select("steam_publisher_key_enc, steam_app_id, apple_bundle_id, google_web_client_id, discord_client_id, discord_client_secret_enc")
    .eq("id", auth.ctx.projectId)
    .maybeSingle();

  return NextResponse.json(
    {
      providers: {
        anon: true, // always — the zero-UI default
        email: {
          // Hosted accounts: sign up/in against Supabase Auth's REST API with
          // this public anon key, then trade the access_token at
          // POST /api/players/login { provider: "email", access_token }.
          auth_url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`,
          anon_key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        },
        steam: !!(p?.steam_publisher_key_enc && p?.steam_app_id) || !!process.env.STEAM_WEBAPI_PUBLISHER_KEY,
        gamecenter: !!p?.apple_bundle_id,
        apple: !!p?.apple_bundle_id,
        google: !!p?.google_web_client_id,
        discord: p?.discord_client_id && p?.discord_client_secret_enc
          ? { client_id: p.discord_client_id }
          : false,
      },
    },
    { headers: CORS },
  );
}

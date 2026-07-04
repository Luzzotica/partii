import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiKey, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { originAllowed } from "@/lib/api/origin";
import { verifyAttestation } from "@/lib/api/attest";
import { mintSessionToken } from "@/lib/api/token";
import { rateLimit, tooManyRequests } from "@/lib/api/quota";
import { openSecret } from "@/lib/api/secretBox";
import { verifyPlayerToken } from "@/lib/api/playerToken";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// POST /api/auth/token
// Exchange a raw API key (+ origin + platform attestation) for a short-lived
// session token. This is the ONLY place a raw API key is meant to be used; all
// signalling + TURN calls then carry the returned Bearer token instead.
//
// Body: { platform: "web"|"steam"|"dev"|"mobile", attestation?: string, steam_id?: string }
export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;

  // Burst cap per IP before the DB key lookup — blunts key-guessing / token
  // farming (60 exchanges/min/IP is ample for legitimate refreshes).
  if (!rateLimit(`token:${ip ?? "unknown"}`, 60, 60_000)) {
    return tooManyRequests("Too many token requests");
  }

  // 1. Resolve + validate the API key → { apiKeyId, projectId }.
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  let body: { platform?: string; attestation?: string; steam_id?: string; device_id?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const platform = (typeof body.platform === "string" ? body.platform : "web").slice(0, 16);
  const origin = request.headers.get("origin");

  // 2. Origin allowlist (browser clients only; native clients have no Origin).
  const { data: project } = await admin
    .from("projects")
    .select("allowed_origins, turnstile_secret_enc, steam_publisher_key_enc, steam_app_id")
    .eq("id", auth.ctx.projectId)
    .maybeSingle();
  const allowedOrigins: string[] = project?.allowed_origins ?? [];
  if (!originAllowed(origin, allowedOrigins)) {
    return NextResponse.json(
      { error: "Origin not allowed for this project" },
      { status: 403, headers: CORS },
    );
  }

  // 3a. Player-token attestation: a signed-in player's JWT is the strongest
  // proof we have (it was minted after provider verification) — accept it as
  // the attestation for platform 'player' and bind the session to the player.
  if (platform === "player") {
    const claims = verifyPlayerToken(body.attestation ?? "");
    if (!claims || claims.proj !== auth.ctx.projectId) {
      return NextResponse.json(
        { error: "Attestation failed: invalid player token" },
        { status: 403, headers: CORS },
      );
    }
    const { data: player } = await admin
      .from("players")
      .select("id, banned")
      .eq("id", claims.pid)
      .maybeSingle();
    if (!player || player.banned) {
      return NextResponse.json(
        { error: "Attestation failed: player not found or banned" },
        { status: 403, headers: CORS },
      );
    }
    const { token, expiresIn } = mintSessionToken({
      projectId: auth.ctx.projectId,
      apiKeyId: auth.ctx.apiKeyId,
      platform,
      playerId: `player:${claims.pid}`,
    });
    return NextResponse.json(
      { session_token: token, token_type: "Bearer", expires_in: expiresIn, player_id: `player:${claims.pid}` },
      { headers: CORS },
    );
  }

  // 3. Platform attestation (proves a genuine instance of one of our games).
  const attest = await verifyAttestation({
    platform,
    proof: body.attestation,
    origin,
    ip,
    steamId: body.steam_id,
    projectCreds: {
      turnstileSecret: openSecret(project?.turnstile_secret_enc),
      steamPublisherKey: openSecret(project?.steam_publisher_key_enc),
      steamAppId: project?.steam_app_id ?? null,
    },
  });
  if (!attest.ok) {
    return NextResponse.json(
      { error: `Attestation failed: ${attest.reason}` },
      { status: 403, headers: CORS },
    );
  }

  // 4. Resolve the player identity this session runs as. Attested platforms
  // (Steam) prove one; browsers get an anonymous device identity from a
  // client-persisted UUID — unverifiable, but Turnstile-gated and used only
  // for attribution (telemetry, TURN billing, quotas), never authorization.
  const deviceId = typeof body.device_id === "string"
    ? body.device_id.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, "")
    : "";
  const playerId = attest.playerId ?? (deviceId ? `anon:${deviceId}` : undefined);

  // 5. Mint the short-lived session token.
  const { token, expiresIn } = mintSessionToken({
    projectId: auth.ctx.projectId,
    apiKeyId: auth.ctx.apiKeyId,
    platform,
    playerId,
  });

  return NextResponse.json(
    {
      session_token: token,
      token_type: "Bearer",
      expires_in: expiresIn,
      ...(playerId ? { player_id: playerId } : {}),
    },
    { headers: CORS },
  );
}

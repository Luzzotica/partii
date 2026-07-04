import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, recordUsage, corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { rateLimit, tooManyRequests } from "@/lib/api/quota";
import { mintPlayerToken } from "@/lib/api/playerToken";
import { verifyProviderProof, type ProviderProof } from "@/lib/api/identity";
import {
  PROVIDER_CRED_COLUMNS,
  credsFromProjectRow,
  findPlayerByIdentity,
  createPlayerWithIdentity,
} from "@/lib/api/identity/store";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// POST /api/players/login
// Sign a PLAYER in (or up) via a provider proof and mint a player token.
//
// Body: { provider: "anon"|"steam"|"gamecenter"|"apple"|"google"|"discord"|"dev",
//         create?: boolean (default true), display_name?, ...provider proof fields }
// → { player_token, expires_in, player_id, display_name, created }
//
// Anonymous is the zero-config path: { provider:"anon", device_id:"<uuid>" }
// gives every install a persistent player with NO login UI — content saving
// works out of the box; a real provider can be LINKED later (/api/players/link)
// to make the account recoverable across devices.
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (!rateLimit(`player-login:${auth.ctx.projectId}`, 120, 60_000)) {
    return tooManyRequests("player login rate limit");
  }

  let body: ProviderProof & { provider?: string; create?: boolean; display_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }
  const provider = (body.provider ?? "").slice(0, 16);
  if (!provider) return NextResponse.json({ error: "provider required" }, { status: 400, headers: CORS });

  const { data: project } = await admin
    .from("projects")
    .select(`id, ${PROVIDER_CRED_COLUMNS}`)
    .eq("id", auth.ctx.projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404, headers: CORS });

  const verified = await verifyProviderProof(provider, body, credsFromProjectRow(project));
  if (!verified.ok) {
    return NextResponse.json({ error: `Login rejected: ${verified.reason}` }, { status: 403, headers: CORS });
  }

  let player = await findPlayerByIdentity(admin, auth.ctx.projectId, provider, verified.subject);
  let created = false;
  if (!player) {
    if (body.create === false) {
      return NextResponse.json({ error: "player_not_found" }, { status: 404, headers: CORS });
    }
    const displayName = (body.display_name ?? verified.displayName ?? "").slice(0, 60) || undefined;
    player = await createPlayerWithIdentity(admin, auth.ctx.projectId, provider, verified.subject, displayName);
    created = true;
    if (!player) {
      return NextResponse.json({ error: "Failed to create player" }, { status: 500, headers: CORS });
    }
  }

  if (player.banned) {
    return NextResponse.json({ error: "player_banned" }, { status: 403, headers: CORS });
  }

  void admin.from("players").update({ last_seen_at: new Date().toISOString() }).eq("id", player.id);
  recordUsage(auth.ctx.apiKeyId, "player.login", {});

  const { token, expiresIn } = mintPlayerToken(player.id, auth.ctx.projectId);
  return NextResponse.json(
    {
      player_token: token,
      token_type: "Bearer",
      expires_in: expiresIn,
      player_id: player.id,
      display_name: player.display_name,
      created,
    },
    { headers: CORS },
  );
}

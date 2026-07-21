import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { rateLimit, tooManyRequests } from "@/lib/api/quota";
import { SUPPORTED_GAMES, type BalanceChannel, type ConfigResponse } from "@/lib/games/balance/types";
import { loadFlags, resolveActiveDoc } from "@/lib/games/balance/store";
import { DEFAULT_BALANCE, DEFAULT_BALANCE_SHA256 } from "@/lib/games/balance/defaults";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// GET /api/games/:gameId/config — public flags + active balance pointer.
// Auth: none. Clients fall back to embedded defaults on failure.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId: rawId } = await params;
  const gameId = (rawId ?? "").trim().toLowerCase();
  if (!SUPPORTED_GAMES.has(gameId)) {
    return NextResponse.json({ error: "Unknown game" }, { status: 404, headers: CORS });
  }
  if (!rateLimit(`game-config:${gameId}`, 120, 60_000)) {
    return tooManyRequests("config rate limit");
  }

  try {
    const { flags } = await loadFlags(admin, gameId);
    const channel = flags.balance_channel_default as BalanceChannel;
    const resolved = await resolveActiveDoc(admin, gameId, channel);

    let active_id = DEFAULT_BALANCE.id;
    let semver = DEFAULT_BALANCE.semver;
    let sha256 = DEFAULT_BALANCE_SHA256;
    let updated_at = DEFAULT_BALANCE.generated_at ?? new Date(0).toISOString();

    if (resolved.source === "db") {
      active_id = resolved.row.id;
      semver = resolved.row.semver;
      sha256 = resolved.row.sha256;
      updated_at = resolved.channelUpdatedAt;
    } else if (resolved.source === "embedded") {
      active_id = resolved.doc.id;
      semver = resolved.doc.semver;
      sha256 = resolved.sha256;
      updated_at = resolved.channelUpdatedAt;
    }

    const body: ConfigResponse = {
      game_id: gameId,
      flags,
      balance: {
        channel,
        active_id,
        semver,
        sha256,
        url: `/api/games/${gameId}/balance?channel=${channel}`,
        updated_at,
      },
      min_client_semver: null,
    };

    return NextResponse.json(body, {
      headers: {
        ...CORS,
        "Cache-Control": "public, max-age=60",
        ETag: `"${sha256}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "storage failure";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS });
  }
}

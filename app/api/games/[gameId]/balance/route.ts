import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { corsHeaders as CORS, corsPreflight } from "@/lib/api/auth";
import { rateLimit, tooManyRequests } from "@/lib/api/quota";
import { SUPPORTED_GAMES } from "@/lib/games/balance/types";
import { parseChannel } from "@/lib/games/balance/validate";
import {
  loadDocById,
  resolveActiveDoc,
} from "@/lib/games/balance/store";
import { DEFAULT_BALANCE, DEFAULT_BALANCE_SHA256 } from "@/lib/games/balance/defaults";
import { contentSha256 } from "@/lib/games/balance/canonical";

const admin = createAdminClient();

export async function OPTIONS() {
  return corsPreflight();
}

// GET /api/games/:gameId/balance?channel=&id=
// Public read of the balance JSON document (schema tankii.balance/v1).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId: rawId } = await params;
  const gameId = (rawId ?? "").trim().toLowerCase();
  if (!SUPPORTED_GAMES.has(gameId)) {
    return NextResponse.json({ error: "Unknown game" }, { status: 404, headers: CORS });
  }
  if (!rateLimit(`game-balance:${gameId}`, 120, 60_000)) {
    return tooManyRequests("balance rate limit");
  }

  const url = new URL(request.url);
  const channel = parseChannel(url.searchParams.get("channel"));
  if (!channel) {
    return NextResponse.json({ error: "channel must be stable|beta|dev" }, { status: 400, headers: CORS });
  }
  const idParam = (url.searchParams.get("id") ?? "").trim();

  try {
    if (idParam) {
      const row = await loadDocById(admin, gameId, idParam);
      if (!row) {
        // Embedded default fallback when DB empty.
        if (gameId === "tankii" && idParam === DEFAULT_BALANCE.id) {
          return docResponse(DEFAULT_BALANCE, DEFAULT_BALANCE_SHA256);
        }
        return NextResponse.json({ error: "Unknown balance id" }, { status: 404, headers: CORS });
      }
      if (row.retired_at) {
        return NextResponse.json({ error: "Balance id retired" }, { status: 410, headers: CORS });
      }
      return docResponse(row.body, row.sha256 || contentSha256(row.body));
    }

    const resolved = await resolveActiveDoc(admin, gameId, channel);
    if (resolved.source === "db") {
      return docResponse(resolved.row.body, resolved.row.sha256 || contentSha256(resolved.row.body));
    }
    if (resolved.source === "embedded") {
      return docResponse(resolved.doc, resolved.sha256);
    }
    if (resolved.source === "retired") {
      return NextResponse.json({ error: "Balance id retired" }, { status: 410, headers: CORS });
    }
    return NextResponse.json({ error: "No active balance for channel" }, { status: 404, headers: CORS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "storage failure";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS });
  }
}

function docResponse(body: unknown, sha256: string) {
  const id =
    body && typeof body === "object" && "id" in body && typeof (body as { id: unknown }).id === "string"
      ? (body as { id: string }).id
      : "";
  return NextResponse.json(body, {
    headers: {
      ...CORS,
      "Cache-Control": "public, max-age=60",
      ETag: `"${sha256}"`,
      "X-Balance-Id": id,
      "X-Balance-Sha256": sha256,
    },
  });
}

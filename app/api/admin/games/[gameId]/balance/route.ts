import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { SUPPORTED_GAMES, type BalanceChannel } from "@/lib/games/balance/types";
import { parseChannel, validateBalanceDocument } from "@/lib/games/balance/validate";
import { upsertBalanceDoc } from "@/lib/games/balance/store";

const adminDb = createAdminClient();

function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function authorizeAdmin(): Promise<{ ok: true } | { ok: false; status: 401 | 403 }> {
  const expected = process.env.ADMIN_API_TOKEN;
  if (expected) {
    const h = await headers();
    const auth = h.get("authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m && tokensEqual(m[1], expected)) {
      return { ok: true };
    }
  }
  const result = await requireAdmin();
  if (!result.ok) return { ok: false, status: result.status };
  return { ok: true };
}

// PUT /api/admin/games/:gameId/balance
// Auth: Bearer ADMIN_API_TOKEN or Studio admin cookie.
// Body: { channel?, promote?, document } — promote must be true to flip active_id.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const gate = await authorizeAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status },
    );
  }

  const { gameId: rawId } = await params;
  const gameId = (rawId ?? "").trim().toLowerCase();
  if (!SUPPORTED_GAMES.has(gameId)) {
    return NextResponse.json({ error: "Unknown game" }, { status: 404 });
  }

  let body: { channel?: string; promote?: boolean; document?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const channel = parseChannel(body.channel ?? "stable");
  if (!channel) {
    return NextResponse.json({ error: "channel must be stable|beta|dev" }, { status: 400 });
  }
  if (body.document === undefined) {
    return NextResponse.json({ error: "document required" }, { status: 400 });
  }

  const validated = validateBalanceDocument(body.document);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const result = await upsertBalanceDoc(adminDb, {
      gameId,
      channel: channel as BalanceChannel,
      doc: validated.doc,
      promote: body.promote === true,
    });
    return NextResponse.json(
      {
        id: result.id,
        sha256: result.sha256,
        channel: result.channel,
        promoted: result.promoted,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to store balance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

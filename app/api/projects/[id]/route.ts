import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { sealSecret } from "@/lib/api/secretBox";

const admin = createAdminClient();

/** Validate a browser Origin (scheme://host[:port]); allows one leading
 *  wildcard label like https://*.example.com. */
function validOrigin(o: string): boolean {
  return /^https?:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?$/i.test(o);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: {
    name?: string;
    allowed_origins?: string[];
    require_session_tokens?: boolean;
    // BYO attestation secrets: non-empty string = set (encrypted at rest),
    // empty string = clear, absent = leave unchanged. Never read back.
    turnstile_secret?: string;
    steam_publisher_key?: string;
    steam_app_id?: string;
  };
  try { body = await request.json(); } catch { body = {}; }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = body.name.trim().slice(0, 80);
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    patch.name = name;
  }
  if (body.allowed_origins !== undefined) {
    if (!Array.isArray(body.allowed_origins) || body.allowed_origins.length > 20) {
      return NextResponse.json({ error: "allowed_origins must be an array (max 20)" }, { status: 400 });
    }
    const origins = body.allowed_origins.map((o) => String(o).trim()).filter(Boolean);
    const bad = origins.find((o) => !validOrigin(o));
    if (bad) return NextResponse.json({ error: `Invalid origin: ${bad}` }, { status: 400 });
    patch.allowed_origins = origins;
  }
  if (body.require_session_tokens !== undefined) {
    patch.require_session_tokens = body.require_session_tokens === true;
  }
  if (body.turnstile_secret !== undefined) {
    patch.turnstile_secret_enc = body.turnstile_secret ? sealSecret(body.turnstile_secret.slice(0, 256)) : null;
  }
  if (body.steam_publisher_key !== undefined) {
    patch.steam_publisher_key_enc = body.steam_publisher_key
      ? sealSecret(body.steam_publisher_key.slice(0, 256))
      : null;
  }
  if (body.steam_app_id !== undefined) {
    const appId = body.steam_app_id.trim();
    if (appId && !/^\d{1,12}$/.test(appId)) {
      return NextResponse.json({ error: "steam_app_id must be numeric" }, { status: 400 });
    }
    patch.steam_app_id = appId || null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No recognized fields to update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("projects")
    .update(patch)
    .eq("id", id)
    .eq("user_id", auth.user.userId)
    .select(
      "id, name, slug, created_at, allowed_origins, require_session_tokens, steam_app_id, plan, relay_included_gb, turnstile_secret_enc, steam_publisher_key_enc",
    )
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Secrets never leave the server — report configured-or-not only.
  const { turnstile_secret_enc, steam_publisher_key_enc, ...rest } = data;
  return NextResponse.json({
    project: {
      ...rest,
      turnstile_configured: !!turnstile_secret_enc,
      steam_configured: !!steam_publisher_key_enc,
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const { error, count } = await admin
    .from("projects")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", auth.user.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

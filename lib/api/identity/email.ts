import { createAdminClient } from "@/lib/supabase/admin";
import type { ProviderResult } from "./index";

// ─────────────────────────────────────────────────────────────────────────────
// Email accounts — hosted on the platform's Supabase Auth.
//
// Games sign players up/in through Supabase's REST auth endpoints (email +
// password, magic links, resets — Supabase does the hard parts: hashing,
// verification mail, rate limits) using the PUBLIC anon key from
// GET /api/players/providers. The resulting access token is the proof here;
// we verify it server-side and use the auth user id as the identity subject.
//
// Scoping still holds: the same email account logging into two different
// projects' games becomes two separate players (subject is per-project-unique
// on player_identities). The auth.users pool is shared with developer/member
// accounts — a player signup grants nothing beyond auth (no projects, no
// enrollments); the auto-created profiles row is inert.
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyEmailToken(accessToken: string | undefined): Promise<ProviderResult> {
  if (!accessToken) return { ok: false, reason: "access_token required" };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.getUser(accessToken);
    if (error || !data.user) {
      return { ok: false, reason: `Supabase auth rejected the token: ${error?.message ?? "no user"}` };
    }
    const u = data.user;
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      (u.email ? u.email.split("@")[0] : undefined);
    return { ok: true, subject: u.id, displayName: displayName || undefined };
  } catch (err) {
    return { ok: false, reason: `email verify error: ${(err as Error).message}` };
  }
}

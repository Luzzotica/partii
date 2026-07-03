import type { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Free-tier relay cap.
//
// Relay (TURN) bandwidth is the platform's only real marginal cost. Free
// projects get relay_included_gb per calendar month; beyond it we simply stop
// minting TURN credentials — direct peer-to-peer (STUN) keeps working, so most
// players are unaffected; only relay-requiring pairs wait for next month or an
// upgrade. Pro projects are never capped (overage is metered).
// ─────────────────────────────────────────────────────────────────────────────

export type RelayCapResult = { capped: boolean; usedGb: number; includedGb: number };

export async function relayCapStatus(
  admin: SupabaseClient,
  project: { id: string; plan: string | null; relay_included_gb: number | null },
): Promise<RelayCapResult> {
  const includedGb = project.relay_included_gb ?? 5;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { data: keys } = await admin.from("api_keys").select("id").eq("project_id", project.id);
  const keyIds = (keys ?? []).map((k) => k.id);
  if (keyIds.length === 0) return { capped: false, usedGb: 0, includedGb };

  const { data } = await admin
    .from("turn_usage")
    .select("bytes_sent, bytes_received")
    .in("api_key_id", keyIds)
    .gte("ended_at", monthStart.toISOString());
  const bytes = (data ?? []).reduce((acc, r) => acc + (r.bytes_sent ?? 0) + (r.bytes_received ?? 0), 0);
  const usedGb = bytes / 1e9;
  // Only the free tier is capped — pro overage is metered, never withheld.
  const capped = (project.plan ?? "free") === "free" && usedGb >= includedGb;
  return { capped, usedGb, includedGb };
}

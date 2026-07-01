import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { corsHeaders as CORS } from "./auth";

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting + per-project quotas
//
// You can't stop a leaked key from being used, so the goal is to BOUND the
// damage: cap how fast/much any project can consume resources, and return 429
// when it blows past its limits. Two layers:
//
//   1. rateLimit() — best-effort in-memory burst limiter (per warm instance).
//      On Vercel serverless this resets on cold start and isn't shared across
//      instances, so it's a coarse first line, not a hard guarantee. For a hard
//      cross-instance limit, back this with Upstash Redis (UPSTASH_REDIS_REST_*)
//      — drop-in swap behind the same function.
//
//   2. enforceRoomCreateQuota() — authoritative DB-backed caps (rolling-hour
//      room creates + concurrent rooms) from the project's limit columns. Run
//      on room creation, which is low-frequency, so the extra queries are cheap.
//
// Counts are keyed by the calling api_key_id. For a single-key project that's
// identical to per-project; multi-key projects effectively get the limit per
// key, which is still a fine damage cap.
// ─────────────────────────────────────────────────────────────────────────────

type Window = { count: number; resetAt: number };
const buckets = new Map<string, Window>();

/**
 * Fixed-window in-memory limiter. Returns true if the call is allowed.
 * @param key     limiter key, e.g. `token:<ip>` or `signal:<projectId>`
 * @param max     max calls per window
 * @param windowMs window length in ms
 */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    // Opportunistic GC so the map can't grow unbounded across many keys.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    return true;
  }
  if (w.count >= max) return false;
  w.count += 1;
  return true;
}

export function tooManyRequests(reason: string): NextResponse {
  return NextResponse.json({ error: reason }, { status: 429, headers: CORS });
}

export type ProjectLimits = {
  max_rooms_per_hour: number;
  max_concurrent_rooms: number;
  max_signals_per_min: number;
};

/**
 * Authoritative room-creation quota check. Returns null when within quota, or a
 * 429 NextResponse to short-circuit the handler when exceeded.
 */
export async function enforceRoomCreateQuota(
  admin: SupabaseClient,
  projectId: string,
  apiKeyId: string,
): Promise<NextResponse | null> {
  const { data: project } = await admin
    .from("projects")
    .select("max_rooms_per_hour, max_concurrent_rooms")
    .eq("id", projectId)
    .maybeSingle<Pick<ProjectLimits, "max_rooms_per_hour" | "max_concurrent_rooms">>();
  if (!project) return null; // project gone — auth layer already vouched for it.

  const { max_rooms_per_hour: perHour, max_concurrent_rooms: concurrent } = project;

  if (concurrent > 0) {
    const { count } = await admin
      .from("rooms")
      .select("id", { count: "exact", head: true })
      .eq("api_key_id", apiKeyId)
      .neq("status", "ended");
    if ((count ?? 0) >= concurrent) {
      return tooManyRequests(`Concurrent room limit reached (${concurrent})`);
    }
  }

  if (perHour > 0) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("rooms")
      .select("id", { count: "exact", head: true })
      .eq("api_key_id", apiKeyId)
      .gte("created_at", since);
    if ((count ?? 0) >= perHour) {
      return tooManyRequests(`Hourly room-creation limit reached (${perHour}/h)`);
    }
  }

  return null;
}

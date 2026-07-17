import type { SupabaseClient } from "@supabase/supabase-js";

/** Heartbeats older than this are treated as offline. */
export const PRESENCE_STALE_MS = 90_000;
export const PRESENCE_STALE_SEC = 90;

export type PresenceStatus = "online" | "playing";

export type PresenceCounts = {
  online: number;
  playing: number;
  by_game: Record<string, { online: number; playing: number }>;
  stale_after_sec: number;
};

/** Drop stale rows (best-effort) then aggregate live counts for a project. */
export async function presenceCountsForProject(
  admin: SupabaseClient,
  projectId: string,
  opts?: { gameId?: string | null },
): Promise<PresenceCounts> {
  const cutoff = new Date(Date.now() - PRESENCE_STALE_MS).toISOString();

  // Lazy cleanup so we don't need a cron for correctness.
  await admin
    .from("player_presence")
    .delete()
    .eq("project_id", projectId)
    .lt("last_seen", cutoff);

  let q = admin
    .from("player_presence")
    .select("game_id, status")
    .eq("project_id", projectId)
    .gte("last_seen", cutoff);
  if (opts?.gameId) q = q.eq("game_id", opts.gameId);

  const { data } = await q;
  const rows = data ?? [];

  let online = 0;
  let playing = 0;
  const by_game: Record<string, { online: number; playing: number }> = {};

  for (const r of rows) {
    online += 1;
    if (r.status === "playing") playing += 1;
    const g = r.game_id || "_";
    by_game[g] ??= { online: 0, playing: 0 };
    by_game[g].online += 1;
    if (r.status === "playing") by_game[g].playing += 1;
  }

  return { online, playing, by_game, stale_after_sec: PRESENCE_STALE_SEC };
}

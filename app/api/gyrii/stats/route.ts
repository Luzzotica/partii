import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type LeaderboardRow = {
  user_id: string;
  match_id: string;
  kills: number;
  deaths: number;
  damage_dealt: number;
  damage_taken: number;
  assists: number;
  profiles:
    | { display_name: string | null }[]
    | { display_name: string | null }
    | null;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(searchParams.get("limit") || "25", 10), 1),
    100,
  );
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("gyrii_match_players")
    .select(
      "user_id,match_id,kills,deaths,damage_dealt,damage_taken,assists,profiles(display_name)",
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as LeaderboardRow[];
  const byUser = new Map<
    string,
    {
      display_name: string;
      kills: number;
      deaths: number;
      assists: number;
      damage_dealt: number;
      damage_taken: number;
      matches: Set<string>;
    }
  >();

  for (const row of rows) {
    const rawProfile = Array.isArray(row.profiles)
      ? row.profiles[0]
      : row.profiles;
    const displayName = rawProfile?.display_name || "Anonymous";
    const existing = byUser.get(row.user_id) ?? {
      display_name: displayName,
      kills: 0,
      deaths: 0,
      assists: 0,
      damage_dealt: 0,
      damage_taken: 0,
      matches: new Set<string>(),
    };
    existing.kills += row.kills ?? 0;
    existing.deaths += row.deaths ?? 0;
    existing.assists += row.assists ?? 0;
    existing.damage_dealt += row.damage_dealt ?? 0;
    existing.damage_taken += row.damage_taken ?? 0;
    if (row.match_id) {
      existing.matches.add(row.match_id);
    }
    byUser.set(row.user_id, existing);
  }

  const leaderboard = Array.from(byUser.entries())
    .map(([user_id, entry]) => ({
      user_id,
      display_name: entry.display_name,
      matches_played: entry.matches.size,
      kills: entry.kills,
      deaths: entry.deaths,
      assists: entry.assists,
      damage_dealt: entry.damage_dealt,
      damage_taken: entry.damage_taken,
      kdr: entry.deaths > 0 ? entry.kills / entry.deaths : entry.kills,
    }))
    .sort(
      (a, b) =>
        b.kills - a.kills ||
        a.deaths - b.deaths ||
        b.damage_dealt - a.damage_dealt,
    )
    .slice(0, limit)
    .map((entry, idx) => ({
      rank: idx + 1,
      ...entry,
    }));

  return NextResponse.json({
    players: leaderboard,
    total_ranked_players: byUser.size,
  });
}

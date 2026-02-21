import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type PersonalRow = {
  match_id: string;
  kills: number;
  deaths: number;
  assists: number;
  damage_dealt: number;
  damage_taken: number;
  placement: number | null;
  team: number | null;
  player_name: string;
};

type MatchRow = {
  id: string;
  map_id: string;
  game_mode: string;
  started_at_ms: number;
  ended_at_ms: number;
  winner_team: number | null;
  winning_player_identity: string | null;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("gyrii_match_players")
    .select(
      "match_id,kills,deaths,assists,damage_dealt,damage_taken,placement,team,player_name",
    )
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as PersonalRow[];
  const totals = rows.reduce(
    (acc, row) => {
      acc.kills += row.kills ?? 0;
      acc.deaths += row.deaths ?? 0;
      acc.assists += row.assists ?? 0;
      acc.damage_dealt += row.damage_dealt ?? 0;
      acc.damage_taken += row.damage_taken ?? 0;
      return acc;
    },
    { kills: 0, deaths: 0, assists: 0, damage_dealt: 0, damage_taken: 0 },
  );

  const uniqueMatchIds = Array.from(
    new Set(rows.map((r) => r.match_id).filter(Boolean)),
  );
  const recentMatchIds = uniqueMatchIds.slice(-10).reverse();
  let matchesById = new Map<string, MatchRow>();

  if (recentMatchIds.length > 0) {
    const { data: matchData } = await admin
      .from("gyrii_matches")
      .select(
        "id,map_id,game_mode,started_at_ms,ended_at_ms,winner_team,winning_player_identity",
      )
      .in("id", recentMatchIds);
    matchesById = new Map(
      (matchData as MatchRow[] | null | undefined)?.map((m) => [m.id, m]) ?? [],
    );
  }

  const recent_matches = rows
    .filter((r) => recentMatchIds.includes(r.match_id))
    .sort(
      (a, b) =>
        recentMatchIds.indexOf(a.match_id) - recentMatchIds.indexOf(b.match_id),
    )
    .map((row) => {
      const match = matchesById.get(row.match_id);
      return {
        match_id: row.match_id,
        map_id: match?.map_id ?? null,
        game_mode: match?.game_mode ?? null,
        started_at_ms: match?.started_at_ms ?? null,
        ended_at_ms: match?.ended_at_ms ?? null,
        winner_team: match?.winner_team ?? null,
        winning_player_identity: match?.winning_player_identity ?? null,
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
        damage_dealt: row.damage_dealt,
        damage_taken: row.damage_taken,
        placement: row.placement,
        team: row.team,
        player_name: row.player_name,
      };
    });

  return NextResponse.json({
    totals: {
      matches_played: uniqueMatchIds.length,
      ...totals,
      kdr: totals.deaths > 0 ? totals.kills / totals.deaths : totals.kills,
    },
    recent_matches,
  });
}

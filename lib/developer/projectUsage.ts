import type { SupabaseClient } from "@supabase/supabase-js";

export type UsageEventRow = { event_type: string; day: string; count: number };
export type TurnUsageRow = { day: string; gb: number; sessions: number };
export type HealthUsageRow = {
  day: string;
  connected: number;
  failures: number;
  recoveries: number;
  p95: number | null;
  relayPct: number;
  pushPct: number;
};

/** Load last-30d Lobbii usage scoped to one project's API keys. */
export async function loadProjectUsage(
  admin: SupabaseClient,
  projectId: string,
): Promise<{
  rows: UsageEventRow[];
  turnRows: TurnUsageRow[];
  healthRows: HealthUsageRow[];
}> {
  const { data: keys } = await admin
    .from("api_keys")
    .select("id")
    .eq("project_id", projectId);
  const keyIds = (keys ?? []).map((k) => k.id);
  if (keyIds.length === 0) {
    return { rows: [], turnRows: [], healthRows: [] };
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  let rows: UsageEventRow[] = [];
  {
    const { data } = await admin
      .from("usage_events")
      .select("event_type, created_at")
      .in("api_key_id", keyIds)
      .gte("created_at", since)
      .limit(10000);
    const acc: Record<string, number> = {};
    for (const r of data ?? []) {
      const day = r.created_at.slice(0, 10);
      const k = `${r.event_type}\t${day}`;
      acc[k] = (acc[k] ?? 0) + 1;
    }
    rows = Object.entries(acc)
      .map(([k, count]) => {
        const [event_type, day] = k.split("\t");
        return { event_type, day, count };
      })
      .sort((a, b) => b.day.localeCompare(a.day) || a.event_type.localeCompare(b.event_type));
  }

  let turnRows: TurnUsageRow[] = [];
  {
    const { data } = await admin
      .from("turn_usage")
      .select("ended_at, bytes_sent, bytes_received")
      .in("api_key_id", keyIds)
      .gte("ended_at", since)
      .limit(10000);
    const acc: Record<string, { bytes: number; sessions: number }> = {};
    for (const r of data ?? []) {
      const day = String(r.ended_at).slice(0, 10);
      acc[day] ??= { bytes: 0, sessions: 0 };
      acc[day].bytes += (r.bytes_sent ?? 0) + (r.bytes_received ?? 0);
      acc[day].sessions += 1;
    }
    turnRows = Object.entries(acc)
      .map(([day, v]) => ({ day, gb: v.bytes / 1e9, sessions: v.sessions }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }

  let healthRows: HealthUsageRow[] = [];
  {
    const { data } = await admin
      .from("connection_events")
      .select("created_at, outcome, connect_ms, candidate_type, signaling_path")
      .in("api_key_id", keyIds)
      .gte("created_at", since)
      .limit(10000);
    const byDay: Record<
      string,
      { c: number; f: number; r: number; ms: number[]; relay: number; push: number; total: number }
    > = {};
    for (const e of data ?? []) {
      const day = String(e.created_at).slice(0, 10);
      byDay[day] ??= { c: 0, f: 0, r: 0, ms: [], relay: 0, push: 0, total: 0 };
      const d = byDay[day];
      d.total += 1;
      if (e.outcome === "connected") {
        d.c += 1;
        if (typeof e.connect_ms === "number") d.ms.push(e.connect_ms);
        if (e.candidate_type === "relay") d.relay += 1;
        if (e.signaling_path === "push") d.push += 1;
      } else if (e.outcome === "recovered") d.r += 1;
      else d.f += 1;
    }
    healthRows = Object.entries(byDay)
      .map(([day, d]) => {
        const sorted = [...d.ms].sort((a, b) => a - b);
        const p95 = sorted.length
          ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
          : null;
        return {
          day,
          connected: d.c,
          failures: d.f,
          recoveries: d.r,
          p95,
          relayPct: d.c ? Math.round((100 * d.relay) / d.c) : 0,
          pushPct: d.c ? Math.round((100 * d.push) / d.c) : 0,
        };
      })
      .sort((a, b) => b.day.localeCompare(a.day));
  }

  return { rows, turnRows, healthRows };
}

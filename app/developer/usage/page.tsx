import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";

const admin = createAdminClient();

export default async function DeveloperUsagePage() {
  const auth = await requireUser();
  if (!auth.ok) return null;

  // All projects belonging to this user.
  const { data: projects } = await admin
    .from("projects")
    .select("id")
    .eq("user_id", auth.user.userId);
  const projectIds = (projects ?? []).map((p) => p.id);

  // All keys under those projects.
  let keyIds: string[] = [];
  if (projectIds.length > 0) {
    const { data: keys } = await admin
      .from("api_keys")
      .select("id")
      .in("project_id", projectIds);
    keyIds = (keys ?? []).map((k) => k.id);
  }

  let rows: { event_type: string; day: string; count: number }[] = [];
  if (keyIds.length > 0) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
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
      .sort((a, b) => (b.day.localeCompare(a.day) || a.event_type.localeCompare(b.event_type)));
  }

  // ── TURN relay bandwidth (per day, 30d) ──
  let turnRows: { day: string; gb: number; sessions: number }[] = [];
  if (keyIds.length > 0) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
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

  // ── Connection health (per day, 30d) ──
  let healthRows: {
    day: string; connected: number; failures: number; recoveries: number;
    p95: number | null; relayPct: number; pushPct: number;
  }[] = [];
  if (keyIds.length > 0) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await admin
      .from("connection_events")
      .select("created_at, outcome, connect_ms, candidate_type, signaling_path")
      .in("api_key_id", keyIds)
      .gte("created_at", since)
      .limit(10000);
    const byDay: Record<string, { c: number; f: number; r: number; ms: number[]; relay: number; push: number; total: number }> = {};
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
        const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Usage (last 30 days)</h1>
        <p className="text-white/60 text-sm mt-1">
          Account-wide Lobbii multiplayer telemetry across all Partii projects.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Connection health</h2>
        <p className="text-sm text-white/50">
          Reported by game clients on every Lobbii connection attempt — whether players are
          actually getting into matches.
        </p>
        <div className="rounded border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-left text-white/60">
              <tr>
                <th className="p-3">Day</th>
                <th className="p-3 text-right">Connected</th>
                <th className="p-3 text-right">Failures</th>
                <th className="p-3 text-right">Recoveries</th>
                <th className="p-3 text-right">p95 connect</th>
                <th className="p-3 text-right">Relay %</th>
                <th className="p-3 text-right">Push %</th>
              </tr>
            </thead>
            <tbody>
              {healthRows.length === 0 && (
                <tr><td className="p-3 text-white/40" colSpan={7}>No connection telemetry yet.</td></tr>
              )}
              {healthRows.map((r) => (
                <tr key={r.day} className="border-t border-white/5">
                  <td className="p-3 font-mono text-white/70">{r.day}</td>
                  <td className="p-3 text-right text-emerald-300/90">{r.connected}</td>
                  <td className="p-3 text-right text-red-300/90">{r.failures}</td>
                  <td className="p-3 text-right text-white/70">{r.recoveries}</td>
                  <td className="p-3 text-right font-mono text-white/70">{r.p95 != null ? `${r.p95}ms` : "—"}</td>
                  <td className="p-3 text-right text-white/70">{r.relayPct}%</td>
                  <td className="p-3 text-right text-white/70">{r.pushPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Lobbii relay bandwidth (TURN)</h2>
        <p className="text-sm text-white/50">
          Only connections that couldn&apos;t go direct use the relay — this is the metered
          component of Lobbii Pro.
        </p>
        <div className="rounded border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-left text-white/60">
              <tr>
                <th className="p-3">Day</th>
                <th className="p-3 text-right">Relayed sessions</th>
                <th className="p-3 text-right">GB</th>
              </tr>
            </thead>
            <tbody>
              {turnRows.length === 0 && (
                <tr><td className="p-3 text-white/40" colSpan={3}>No relay usage yet.</td></tr>
              )}
              {turnRows.map((r) => (
                <tr key={r.day} className="border-t border-white/5">
                  <td className="p-3 font-mono text-white/70">{r.day}</td>
                  <td className="p-3 text-right text-white/70">{r.sessions}</td>
                  <td className="p-3 text-right font-mono text-white/70">{r.gb.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
      <h2 className="text-lg font-semibold">API events</h2>
      <div className="rounded border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-white/60">
            <tr>
              <th className="p-3">Day</th>
              <th className="p-3">Event</th>
              <th className="p-3 text-right">Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={3} className="p-4 text-center text-white/40">No events recorded yet.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/5">
                <td className="p-3">{r.day}</td>
                <td className="p-3 font-mono text-xs">{r.event_type}</td>
                <td className="p-3 text-right">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </section>
    </div>
  );
}

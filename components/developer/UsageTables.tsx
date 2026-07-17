import type { HealthUsageRow, TurnUsageRow, UsageEventRow } from "@/lib/developer/projectUsage";

export function UsageTables({
  rows,
  turnRows,
  healthRows,
}: {
  rows: UsageEventRow[];
  turnRows: TurnUsageRow[];
  healthRows: HealthUsageRow[];
}) {
  return (
    <div className="space-y-8">
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
                <tr>
                  <td className="p-3 text-white/40" colSpan={7}>
                    No connection telemetry yet.
                  </td>
                </tr>
              )}
              {healthRows.map((r) => (
                <tr key={r.day} className="border-t border-white/5">
                  <td className="p-3 font-mono text-white/70">{r.day}</td>
                  <td className="p-3 text-right text-emerald-300/90">{r.connected}</td>
                  <td className="p-3 text-right text-red-300/90">{r.failures}</td>
                  <td className="p-3 text-right text-white/70">{r.recoveries}</td>
                  <td className="p-3 text-right font-mono text-white/70">
                    {r.p95 != null ? `${r.p95}ms` : "—"}
                  </td>
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
                <tr>
                  <td className="p-3 text-white/40" colSpan={3}>
                    No relay usage yet.
                  </td>
                </tr>
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
                <tr>
                  <td colSpan={3} className="p-4 text-center text-white/40">
                    No events recorded yet.
                  </td>
                </tr>
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

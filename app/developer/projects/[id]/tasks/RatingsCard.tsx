"use client";

import { useEffect, useState } from "react";

type Summary = {
  days: number;
  total: number;
  avg: number | null;
  byGame: { game_id: string; count: number; avg: number }[];
  byDay: { date: string; count: number; avg: number }[];
};

function Stars({ value }: { value: number }) {
  return (
    <span className="text-yellow-300/90" aria-label={`${value.toFixed(1)} stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= Math.round(value) ? "" : "opacity-25"}>★</span>
      ))}
    </span>
  );
}

// Player match ratings over the last 30 days — avg stars, volume, and a daily
// sparkline. Pure inline SVG, no chart library.
export function RatingsCard({ projectId }: { projectId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/developer/feedback/summary?project_id=${projectId}&days=30`);
      if (res.ok) setSummary(await res.json());
    })();
  }, [projectId]);

  if (!summary) return null;
  if (summary.total === 0) {
    return (
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-lg font-semibold">Ratings</h2>
        <p className="text-sm text-white/40 mt-1">
          No player ratings yet. They appear here when your game calls{" "}
          <code className="text-white/60">cloud.submitFeedback(&#123; rating &#125;)</code> after a match.
        </p>
      </section>
    );
  }

  // Fill the full window so gaps read as gaps.
  const dayMap = new Map(summary.byDay.map((d) => [d.date, d]));
  const days: { date: string; count: number; avg: number | null }[] = [];
  for (let i = summary.days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const d = dayMap.get(date);
    days.push({ date, count: d?.count ?? 0, avg: d?.avg ?? null });
  }
  const maxCount = Math.max(1, ...days.map((d) => d.count));
  const W = 300, H = 48, bw = W / days.length;

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Ratings</h2>
        <span className="text-sm text-white/50">last {summary.days} days</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div>
          <div className="text-2xl font-semibold flex items-center gap-2">
            {summary.avg?.toFixed(1)} <Stars value={summary.avg ?? 0} />
          </div>
          <div className="text-xs text-white/50">{summary.total} rating{summary.total === 1 ? "" : "s"}</div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-[300px] max-w-full" role="img" aria-label="Daily rating volume">
          {days.map((d, i) => (
            <rect
              key={d.date}
              x={i * bw + 1}
              y={H - (d.count / maxCount) * (H - 4)}
              width={Math.max(1, bw - 2)}
              height={(d.count / maxCount) * (H - 4)}
              rx={1}
              className={d.avg !== null && d.avg < 3 ? "fill-red-400/70" : "fill-[#5a67fa]/80"}
            >
              <title>{`${d.date}: ${d.count} rating${d.count === 1 ? "" : "s"}${d.avg !== null ? `, avg ${d.avg.toFixed(1)}` : ""}`}</title>
            </rect>
          ))}
        </svg>
        {summary.byGame.length > 1 && (
          <div className="text-xs text-white/60 space-y-0.5">
            {summary.byGame.slice(0, 4).map((g) => (
              <div key={g.game_id}>
                <span className="font-mono">{g.game_id}</span> — {g.avg.toFixed(1)}★ ({g.count})
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

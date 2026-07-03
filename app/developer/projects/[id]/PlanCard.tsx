"use client";

import { useState } from "react";

export type PlanInfo = {
  projectId: string;
  plan: string;
  relayIncludedGb: number;
  relayUsedGb: number;
  limits: { max_rooms_per_hour: number; max_concurrent_rooms: number; max_signals_per_min: number };
};

export function PlanCard({ info }: { info: PlanInfo }) {
  const [busy, setBusy] = useState(false);
  const pro = info.plan === "pro";
  const pct = Math.min(100, Math.round((info.relayUsedGb / Math.max(info.relayIncludedGb, 0.01)) * 100));

  const go = async (path: string) => {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: info.projectId }),
      });
      const data = await res.json();
      if (res.ok && data.url) window.location.href = data.url;
      else alert(data.error ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          Plan: <span className={pro ? "text-emerald-300" : "text-white/80"}>{pro ? "Pro" : "Free"}</span>
        </h2>
        {pro ? (
          <button onClick={() => go("/api/billing/portal")} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm disabled:opacity-50">
            Manage billing
          </button>
        ) : (
          <button onClick={() => go("/api/checkout/plans")} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-sm disabled:opacity-50">
            Upgrade — $5/mo
          </button>
        )}
      </div>

      <div className="text-sm text-white/70">
        Relay bandwidth this month: {info.relayUsedGb.toFixed(2)} / {info.relayIncludedGb} GB included
        {pro && <span className="text-white/45"> · overage $0.10/GB</span>}
      </div>
      <div className="h-2 rounded bg-white/10 overflow-hidden">
        <div
          className={`h-full ${pct >= 100 ? "bg-red-400/70" : pct > 75 ? "bg-amber-400/70" : "bg-emerald-400/60"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {!pro && pct >= 100 && (
        <p className="text-xs text-amber-300/90">
          Relay cap reached — relayed connections are paused until next month (direct
          peer-to-peer keeps working). Upgrade to remove the cap.
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 text-xs text-white/50 pt-1">
        <div>rooms/hour<br /><span className="text-white/80">{info.limits.max_rooms_per_hour}</span></div>
        <div>concurrent rooms<br /><span className="text-white/80">{info.limits.max_concurrent_rooms}</span></div>
        <div>signals/min<br /><span className="text-white/80">{info.limits.max_signals_per_min}</span></div>
      </div>
    </section>
  );
}

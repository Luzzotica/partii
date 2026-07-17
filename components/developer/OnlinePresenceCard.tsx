"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Counts = {
  online: number;
  playing: number;
  by_game: Record<string, { online: number; playing: number }>;
  stale_after_sec: number;
};

type LivePlayer = {
  player_id: string;
  display_name: string | null;
  game_id: string | null;
  status: string;
  last_seen: string;
};

/**
 * Live online / playing counts for a project.
 * Polls the developer API and also listens to Supabase Realtime on
 * player_presence so the number updates when heartbeats land.
 */
export function OnlinePresenceCard({ projectId }: { projectId: string }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [players, setPlayers] = useState<LivePlayer[]>([]);
  const [live, setLive] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(
      `/api/developer/presence?project_id=${projectId}&detail=1`,
    );
    if (!res.ok) return;
    const data = await res.json();
    setCounts({
      online: data.online ?? 0,
      playing: data.playing ?? 0,
      by_game: data.by_game ?? {},
      stale_after_sec: data.stale_after_sec ?? 90,
    });
    setPlayers(data.players ?? []);
  }, [projectId]);

  useEffect(() => {
    void refresh();
    // Safety poll — Realtime can drop; heartbeats are ~30s so 20s is fine.
    const t = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`presence:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "player_presence",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          setLive(true);
          void refresh();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLive(true);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, refresh]);

  const games = Object.entries(counts?.by_game ?? {}).filter(([k]) => k !== "_");

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Online now</h2>
        <span className="text-xs text-white/40 flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              live ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-white/30"
            }`}
          />
          {live ? "live" : "connecting…"}
          {counts && (
            <span className="ml-1 text-white/30">
              · stale after {counts.stale_after_sec}s
            </span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap gap-6">
        <div>
          <div className="text-3xl font-semibold tabular-nums text-emerald-300/90">
            {counts?.online ?? "—"}
          </div>
          <div className="text-xs text-white/50">online</div>
        </div>
        <div>
          <div className="text-3xl font-semibold tabular-nums text-[#aab2ff]">
            {counts?.playing ?? "—"}
          </div>
          <div className="text-xs text-white/50">in game</div>
        </div>
      </div>

      {games.length > 0 && (
        <div className="text-xs text-white/55 space-y-0.5">
          {games.map(([gid, c]) => (
            <div key={gid} className="flex gap-2">
              <span className="font-mono text-white/70">{gid}</span>
              <span>
                {c.online} online
                {c.playing > 0 && ` · ${c.playing} playing`}
              </span>
            </div>
          ))}
        </div>
      )}

      {players.length > 0 && (
        <ul className="rounded border border-white/10 divide-y divide-white/5 max-h-48 overflow-y-auto">
          {players.map((p) => (
            <li
              key={p.player_id}
              className="px-3 py-1.5 text-sm flex items-center justify-between gap-2"
            >
              <span className="truncate text-white/80">
                {p.display_name ?? p.player_id.slice(0, 8)}
              </span>
              <span className="text-[11px] text-white/40 shrink-0 flex items-center gap-2">
                {p.game_id && <span className="font-mono">{p.game_id}</span>}
                <span
                  className={
                    p.status === "playing" ? "text-[#aab2ff]" : "text-emerald-300/80"
                  }
                >
                  {p.status}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {counts && counts.online === 0 && (
        <p className="text-sm text-white/40">
          Nobody online. Games call{" "}
          <code className="text-white/60">cloud.setPresence()</code> (or{" "}
          <code className="text-white/60">POST /api/presence</code>) on a ~30s heartbeat.
        </p>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";

type PlayerRow = {
  id: string;
  display_name: string | null;
  banned: boolean;
  role: "player" | "admin";
  created_at: string;
  last_seen_at: string;
  providers: string[];
};

/** Anon-only (or no real identity) — no ban/admin controls. */
function isAnonymousPlayer(providers: string[]): boolean {
  if (providers.length === 0) return true;
  return providers.every((p) => p === "anon");
}

// Developer view of the project's players — every signup, whatever the source
// (anonymous device, Steam, Apple, Google, Discord, email), scoped to THIS
// project. Ban / admin only for players with a real identity.
export function PlayersPanel({ projectId }: { projectId: string }) {
  const [total, setTotal] = useState<number | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch(`/api/developer/players?project_id=${projectId}&limit=25`);
    if (!res.ok) return;
    const data = await res.json();
    setTotal(data.total);
    setPlayers(data.players);
  };
  useEffect(() => {
    void load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [projectId]);

  const patchPlayer = async (
    playerId: string,
    patch: { banned?: boolean; role?: "player" | "admin" },
  ) => {
    setBusy(playerId);
    setError(null);
    try {
      const res = await fetch(`/api/developer/players`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, player_id: playerId, ...patch }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Update failed");
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Players</h2>
        {total !== null && <span className="text-sm text-white/50">{total} total</span>}
      </div>
      {error && <p className="text-sm text-red-300/90">{error}</p>}
      {players.length === 0 ? (
        <p className="text-sm text-white/40">
          No players yet. They appear here the first time your game calls{" "}
          <code className="text-white/60">/api/players/login</code> — including silent anonymous
          sign-ins.
        </p>
      ) : (
        <div className="rounded border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-left text-white/60">
              <tr>
                <th className="p-2">Player</th>
                <th className="p-2">Sign-ins</th>
                <th className="p-2">Last seen</th>
                <th className="p-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const anon = isAnonymousPlayer(p.providers);
                return (
                  <tr
                    key={p.id}
                    className={`border-t border-white/5 ${p.banned ? "opacity-50" : ""}`}
                  >
                    <td className="p-2">
                      <span className="text-white/85">{p.display_name ?? "—"}</span>
                      {p.role === "admin" && (
                        <span className="ml-1.5 rounded bg-[#3742fa]/25 text-[#aab2ff] px-1.5 py-0.5 text-[10px]">
                          admin
                        </span>
                      )}
                      {anon && (
                        <span className="ml-1.5 rounded bg-white/10 text-white/45 px-1.5 py-0.5 text-[10px]">
                          anon
                        </span>
                      )}
                      <span className="block font-mono text-[10px] text-white/35">{p.id}</span>
                    </td>
                    <td className="p-2 text-white/60">{p.providers.join(", ") || "—"}</td>
                    <td className="p-2 font-mono text-xs text-white/50">
                      {p.last_seen_at.slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="p-2 text-right space-x-2">
                      {anon ? (
                        <span className="text-[11px] text-white/30" title="Link a real identity first">
                          —
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              void patchPlayer(p.id, {
                                role: p.role === "admin" ? "player" : "admin",
                              })
                            }
                            disabled={busy === p.id}
                            className="px-2 py-1 rounded text-xs disabled:opacity-50 bg-white/10 hover:bg-white/20"
                            title="Admins see dev functionality inside the game (⌥D debug reporter)"
                          >
                            {p.role === "admin" ? "Revoke admin" : "Make admin"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void patchPlayer(p.id, { banned: !p.banned })}
                            disabled={busy === p.id}
                            className={`px-2 py-1 rounded text-xs disabled:opacity-50 ${
                              p.banned
                                ? "bg-white/10 hover:bg-white/20"
                                : "bg-red-500/15 hover:bg-red-500/25 text-red-200"
                            }`}
                          >
                            {p.banned ? "Unban" : "Ban"}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import {
  fetchBoard,
  partiiErrorMessage,
  type BoardPage,
  type BoardPeriod,
} from "./partii";
import { usePartiiPlayer } from "./player";

const PERIODS: { id: BoardPeriod; label: string }[] = [
  { id: "daily", label: "Today" },
  { id: "weekly", label: "This week" },
  { id: "all", label: "All time" },
];

function resetsLabel(resetsAt: number | null): string | null {
  if (!resetsAt) return null;
  const hours = Math.max(0, Math.round((resetsAt - Date.now()) / 3_600_000));
  if (hours < 1) return "Resets in under an hour";
  if (hours < 48) return `Resets in ${hours} hours`;
  return `Resets in ${Math.round(hours / 24)} days`;
}

function waveLabel(meta: Record<string, unknown> | undefined): string {
  const wave = meta?.wave;
  if (typeof wave !== "number" || wave <= 0) return "";
  return ` · W${wave}`;
}

export function ScoreBoard({ refreshKey = 0 }: { refreshKey?: number }) {
  const player = usePartiiPlayer();
  const [period, setPeriod] = useState<BoardPeriod>("all");
  const [page, setPage] = useState<BoardPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetchBoard(period, 10)
      .then((next) => {
        if (cancel) return;
        setPage(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancel) return;
        setPage(null);
        setError(partiiErrorMessage(err));
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [period, refreshKey, player?.id]);

  const reset = resetsLabel(page?.resets_at ?? null);
  const onBoard =
    page?.me && page.entries.some((entry) => entry.player_id === player?.id);

  return (
    <div className="mx-auto mt-10 w-full max-w-[500px] bg-gradient-to-br from-[rgba(26,26,46,0.95)] to-[rgba(20,20,40,0.98)] border-2 border-white/15 rounded-2xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.7),0_0_40px_rgba(55,66,250,0.1)]">
      <h3 className="font-orbitron text-xs md:text-sm tracking-[3px] md:tracking-[6px] text-white/70 mb-4 text-center uppercase font-bold">
        Leaderboard
      </h3>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {PERIODS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPeriod(item.id)}
            className={`font-orbitron rounded-lg px-2 py-2 text-[10px] md:text-xs font-semibold uppercase tracking-wide ${
              period === item.id
                ? "bg-[#3742fa] text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {!loading && reset && (
        <p className="font-orbitron mb-3 text-center text-[10px] text-white/40">{reset}</p>
      )}
      {loading && (
        <div className="font-orbitron text-xs text-white/40 text-center py-5">Loading...</div>
      )}
      {!loading && error && (
        <div className="font-orbitron text-xs text-[#ff6b81] text-center py-5">{error}</div>
      )}
      {!loading && !error && page && page.entries.length === 0 && (
        <div className="font-orbitron text-xs text-white/40 text-center py-5">
          No scores yet. Be the first!
        </div>
      )}
      {!loading && !error && page && page.entries.length > 0 && (
        <div className="flex flex-col gap-2 bg-black/40 border border-white/10 rounded-lg p-4 max-h-[400px] overflow-y-auto">
          {page.entries.map((entry) => {
            const mine = player?.id === entry.player_id;
            return (
              <div
                key={entry.player_id}
                className={`grid grid-cols-[40px_1fr_auto] items-center gap-3 px-3 py-2.5 rounded-md font-orbitron ${
                  mine
                    ? "bg-[rgba(55,66,250,0.2)] border border-[rgba(55,66,250,0.4)]"
                    : "bg-white/[0.03]"
                }`}
              >
                <span className="text-sm font-bold text-right text-white/60">#{entry.rank}</span>
                <span className="text-sm font-semibold overflow-hidden text-ellipsis whitespace-nowrap text-white/90">
                  {entry.display_name}
                </span>
                <span className="text-sm font-bold text-right text-[#ffa502]">
                  {entry.score.toLocaleString()}
                  <span className="text-white/40 font-normal">{waveLabel(entry.meta)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {!loading && !error && page?.me && !onBoard && (
        <p className="font-orbitron mt-3 text-center text-xs text-white/70">
          You: #{page.me.rank ?? "–"} · {page.me.score.toLocaleString()}
          {waveLabel(page.me.meta)}
        </p>
      )}
    </div>
  );
}

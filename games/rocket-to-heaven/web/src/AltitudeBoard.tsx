import { useEffect, useState } from "react";
import { fetchBoard, partiiErrorMessage, type BoardPage, type BoardPeriod } from "./partii";
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

export function AltitudeBoard({ refreshKey }: { refreshKey: number }) {
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
  const onBoard = page?.me && page.entries.some((entry) => entry.player_id === player?.id);

  return (
    <div className="mx-auto mt-8 w-full max-w-[500px] bg-black/30 backdrop-blur-sm border border-blue-200/20 rounded-2xl p-6">
      <h3 className="text-sm tracking-widest text-blue-200/70 mb-4 text-center uppercase font-bold">
        Highest altitudes
      </h3>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {PERIODS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPeriod(item.id)}
            className={`rounded-lg px-2 py-2 text-xs font-semibold uppercase tracking-wide ${
              period === item.id
                ? "bg-blue-500 text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {!loading && reset && <p className="mb-3 text-center text-xs text-white/40">{reset}</p>}
      {loading && <div className="text-xs text-white/40 text-center py-5">Loading...</div>}
      {!loading && error && (
        <div className="text-xs text-red-300/80 text-center py-5">{error}</div>
      )}
      {!loading && !error && page && page.entries.length === 0 && (
        <div className="text-xs text-white/40 text-center py-5">
          No scores yet. Be the first to ascend!
        </div>
      )}
      {!loading && !error && page && page.entries.length > 0 && (
        <div className="flex flex-col gap-2 bg-black/40 border border-white/10 rounded-lg p-4 max-h-[300px] overflow-y-auto">
          {page.entries.map((entry) => {
            const mine = player?.id === entry.player_id;
            return (
              <div
                key={entry.player_id}
                className={`grid grid-cols-[40px_1fr_auto] items-center gap-3 px-3 py-2.5 rounded-md ${
                  mine
                    ? "bg-blue-500/20 border border-blue-500/40"
                    : "bg-white/[0.03]"
                }`}
              >
                <span className="text-sm font-bold text-right text-white/60">#{entry.rank}</span>
                <span className="text-sm font-semibold overflow-hidden text-ellipsis whitespace-nowrap text-white/90">
                  {entry.display_name}
                </span>
                <span className="text-sm font-bold text-right text-blue-400">
                  {entry.score.toLocaleString()} ft
                </span>
              </div>
            );
          })}
        </div>
      )}
      {!loading && !error && page?.me && !onBoard && (
        <p className="mt-3 text-center text-sm text-blue-200/80">
          You: #{page.me.rank ?? "–"} · {page.me.score.toLocaleString()} ft
        </p>
      )}
    </div>
  );
}

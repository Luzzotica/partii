"use client";

import { useCallback, useEffect, useState } from "react";

type Feedback = {
  id: string;
  game_id: string | null;
  rating: number | null;
  text: string | null;
  context: string | null;
  match_id: string | null;
  status: string;
  created_at: string;
  player_name: string | null;
};

const json = { "Content-Type": "application/json" };

function age(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / (60 * 24))}d`;
}

function Stars({ n }: { n: number }) {
  return (
    <span className="text-yellow-300/90" title={`${n}/5 stars`}>
      {"★".repeat(n)}
      <span className="opacity-25">{"★".repeat(5 - n)}</span>
    </span>
  );
}

/**
 * Text feedback inbox only. Star ratings (with or without text) live under the
 * Ratings tab; when a text note also includes a rating we show it as a link chip.
 */
export function FeedbackManager({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Feedback[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"new" | "dismissed" | "converted">("new");

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/developer/feedback?project_id=${projectId}&status=${filter}&has_text=true&limit=50`,
    );
    if (res.ok) setItems((await res.json()).feedback);
    setLoaded(true);
  }, [projectId, filter]);
  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await load();
    } finally {
      setBusy(null);
    }
  };

  const convert = (id: string) =>
    act(id, () =>
      fetch("/api/developer/feedback/convert", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ project_id: projectId, feedback_id: id }),
      }),
    );

  const dismiss = (id: string) =>
    act(id, () =>
      fetch("/api/developer/feedback", {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({ project_id: projectId, id, status: "dismissed" }),
      }),
    );

  const reopen = (id: string) =>
    act(id, () =>
      fetch("/api/developer/feedback", {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({ project_id: projectId, id, status: "new" }),
      }),
    );

  if (!loaded) return <p className="text-sm text-white/40">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        {(["new", "dismissed", "converted"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-md capitalize ${
              filter === s ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            {s === "new" ? "Inbox" : s}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-white/40">
          {filter === "new"
            ? "No written feedback yet. Star-only ratings show up under Ratings — this inbox is for freeform text from players."
            : `No ${filter} feedback.`}
        </p>
      ) : (
        <ul className="rounded-xl border border-white/10 bg-white/[0.03] divide-y divide-white/5">
          {items.map((f) => (
            <li key={f.id} className="p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/85 whitespace-pre-wrap break-words">{f.text}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-white/40">
                  {f.rating !== null && (
                    <span className="inline-flex items-center gap-1 rounded bg-yellow-300/10 px-1.5 py-0.5">
                      <Stars n={f.rating} />
                      <span className="text-white/35">linked rating</span>
                    </span>
                  )}
                  {f.context && (
                    <span className="rounded bg-[#3742fa]/20 text-[#aab2ff] px-1.5 py-0.5 font-mono">
                      {f.context}
                    </span>
                  )}
                  {f.game_id && <span className="font-mono">{f.game_id}</span>}
                  {f.match_id && (
                    <span className="font-mono text-white/30" title="match_id">
                      match {f.match_id.slice(0, 8)}…
                    </span>
                  )}
                  <span>{f.player_name ?? "anonymous"}</span>
                  <span>{age(f.created_at)} ago</span>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {filter === "new" && (
                  <>
                    <button
                      type="button"
                      onClick={() => void convert(f.id)}
                      disabled={busy === f.id}
                      className="px-2 py-1 rounded text-xs bg-[#3742fa] hover:bg-[#5a67fa] disabled:opacity-50"
                      title="Create a task from this feedback"
                    >
                      → Task
                    </button>
                    <button
                      type="button"
                      onClick={() => void dismiss(f.id)}
                      disabled={busy === f.id}
                      className="px-2 py-1 rounded text-xs bg-white/10 hover:bg-white/20 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </>
                )}
                {filter === "dismissed" && (
                  <button
                    type="button"
                    onClick={() => void reopen(f.id)}
                    disabled={busy === f.id}
                    className="px-2 py-1 rounded text-xs bg-white/10 hover:bg-white/20 disabled:opacity-50"
                  >
                    Reopen
                  </button>
                )}
                {filter === "converted" && f.status === "converted" && (
                  <span className="text-xs text-white/35 self-center">Became a task</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

type Task = {
  id: string;
  milestone_id: string | null;
  title: string;
  description: string | null;
  context: string | null;
  status: "open" | "done";
  source: "manual" | "feedback" | "debug";
  feedback_id: string | null;
  screenshot_url: string | null;
  sort_order: number;
  done_at: string | null;
  created_at: string;
};

type Milestone = {
  id: string;
  name: string;
  description: string | null;
  target_date: string | null;
  state: "active" | "done" | "archived";
  sort_order: number;
  open: number;
  done: number;
};

const json = { "Content-Type": "application/json" };

function ContextChip({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <span className="rounded bg-[#3742fa]/20 text-[#aab2ff] px-1.5 py-0.5 text-[10px] font-mono">
      {value}
    </span>
  );
}

// Per-project task board: unassigned Inbox → milestones → done.
// Player text feedback lives under Feedback; star ratings under Ratings.
export function TasksManager({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickContext, setQuickContext] = useState("");
  const [newMilestone, setNewMilestone] = useState("");
  const [newMilestoneDate, setNewMilestoneDate] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    const [t, m] = await Promise.all([
      fetch(`/api/developer/tasks?project_id=${projectId}`),
      fetch(`/api/developer/milestones?project_id=${projectId}`),
    ]);
    if (t.ok) setTasks((await t.json()).tasks);
    if (m.ok) setMilestones((await m.json()).milestones);
    setLoaded(true);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); await load(); } finally { setBusy(null); }
  };

  // ── task actions ──────────────────────────────────────────────────────────
  const addTask = (milestoneId: string | null) =>
    act("add", () =>
      fetch("/api/developer/tasks", {
        method: "POST", headers: json,
        body: JSON.stringify({
          project_id: projectId,
          title: quickTitle,
          context: quickContext || undefined,
          milestone_id: milestoneId ?? undefined,
        }),
      }).then(() => { setQuickTitle(""); setQuickContext(""); }));

  const patchTask = (id: string, patch: Record<string, unknown>) =>
    act(id, () =>
      fetch("/api/developer/tasks", {
        method: "PATCH", headers: json,
        body: JSON.stringify({ project_id: projectId, id, ...patch }),
      }));

  const deleteTask = (id: string) =>
    act(id, () => fetch(`/api/developer/tasks?project_id=${projectId}&id=${id}`, { method: "DELETE" }));

  const saveEdit = (id: string) => {
    const title = editTitle.trim();
    setEditing(null);
    if (title) void patchTask(id, { title });
  };

  // ── milestone actions ─────────────────────────────────────────────────────
  const addMilestone = () =>
    act("addMilestone", () =>
      fetch("/api/developer/milestones", {
        method: "POST", headers: json,
        body: JSON.stringify({
          project_id: projectId,
          name: newMilestone,
          target_date: newMilestoneDate || undefined,
        }),
      }).then(() => { setNewMilestone(""); setNewMilestoneDate(""); }));

  const patchMilestone = (id: string, patch: Record<string, unknown>) =>
    act(id, () =>
      fetch("/api/developer/milestones", {
        method: "PATCH", headers: json,
        body: JSON.stringify({ project_id: projectId, id, ...patch }),
      }));

  const deleteMilestone = (id: string, name: string) => {
    if (!confirm(`Delete milestone "${name}"? Its tasks move back to the Inbox.`)) return;
    void act(id, () => fetch(`/api/developer/milestones?project_id=${projectId}&id=${id}`, { method: "DELETE" }));
  };

  // ── derived views ─────────────────────────────────────────────────────────
  const openTasks = tasks.filter((t) => t.status === "open");
  const inboxTasks = openTasks.filter((t) => t.milestone_id === null);
  const doneTasks = tasks.filter((t) => t.status === "done")
    .sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""));
  const activeMilestones = milestones.filter((m) => m.state === "active");
  const doneMilestones = milestones.filter((m) => m.state !== "active");

  const milestoneSelect = (t: Task) => (
    <select
      value={t.milestone_id ?? ""}
      onChange={(e) => void patchTask(t.id, { milestone_id: e.target.value || null })}
      disabled={busy === t.id}
      className="bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[11px] text-white/60 max-w-[110px]"
    >
      <option value="">Inbox</option>
      {activeMilestones.map((m) => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  );

  const taskRow = (t: Task) => (
    <li key={t.id} className="flex items-center gap-2 py-1.5 border-t border-white/5 first:border-t-0 group">
      <input
        type="checkbox"
        checked={t.status === "done"}
        onChange={() => void patchTask(t.id, { status: t.status === "done" ? "open" : "done" })}
        disabled={busy === t.id}
        className="accent-[#3742fa] shrink-0"
      />
      {editing === t.id ? (
        <input
          autoFocus
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={() => saveEdit(t.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEdit(t.id);
            if (e.key === "Escape") setEditing(null);
          }}
          className="flex-1 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-sm"
        />
      ) : (
        <button
          onClick={() => { setEditing(t.id); setEditTitle(t.title); }}
          className={`flex-1 text-left text-sm truncate hover:text-white ${t.status === "done" ? "line-through text-white/40" : "text-white/85"}`}
          title={t.description ?? t.title}
        >
          {t.title}
        </button>
      )}
      <ContextChip value={t.context} />
      {t.screenshot_url && (
        <a
          href={t.screenshot_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs hover:opacity-80"
          title="Open attached screenshot"
        >
          📷
        </a>
      )}
      {t.source === "feedback" && (
        <span className="text-[10px] text-white/35" title="Converted from player feedback">from player</span>
      )}
      {t.source === "debug" && (
        <span className="text-[10px] text-white/35" title="Filed in-game via the ⌥D debug reporter">debug</span>
      )}
      {t.status === "open" && milestoneSelect(t)}
      <button
        onClick={() => void deleteTask(t.id)}
        disabled={busy === t.id}
        className="text-white/25 hover:text-red-300 text-xs opacity-0 group-hover:opacity-100"
        aria-label="Delete task"
      >
        ✕
      </button>
    </li>
  );

  if (!loaded) return <p className="text-sm text-white/40">Loading…</p>;

  return (
    <div className="space-y-6">
      {/* ── Inbox ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Inbox</h2>
          <span className="text-sm text-white/50">
            {inboxTasks.length} unassigned task{inboxTasks.length === 1 ? "" : "s"}
          </span>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); if (quickTitle.trim()) void addTask(null); }}
          className="flex gap-2"
        >
          <input
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder="Add a task…"
            className="flex-1 p-2 bg-white/5 rounded border border-white/10 text-sm"
          />
          <input
            value={quickContext}
            onChange={(e) => setQuickContext(e.target.value)}
            placeholder="level / route"
            className="w-32 p-2 bg-white/5 rounded border border-white/10 text-sm font-mono"
          />
          <button
            type="submit"
            disabled={busy === "add" || !quickTitle.trim()}
            className="px-4 py-2 bg-[#3742fa] hover:bg-[#5a67fa] rounded text-sm disabled:opacity-50"
          >
            Add
          </button>
        </form>

        {inboxTasks.length === 0 ? (
          <p className="text-sm text-white/40">
            Inbox zero. New tasks land here until you assign them to a milestone.
          </p>
        ) : (
          <ul>{inboxTasks.map(taskRow)}</ul>
        )}
      </section>

      {/* ── Milestones ────────────────────────────────────────────────────── */}
      {activeMilestones.map((m) => {
        const mTasks = openTasks.filter((t) => t.milestone_id === m.id);
        return (
          <section key={m.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-3 min-w-0">
                <h2 className="text-lg font-semibold truncate">{m.name}</h2>
                {m.target_date && <span className="text-xs text-white/45 font-mono shrink-0">→ {m.target_date}</span>}
              </div>
              <div className="flex items-center gap-3 shrink-0 text-xs">
                <span className="text-white/50">{m.done}/{m.open + m.done} done</span>
                <button
                  onClick={() => void patchMilestone(m.id, { state: "done" })}
                  disabled={busy === m.id}
                  className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50"
                >
                  Complete
                </button>
                <button
                  onClick={() => deleteMilestone(m.id, m.name)}
                  disabled={busy === m.id}
                  className="text-white/30 hover:text-red-300"
                >
                  Delete
                </button>
              </div>
            </div>
            {m.description && <p className="text-sm text-white/50">{m.description}</p>}
            {mTasks.length === 0
              ? <p className="text-sm text-white/40">No open tasks — assign some from the Inbox.</p>
              : <ul>{mTasks.map(taskRow)}</ul>}
          </section>
        );
      })}

      <form
        onSubmit={(e) => { e.preventDefault(); if (newMilestone.trim()) void addMilestone(); }}
        className="rounded border border-white/10 border-dashed p-4 bg-white/[0.02] flex gap-2 items-center"
      >
        <input
          value={newMilestone}
          onChange={(e) => setNewMilestone(e.target.value)}
          placeholder="+ New milestone…"
          className="flex-1 p-2 bg-white/5 rounded border border-white/10 text-sm"
        />
        <input
          type="date"
          value={newMilestoneDate}
          onChange={(e) => setNewMilestoneDate(e.target.value)}
          className="p-2 bg-white/5 rounded border border-white/10 text-sm text-white/60"
        />
        <button
          type="submit"
          disabled={busy === "addMilestone" || !newMilestone.trim()}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded text-sm disabled:opacity-50"
        >
          Create
        </button>
      </form>

      {/* ── Done ──────────────────────────────────────────────────────────── */}
      {(doneTasks.length > 0 || doneMilestones.length > 0) && (
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-2">
          <button
            onClick={() => setShowDone(!showDone)}
            className="flex w-full items-baseline justify-between text-left"
          >
            <h2 className="text-lg font-semibold text-white/60">Done</h2>
            <span className="text-sm text-white/40">
              {doneTasks.length} task{doneTasks.length === 1 ? "" : "s"}
              {doneMilestones.length > 0 && ` · ${doneMilestones.length} milestone${doneMilestones.length === 1 ? "" : "s"}`}
              {" "}{showDone ? "▾" : "▸"}
            </span>
          </button>
          {showDone && (
            <>
              {doneMilestones.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-sm text-white/45 py-1 border-t border-white/5">
                  <span>◆ {m.name}</span>
                  <button
                    onClick={() => void patchMilestone(m.id, { state: "active" })}
                    className="text-xs text-white/30 hover:text-white"
                  >
                    Reopen
                  </button>
                </div>
              ))}
              <ul>{doneTasks.slice(0, 50).map(taskRow)}</ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}

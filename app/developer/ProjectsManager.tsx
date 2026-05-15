"use client";

import Link from "next/link";
import { useState } from "react";

type Project = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
};

export function ProjectsManager({ initial }: { initial: Project[] }) {
  const [projects, setProjects] = useState<Project[]>(initial);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Failed");
      return;
    }
    const j = await res.json();
    setProjects([j.project, ...projects]);
    setName("");
  }

  async function rename(id: string, current: string) {
    const next = prompt("New name", current);
    if (!next || next === current) return;
    const res = await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    if (!res.ok) return;
    const j = await res.json();
    setProjects(projects.map((p) => (p.id === id ? j.project : p)));
  }

  async function remove(id: string, current: string) {
    if (!confirm(`Delete project "${current}"? Its API keys will also be deleted.`)) return;
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setProjects(projects.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="rounded border border-white/10 p-4 bg-white/[0.02] flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-xs uppercase tracking-wide text-white/60 mb-1">New project name</label>
          <input
            className="w-full p-2 bg-white/5 rounded border border-white/10"
            placeholder="e.g. bouncy-blobs"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button type="submit" disabled={busy || !name.trim()} className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-500 disabled:opacity-50">
          {busy ? "Creating…" : "Create"}
        </button>
      </form>
      {error && <div className="text-red-400 text-sm">{error}</div>}

      <div className="rounded border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-white/60">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Slug</th>
              <th className="p-3">Created</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && (
              <tr><td colSpan={4} className="p-4 text-center text-white/40">No projects yet — create one above.</td></tr>
            )}
            {projects.map((p) => (
              <tr key={p.id} className="border-t border-white/5">
                <td className="p-3">
                  <Link href={`/developer/projects/${p.id}`} className="text-blue-400 hover:underline">{p.name}</Link>
                </td>
                <td className="p-3 font-mono text-xs text-white/60">{p.slug}</td>
                <td className="p-3 text-white/60">{new Date(p.created_at).toLocaleDateString()}</td>
                <td className="p-3 text-right space-x-3">
                  <button onClick={() => rename(p.id, p.name)} className="text-white/60 hover:text-white">Rename</button>
                  <button onClick={() => remove(p.id, p.name)} className="text-red-400 hover:text-red-300">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

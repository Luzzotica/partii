"use client";

import { useState } from "react";
import { buildWebRTCPrompt, API_KEY_PLACEHOLDER } from "@/lib/devPrompt";

type KeyRow = {
  id: string;
  key_prefix: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export function ProjectKeysManager({ projectId, initial }: { projectId: string; initial: KeyRow[] }) {
  const [keys, setKeys] = useState<KeyRow[]>(initial);
  const [name, setName] = useState("");
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<null | "token" | "prompt" | "placeholder">(null);

  async function copyPlaceholderPrompt() {
    const prompt = buildWebRTCPrompt({
      apiKey: API_KEY_PLACEHOLDER,
      baseUrl: window.location.origin,
    });
    await navigator.clipboard.writeText(prompt);
    setCopied("placeholder");
    setTimeout(() => setCopied(null), 2000);
  }

  async function copyToken() {
    if (!revealedSecret) return;
    await navigator.clipboard.writeText(revealedSecret);
    setCopied("token");
    setTimeout(() => setCopied(null), 2000);
  }

  async function copyTokenAndPrompt() {
    if (!revealedSecret) return;
    const prompt = buildWebRTCPrompt({
      apiKey: revealedSecret,
      baseUrl: window.location.origin,
    });
    await navigator.clipboard.writeText(prompt);
    setCopied("prompt");
    setTimeout(() => setCopied(null), 2000);
  }

  async function load() {
    const res = await fetch(`/api/developer/keys?projectId=${projectId}`);
    if (res.ok) {
      const j = await res.json();
      setKeys(j.keys ?? []);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setRevealedSecret(null);
    const res = await fetch("/api/developer/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, projectId }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Failed");
      return;
    }
    const j = await res.json();
    setRevealedSecret(j.secret);
    setName("");
    await load();
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this API key? Apps using it will start receiving 401.")) return;
    await fetch(`/api/developer/keys/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">API Keys</h2>

      <form onSubmit={create} className="rounded border border-white/10 p-4 bg-white/[0.02] space-y-3">
        <div className="font-medium">Create new key</div>
        <input
          className="w-full p-2 bg-white/5 rounded border border-white/10"
          placeholder="Key name (e.g. 'Production')"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={busy} className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-500 disabled:opacity-50">
          {busy ? "Creating…" : "Create key"}
        </button>
        {error && <div className="text-red-400 text-sm">{error}</div>}
      </form>

      {revealedSecret && (
        <div className="rounded border border-yellow-500/30 bg-yellow-500/10 p-4 space-y-3">
          <div className="font-medium text-yellow-200">Save this secret — it will not be shown again:</div>
          <pre className="bg-black/40 rounded p-3 overflow-x-auto text-xs select-all">{revealedSecret}</pre>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={copyToken}
              className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded text-sm border border-white/15"
            >
              {copied === "token" ? "Copied ✓" : "Copy token"}
            </button>
            <button
              onClick={copyTokenAndPrompt}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm"
            >
              {copied === "prompt" ? "Copied ✓" : "Copy token + AI prompt"}
            </button>
            <button onClick={() => setRevealedSecret(null)} className="text-sm text-white/60 hover:text-white ml-2">
              Dismiss
            </button>
          </div>
          <div className="text-xs text-white/60">
            <strong>Copy token</strong> — just the API key, for use in your own code.{" "}
            <strong>Copy token + AI prompt</strong> — the key plus a full WebRTC build spec; paste into ChatGPT, Claude,
            or Cursor and it will scaffold a working host + controller client.
          </div>
        </div>
      )}

      <div className="rounded border border-white/10 bg-white/[0.02] p-4 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={copyPlaceholderPrompt}
            className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded text-sm border border-white/15"
          >
            {copied === "placeholder" ? "Copied ✓" : "Copy AI prompt"}
          </button>
          <span className="text-xs text-white/50">
            The full WebRTC build spec — paste into any LLM, then provide your own key.
          </span>
        </div>
      </div>


      <div className="rounded border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-white/60">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Prefix</th>
              <th className="p-3">Created</th>
              <th className="p-3">Last used</th>
              <th className="p-3">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-white/40">No keys yet.</td></tr>
            )}
            {keys.map((k) => (
              <tr key={k.id} className="border-t border-white/5">
                <td className="p-3">{k.name || "—"}</td>
                <td className="p-3 font-mono text-xs">{k.key_prefix}…</td>
                <td className="p-3 text-white/60">{new Date(k.created_at).toLocaleString()}</td>
                <td className="p-3 text-white/60">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "—"}</td>
                <td className="p-3">{k.revoked_at ? <span className="text-red-400">revoked</span> : <span className="text-green-400">active</span>}</td>
                <td className="p-3 text-right">
                  {!k.revoked_at && (
                    <button onClick={() => revoke(k.id)} className="text-red-400 hover:text-red-300">Revoke</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

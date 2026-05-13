"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function DeveloperSignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/developer/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, display_name: displayName }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Signup failed");
      return;
    }
    router.push("/developer");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="max-w-sm space-y-3">
      <h1 className="text-xl font-semibold mb-2">Sign up</h1>
      <input className="w-full p-2 bg-white/5 rounded border border-white/10" placeholder="Display name (optional)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      <input className="w-full p-2 bg-white/5 rounded border border-white/10" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="w-full p-2 bg-white/5 rounded border border-white/10" placeholder="Password (8+ chars)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      {error && <div className="text-red-400 text-sm">{error}</div>}
      <button type="submit" disabled={busy} className="w-full p-2 bg-blue-600 rounded hover:bg-blue-500 disabled:opacity-50">{busy ? "Creating…" : "Create account"}</button>
      <div className="text-sm text-white/60">Have an account? <Link href="/developer/login" className="text-blue-400 hover:underline">Log in</Link></div>
    </form>
  );
}

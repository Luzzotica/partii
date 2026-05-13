'use client';

import { useState } from 'react';

export function BuyButton({ offerSlug, label }: { offerSlug: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function buy() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/checkout/offers/${offerSlug}`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      setErr(data.error ?? 'Could not start checkout');
      setBusy(false);
      return;
    }
    window.location.href = data.url;
  }

  return (
    <div>
      <button
        onClick={buy}
        disabled={busy}
        className="px-5 py-2.5 bg-[#3742fa] hover:bg-[#5a67fa] rounded-lg text-sm font-semibold disabled:opacity-50"
      >
        {busy ? 'Redirecting…' : label}
      </button>
      {err && <p className="text-xs text-red-400 mt-1">{err}</p>}
    </div>
  );
}

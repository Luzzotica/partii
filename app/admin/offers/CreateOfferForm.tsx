'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function CreateOfferButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [priceDollars, setPriceDollars] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function reset() {
    setName('');
    setSlug('');
    setSlugTouched(false);
    setPriceDollars('');
    setErr(null);
    setBusy(false);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    reset();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const dollars = parseFloat(priceDollars || '0');
    const price_cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
    const res = await fetch('/api/admin/offers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, slug, price_cents, currency: 'usd' }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setErr(data.error ?? 'Failed');
      return;
    }
    router.push(`/admin/offers/${data.offer.id}`);
    router.refresh();
  }

  function autoSlug(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-[#3742fa] hover:bg-[#5a67fa] rounded text-sm font-semibold transition-colors"
      >
        + New offer
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f24] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">New offer</h2>
              <button
                type="button"
                onClick={close}
                className="text-white/50 hover:text-white text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-white/50 mb-1">
                  Name
                </label>
                <input
                  value={name}
                  onChange={(e) => autoSlug(e.target.value)}
                  required
                  autoFocus
                  className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-white/50 mb-1">
                  Slug
                </label>
                <input
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value);
                    setSlugTouched(true);
                  }}
                  required
                  pattern="[a-z0-9-]+"
                  className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-white/50 mb-1">
                  Price (USD)
                </label>
                <input
                  value={priceDollars}
                  onChange={(e) => setPriceDollars(e.target.value)}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
                />
              </div>

              {err && <p className="text-sm text-red-400">{err}</p>}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={busy}
                  className="px-4 py-2 text-sm text-white/70 hover:text-white disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 bg-[#3742fa] hover:bg-[#5a67fa] rounded text-sm font-semibold disabled:opacity-50"
                >
                  {busy ? 'Creating…' : 'Create offer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

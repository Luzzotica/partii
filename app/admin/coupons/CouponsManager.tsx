'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type Coupon = {
  id: string;
  code: string;
  active: boolean;
  percent_off: number | null;
  amount_off: number | null;
  currency: string | null;
  max_redemptions: number | null;
  times_redeemed: number;
  expires_at: string | null;
  created_at: string;
  offer_id: string | null;
  offer_name: string | null;
};

export type OfferOpt = { id: string; name: string; synced: boolean };

function formatDiscount(c: Coupon): string {
  if (c.percent_off != null) return `${c.percent_off}% off`;
  if (c.amount_off != null) {
    const cur = (c.currency ?? 'usd').toUpperCase();
    return `${(c.amount_off / 100).toFixed(2)} ${cur} off`;
  }
  return '—';
}

export function CouponsManager({ coupons, offers }: { coupons: Coupon[]; offers: OfferOpt[] }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [percentOff, setPercentOff] = useState('');
  const [amountOffDollars, setAmountOffDollars] = useState('');
  const [currency, setCurrency] = useState('usd');
  const [offerId, setOfferId] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const payload: Record<string, unknown> = {
      code,
      discount_type: discountType,
      offer_id: offerId || null,
      max_redemptions: maxRedemptions ? Number(maxRedemptions) : null,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    };
    if (discountType === 'percent') {
      payload.percent_off = percentOff ? Number(percentOff) : null;
    } else {
      payload.amount_off_cents = amountOffDollars
        ? Math.round(Number(amountOffDollars) * 100)
        : null;
      payload.currency = currency;
    }
    const res = await fetch('/api/admin/coupons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErr(data.error ?? 'Failed');
      return;
    }
    setCode('');
    setPercentOff('');
    setAmountOffDollars('');
    setOfferId('');
    setMaxRedemptions('');
    setExpiresAt('');
    router.refresh();
  }

  async function remove(c: string) {
    if (!confirm(`Deactivate coupon ${c}? It can't be redeemed after this.`)) return;
    const res = await fetch(`/api/admin/coupons/${encodeURIComponent(c)}`, { method: 'DELETE' });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={create}
        className="rounded-xl border border-white/10 bg-white/5 p-4 grid grid-cols-1 sm:grid-cols-6 gap-3 items-end"
      >
        <Field label="Code">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm font-mono"
          />
        </Field>
        <Field label="Discount type">
          <select
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as 'percent' | 'amount')}
            className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
          >
            <option value="percent">% off</option>
            <option value="amount">$ off</option>
          </select>
        </Field>
        {discountType === 'percent' ? (
          <Field label="Percent off">
            <input
              type="number"
              min={1}
              max={100}
              step="0.01"
              value={percentOff}
              onChange={(e) => setPercentOff(e.target.value)}
              required
              className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
            />
          </Field>
        ) : (
          <>
            <Field label="Amount off">
              <input
                type="number"
                min={0.01}
                step="0.01"
                value={amountOffDollars}
                onChange={(e) => setAmountOffDollars(e.target.value)}
                required
                className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
              />
            </Field>
            <Field label="Currency">
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toLowerCase())}
                maxLength={3}
                className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm uppercase"
              />
            </Field>
          </>
        )}
        <Field label="Offer (optional)">
          <select
            value={offerId}
            onChange={(e) => setOfferId(e.target.value)}
            className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
          >
            <option value="">Any offer</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id} disabled={!o.synced}>
                {o.name}{!o.synced ? ' (not synced)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Max redemptions">
          <input
            type="number"
            min={1}
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
            placeholder="∞"
            className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
          />
        </Field>
        <Field label="Expires">
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
          />
        </Field>
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 bg-[#3742fa] hover:bg-[#5a67fa] rounded text-sm disabled:opacity-50 h-fit sm:col-span-6"
        >
          {busy ? 'Creating…' : 'Create coupon'}
        </button>
        {err && <p className="sm:col-span-6 text-sm text-red-400">{err}</p>}
      </form>

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-white/60">
            <tr>
              <th className="px-4 py-2 font-medium">Code</th>
              <th className="px-4 py-2 font-medium">Discount</th>
              <th className="px-4 py-2 font-medium">Offer</th>
              <th className="px-4 py-2 font-medium">Redeemed</th>
              <th className="px-4 py-2 font-medium">Expires</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={c.id} className="border-t border-white/5">
                <td className="px-4 py-2 font-mono">{c.code}</td>
                <td className="px-4 py-2">{formatDiscount(c)}</td>
                <td className="px-4 py-2">{c.offer_name ?? (c.offer_id ? '—' : 'Any')}</td>
                <td className="px-4 py-2">
                  {c.times_redeemed}
                  {c.max_redemptions !== null && ` / ${c.max_redemptions}`}
                </td>
                <td className="px-4 py-2">
                  {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={
                      c.active
                        ? 'text-emerald-300 text-xs'
                        : 'text-white/40 text-xs'
                    }
                  >
                    {c.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  {c.active && (
                    <button
                      onClick={() => remove(c.code)}
                      className="text-red-400 hover:underline text-xs"
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {coupons.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-white/40">
                  No coupons yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-white/50 mb-1">{label}</span>
      {children}
    </label>
  );
}

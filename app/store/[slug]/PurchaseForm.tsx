'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';

type Props = {
  offerSlug: string;
  offerName: string;
  priceLabel: string;
};

let stripePromise: Promise<Stripe | null> | null = null;
function getStripeClient(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}

const APPEARANCE = {
  theme: 'night' as const,
  labels: 'floating' as const,
  variables: {
    colorPrimary: '#5a67fa',
    colorBackground: '#0f0f24',
    colorText: '#ffffff',
    colorTextSecondary: 'rgba(255,255,255,0.7)',
    colorTextPlaceholder: 'rgba(255,255,255,0.4)',
    colorDanger: '#ff6b81',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSizeBase: '15px',
    spacingUnit: '4px',
    borderRadius: '8px',
  },
  rules: {
    '.Input': {
      backgroundColor: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.1)',
    },
    '.Input:focus': {
      border: '1px solid #5a67fa',
      boxShadow: '0 0 0 1px #5a67fa',
    },
    '.Tab': {
      backgroundColor: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.1)',
    },
    '.Tab--selected': {
      borderColor: '#5a67fa',
      color: '#ffffff',
    },
    '.Label': {
      color: 'rgba(255,255,255,0.7)',
    },
  },
};

const FONTS: Array<{ cssSrc: string }> = [];

export function PurchaseForm({ offerSlug, offerName, priceLabel }: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentLabel, setCurrentLabel] = useState(priceLabel);
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; label: string } | null>(null);
  const stripe = useMemo(() => getStripeClient(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setClientSecret(null);
    setPaymentIntentId(null);
    setAppliedCoupon(null);
    setCurrentLabel(priceLabel);
    setIntentError(null);
    fetch(`/api/checkout/offers/${offerSlug}/intent`, { method: 'POST' })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.client_secret) {
          setIntentError(data.error ?? 'Could not start checkout');
          return;
        }
        setClientSecret(data.client_secret);
        setPaymentIntentId(data.payment_intent_id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setIntentError(err instanceof Error ? err.message : 'Network error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [offerSlug, priceLabel]);

  function formatAmount(amount: number, currency: string): string {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency.toUpperCase(),
      }).format(amount / 100);
    } catch {
      return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-white/50">Total</div>
          <div className="text-2xl font-semibold">{currentLabel}</div>
          {appliedCoupon && (
            <div className="text-xs text-emerald-400 mt-1">
              {appliedCoupon.code} applied — {appliedCoupon.label}
            </div>
          )}
        </div>
        <div className="text-xs text-white/40">Secure checkout via Stripe</div>
      </div>

      {intentError && <div className="text-sm text-red-400">{intentError}</div>}

      {loading && !clientSecret && (
        <div className="text-sm text-white/50">Loading payment form…</div>
      )}

      {clientSecret && paymentIntentId && (
        <Elements
          key={clientSecret}
          stripe={stripe}
          options={{
            clientSecret,
            appearance: APPEARANCE,
            fonts: FONTS,
          }}
        >
          <CheckoutFields
            offerSlug={offerSlug}
            offerName={offerName}
            paymentIntentId={paymentIntentId}
            appliedCoupon={appliedCoupon}
            onCouponChange={(applied, label, currency) => {
              setAppliedCoupon(applied);
              setCurrentLabel(label != null && currency ? formatAmount(label, currency) : priceLabel);
            }}
          />
        </Elements>
      )}
    </div>
  );
}

type CheckoutFieldsProps = {
  offerSlug: string;
  offerName: string;
  paymentIntentId: string;
  appliedCoupon: { code: string; label: string } | null;
  onCouponChange: (
    applied: { code: string; label: string } | null,
    amount: number | null,
    currency: string | null
  ) => void;
};

function CheckoutFields({
  offerSlug,
  offerName,
  paymentIntentId,
  appliedCoupon,
  onCouponChange,
}: CheckoutFieldsProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponErr, setCouponErr] = useState<string | null>(null);

  async function applyCoupon() {
    if (!elements || couponBusy) return;
    const trimmed = code.trim();
    if (!trimmed) return;
    setCouponBusy(true);
    setCouponErr(null);
    try {
      const res = await fetch(`/api/checkout/offers/${offerSlug}/coupon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_intent_id: paymentIntentId, code: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCouponErr(data.error ?? 'Could not apply code');
        return;
      }
      onCouponChange(
        { code: data.code, label: data.discount_label },
        data.amount,
        data.currency
      );
      await elements.fetchUpdates();
      setCode('');
    } catch {
      setCouponErr('Network error');
    } finally {
      setCouponBusy(false);
    }
  }

  async function removeCoupon() {
    if (!elements || couponBusy) return;
    setCouponBusy(true);
    setCouponErr(null);
    try {
      const res = await fetch(`/api/checkout/offers/${offerSlug}/coupon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_intent_id: paymentIntentId, code: null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCouponErr(data.error ?? 'Could not remove code');
        return;
      }
      onCouponChange(null, null, null);
      await elements.fetchUpdates();
    } catch {
      setCouponErr('Network error');
    } finally {
      setCouponBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErr(null);
    const origin = window.location.origin;
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${origin}/checkout/return?offer=${encodeURIComponent(offerSlug)}`,
      },
    });
    if (error) {
      setErr(error.message ?? 'Payment failed');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement />
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full px-4 py-3 bg-[#3742fa] hover:bg-[#5a67fa] rounded-lg font-semibold disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Processing…' : `Pay for ${offerName}`}
      </button>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="space-y-2 pt-2 border-t border-white/10">
        {appliedCoupon ? (
          <div className="flex items-center justify-between rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm">
            <span>
              <span className="font-mono">{appliedCoupon.code}</span>{' '}
              <span className="text-white/60">— {appliedCoupon.label}</span>
            </span>
            <button
              type="button"
              onClick={removeCoupon}
              disabled={couponBusy}
              className="text-xs text-white/60 hover:text-white disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Coupon code"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:border-[#5a67fa]"
            />
            <button
              type="button"
              onClick={applyCoupon}
              disabled={couponBusy || !code.trim()}
              className="px-3 py-2 rounded-lg border border-white/15 bg-white/5 text-sm hover:bg-white/10 disabled:opacity-50"
            >
              {couponBusy ? '…' : 'Apply'}
            </button>
          </div>
        )}
        {couponErr && <p className="text-xs text-red-400">{couponErr}</p>}
      </div>
    </form>
  );
}

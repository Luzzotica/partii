import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import type Stripe from 'stripe';
import { CouponsManager, type Coupon, type OfferOpt } from './CouponsManager';

export const dynamic = 'force-dynamic';

const SOURCE_TAG = 'hexii';

async function loadCoupons(): Promise<{ coupons: Coupon[]; error: string | null }> {
  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (err) {
    return { coupons: [], error: err instanceof Error ? err.message : 'Stripe not configured' };
  }

  const promos: Stripe.PromotionCode[] = [];
  for await (const promo of stripe.promotionCodes.list({
    limit: 100,
    expand: ['data.promotion.coupon'],
  })) {
    const c = promo.promotion.coupon;
    if (c && typeof c !== 'string' && c.metadata?.source === SOURCE_TAG) {
      promos.push(promo);
    }
  }

  const offerIds = new Set<string>();
  for (const p of promos) {
    const c = p.promotion.coupon;
    if (c && typeof c !== 'string' && c.metadata?.offer_id) {
      offerIds.add(c.metadata.offer_id);
    }
  }
  const admin = createAdminClient();
  const offerNameById = new Map<string, string>();
  if (offerIds.size > 0) {
    const { data: offers } = await admin
      .from('offers')
      .select('id, name')
      .in('id', Array.from(offerIds));
    for (const o of offers ?? []) offerNameById.set(o.id, o.name);
  }

  const coupons: Coupon[] = promos
    .map((p) => {
      const c = p.promotion.coupon as Stripe.Coupon;
      const offerId = (c.metadata?.offer_id as string | undefined) || null;
      return {
        id: p.id,
        code: p.code,
        active: p.active && c.valid,
        percent_off: c.percent_off ?? null,
        amount_off: c.amount_off ?? null,
        currency: c.currency ?? null,
        max_redemptions: p.max_redemptions ?? null,
        times_redeemed: p.times_redeemed,
        expires_at: p.expires_at ? new Date(p.expires_at * 1000).toISOString() : null,
        created_at: new Date(p.created * 1000).toISOString(),
        offer_id: offerId,
        offer_name: offerId ? offerNameById.get(offerId) ?? null : null,
      };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return { coupons, error: null };
}

export default async function AdminCouponsPage() {
  const admin = createAdminClient();
  const [{ coupons, error }, { data: offers }] = await Promise.all([
    loadCoupons(),
    admin
      .from('offers')
      .select('id, name, stripe_product_id')
      .order('name'),
  ]);

  const offerOpts: OfferOpt[] = (offers ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    synced: !!o.stripe_product_id,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Coupons</h1>
      <p className="text-sm text-white/60">
        Codes are stored in Stripe. They apply at checkout on the store page and
        sync automatically — you don&apos;t need to touch the Stripe dashboard.
      </p>
      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      <CouponsManager coupons={coupons} offers={offerOpts} />
    </div>
  );
}

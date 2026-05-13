import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import type Stripe from 'stripe';

const SOURCE_TAG = 'hexii';

type StripeClient = ReturnType<typeof getStripe>;

type ListedCoupon = {
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

async function listOurPromotionCodes(
  stripe: StripeClient
): Promise<Stripe.PromotionCode[]> {
  const out: Stripe.PromotionCode[] = [];
  for await (const promo of stripe.promotionCodes.list({
    limit: 100,
    expand: ['data.promotion.coupon'],
  })) {
    const coupon = promo.promotion.coupon;
    if (
      coupon &&
      typeof coupon !== 'string' &&
      coupon.metadata?.source === SOURCE_TAG
    ) {
      out.push(promo);
    }
  }
  return out;
}

export async function GET() {
  return withAdmin(async () => {
    let stripe: StripeClient;
    try {
      stripe = getStripe();
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Stripe not configured');
    }

    const promos = await listOurPromotionCodes(stripe);
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

    const coupons: ListedCoupon[] = promos.map((p) => {
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
    });
    coupons.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return { coupons };
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  return withAdmin(async () => {
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!code) throw new Error('code required');
    if (!/^[A-Z0-9-]+$/.test(code)) {
      throw new Error('code must be A–Z, 0–9, or dashes only');
    }

    const discountType: 'percent' | 'amount' = body.discount_type === 'amount' ? 'amount' : 'percent';
    const percentOff = body.percent_off != null ? Number(body.percent_off) : null;
    const amountOffCents = body.amount_off_cents != null ? Number(body.amount_off_cents) : null;
    const currency = body.currency ? String(body.currency).toLowerCase() : null;
    const maxRedemptions = body.max_redemptions != null ? Number(body.max_redemptions) : null;
    const expiresAt: string | null = body.expires_at ?? null;
    const offerId: string | null = body.offer_id || null;

    if (discountType === 'percent') {
      if (percentOff == null || !Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100) {
        throw new Error('percent_off must be between 0 and 100');
      }
    } else {
      if (amountOffCents == null || !Number.isFinite(amountOffCents) || amountOffCents <= 0) {
        throw new Error('amount_off_cents must be > 0');
      }
      if (!currency) throw new Error('currency required for amount-off coupons');
    }
    if (maxRedemptions != null && (!Number.isFinite(maxRedemptions) || maxRedemptions < 1)) {
      throw new Error('max_redemptions must be >= 1');
    }
    let expiresAtUnix: number | null = null;
    if (expiresAt) {
      const ts = Math.floor(new Date(expiresAt).getTime() / 1000);
      if (!Number.isFinite(ts) || ts <= Math.floor(Date.now() / 1000)) {
        throw new Error('expires_at must be in the future');
      }
      expiresAtUnix = ts;
    }

    let stripe: StripeClient;
    try {
      stripe = getStripe();
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Stripe not configured');
    }

    const admin = createAdminClient();
    let stripeProductId: string | null = null;
    if (offerId) {
      const { data: offer } = await admin
        .from('offers')
        .select('id, stripe_product_id')
        .eq('id', offerId)
        .single();
      if (!offer) throw new Error('offer not found');
      stripeProductId = offer.stripe_product_id;
      if (!stripeProductId) {
        throw new Error('offer is not synced to Stripe yet — set a price and save it first');
      }
    }

    const couponParams: Stripe.CouponCreateParams = {
      duration: 'once',
      metadata: { source: SOURCE_TAG, ...(offerId ? { offer_id: offerId } : {}) },
      ...(stripeProductId ? { applies_to: { products: [stripeProductId] } } : {}),
    };
    if (discountType === 'percent') {
      couponParams.percent_off = percentOff!;
    } else {
      couponParams.amount_off = amountOffCents!;
      couponParams.currency = currency!;
    }

    const coupon = await stripe.coupons.create(couponParams);

    let promo: Stripe.PromotionCode;
    try {
      promo = await stripe.promotionCodes.create({
        promotion: { type: 'coupon', coupon: coupon.id },
        code,
        ...(maxRedemptions != null ? { max_redemptions: maxRedemptions } : {}),
        ...(expiresAtUnix != null ? { expires_at: expiresAtUnix } : {}),
      });
    } catch (err) {
      // Roll back the orphan coupon if promo creation fails (e.g. duplicate code)
      try {
        await stripe.coupons.del(coupon.id);
      } catch {
        // ignore
      }
      throw new Error(err instanceof Error ? err.message : 'Could not create promotion code');
    }

    return {
      coupon: {
        id: promo.id,
        code: promo.code,
        active: promo.active,
        percent_off: coupon.percent_off,
        amount_off: coupon.amount_off,
        currency: coupon.currency,
        max_redemptions: promo.max_redemptions,
        times_redeemed: promo.times_redeemed,
        expires_at: promo.expires_at ? new Date(promo.expires_at * 1000).toISOString() : null,
        offer_id: offerId,
      },
    };
  });
}

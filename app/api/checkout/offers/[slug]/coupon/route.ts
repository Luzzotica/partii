import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';

type Ctx = { params: Promise<{ slug: string }> };

const STRIPE_MIN_AMOUNTS: Record<string, number> = {
  usd: 50,
  eur: 50,
  gbp: 30,
  cad: 50,
  aud: 50,
};

function applyDiscount(
  original: number,
  coupon: { percent_off: number | null; amount_off: number | null; currency: string | null },
  currency: string
): { amount: number; label: string } | { error: string } {
  if (coupon.percent_off != null) {
    const amount = Math.max(0, Math.round(original * (1 - coupon.percent_off / 100)));
    return { amount, label: `${coupon.percent_off}% off` };
  }
  if (coupon.amount_off != null) {
    if (coupon.currency && coupon.currency.toLowerCase() !== currency.toLowerCase()) {
      return { error: 'Coupon currency does not match this offer' };
    }
    const amount = Math.max(0, original - coupon.amount_off);
    return { amount, label: `${(coupon.amount_off / 100).toFixed(2)} ${currency.toUpperCase()} off` };
  }
  return { error: 'Coupon has no discount configured' };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const paymentIntentId: string | undefined = body.payment_intent_id;
  const code: string | null = typeof body.code === 'string' && body.code.trim() ? body.code.trim() : null;
  if (!paymentIntentId) {
    return NextResponse.json({ error: 'payment_intent_id required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: offer } = await admin
    .from('offers')
    .select('id, slug, price_cents, currency, is_published, stripe_product_id')
    .eq('slug', slug)
    .single();
  if (!offer || !offer.is_published) {
    return NextResponse.json({ error: 'Offer not available' }, { status: 404 });
  }

  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (intent.metadata?.user_id !== user.id || intent.metadata?.offer_id !== offer.id) {
    return NextResponse.json({ error: 'Payment intent does not match' }, { status: 403 });
  }
  const original = Number(intent.metadata?.original_amount ?? offer.price_cents);
  const currency = (intent.currency ?? offer.currency).toLowerCase();

  // Removing the coupon → revert to original price
  if (!code) {
    const updated = await stripe.paymentIntents.update(paymentIntentId, {
      amount: original,
      metadata: {
        ...intent.metadata,
        promotion_code_id: '',
        coupon_id: '',
        coupon_code: '',
        discount_label: '',
      },
    });
    return NextResponse.json({
      amount: updated.amount,
      currency: updated.currency,
      original_amount: original,
      discount_label: null,
      code: null,
    });
  }

  const promoList = await stripe.promotionCodes.list({
    code,
    active: true,
    limit: 1,
    expand: ['data.promotion.coupon'],
  });
  const promo = promoList.data[0];
  if (!promo) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 });
  }

  const couponRef = promo.promotion.coupon;
  if (!couponRef || typeof couponRef === 'string') {
    return NextResponse.json({ error: 'Could not load coupon details' }, { status: 500 });
  }
  const coupon = couponRef;
  if (!coupon.valid) {
    return NextResponse.json({ error: 'Coupon is no longer valid' }, { status: 400 });
  }
  const allowedProducts = coupon.applies_to?.products ?? null;
  if (allowedProducts && allowedProducts.length > 0) {
    if (!offer.stripe_product_id || !allowedProducts.includes(offer.stripe_product_id)) {
      return NextResponse.json(
        { error: 'This code is not valid for this offer' },
        { status: 400 }
      );
    }
  }
  if (promo.expires_at && promo.expires_at * 1000 < Date.now()) {
    return NextResponse.json({ error: 'Code has expired' }, { status: 400 });
  }
  if (promo.max_redemptions != null && promo.times_redeemed >= promo.max_redemptions) {
    return NextResponse.json({ error: 'Code redemption limit reached' }, { status: 400 });
  }

  const result = applyDiscount(original, coupon, currency);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const minAmount = STRIPE_MIN_AMOUNTS[currency] ?? 50;
  if (result.amount > 0 && result.amount < minAmount) {
    return NextResponse.json(
      { error: `Discounted total is below the minimum charge for ${currency.toUpperCase()}` },
      { status: 400 }
    );
  }
  if (result.amount === 0) {
    return NextResponse.json(
      { error: '100% off codes are not supported on this checkout' },
      { status: 400 }
    );
  }

  const updated = await stripe.paymentIntents.update(paymentIntentId, {
    amount: result.amount,
    metadata: {
      ...intent.metadata,
      promotion_code_id: promo.id,
      coupon_id: coupon.id,
      coupon_code: promo.code,
      discount_label: result.label,
    },
  });

  return NextResponse.json({
    amount: updated.amount,
    currency: updated.currency,
    original_amount: original,
    discount_label: result.label,
    code: promo.code,
  });
}

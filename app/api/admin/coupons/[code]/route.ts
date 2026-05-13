import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { getStripe } from '@/lib/stripe/client';

type Ctx = { params: Promise<{ code: string }> };

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { code } = await params;
  return withAdmin(async () => {
    let stripe: ReturnType<typeof getStripe>;
    try {
      stripe = getStripe();
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Stripe not configured');
    }

    const list = await stripe.promotionCodes.list({ code, limit: 1 });
    const promo = list.data[0];
    if (!promo) throw new Error('Code not found in Stripe');

    // Stripe doesn't allow deleting promotion codes — deactivate instead.
    await stripe.promotionCodes.update(promo.id, { active: false });

    // The underlying Coupon can usually be deleted as long as it hasn't been
    // applied. If deletion fails, archiving the promo is enough — the coupon
    // can no longer be redeemed by anyone.
    const couponId = typeof promo.promotion.coupon === 'string'
      ? promo.promotion.coupon
      : promo.promotion.coupon?.id;
    if (couponId) {
      try {
        await stripe.coupons.del(couponId);
      } catch {
        // ignore — coupon may have redemptions or already be gone
      }
    }

    return { ok: true };
  });
}

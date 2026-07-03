import { NextRequest, NextResponse } from 'next/server';
import { getStripe, STRIPE_WEBHOOK_SECRET } from '@/lib/stripe/client';
import { grantOfferAccess } from '@/lib/checkout/grantOfferAccess';
import { applyLobbiiSubscriptionEvent } from '@/lib/billing/webhook';

export async function POST(req: NextRequest) {
  if (!STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 500 });
  }
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

  const raw = await req.text();
  const stripe = getStripe();

  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invalid signature';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
    const obj = event.data.object;
    const userId = obj.metadata?.user_id;
    const offerId = obj.metadata?.offer_id;
    if (userId && offerId) {
      await grantOfferAccess({ userId, offerId, paymentRef: obj.id });
    }
  }

  // Lobbii API-product subscriptions (identified by project_id metadata).
  await applyLobbiiSubscriptionEvent(event);

  return NextResponse.json({ received: true });
}

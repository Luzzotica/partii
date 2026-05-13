import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import { syncOfferToStripe } from '@/lib/stripe/syncOffer';

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: offer } = await admin
    .from('offers')
    .select('id, slug, name, description, price_cents, currency, is_published, stripe_product_id, stripe_price_id')
    .eq('slug', slug)
    .single();
  if (!offer || !offer.is_published || offer.price_cents <= 0) {
    return NextResponse.json({ error: 'Offer not available for purchase' }, { status: 404 });
  }

  // Make sure the Stripe Product exists (for receipt display) — Price isn't
  // strictly needed for PaymentIntent but keeping the offer in sync is cheap.
  if (!offer.stripe_product_id) {
    const sync = await syncOfferToStripe(offer.id);
    if (!sync.ok) {
      return NextResponse.json({ error: sync.error }, { status: 500 });
    }
  }

  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const intent = await stripe.paymentIntents.create({
    amount: offer.price_cents,
    currency: offer.currency.toLowerCase(),
    automatic_payment_methods: { enabled: true },
    description: offer.name,
    receipt_email: user.email ?? undefined,
    metadata: {
      offer_id: offer.id,
      user_id: user.id,
      original_amount: String(offer.price_cents),
    },
  });

  return NextResponse.json({
    client_secret: intent.client_secret,
    payment_intent_id: intent.id,
    amount: offer.price_cents,
    currency: offer.currency,
    offer: {
      id: offer.id,
      slug: offer.slug,
      name: offer.name,
      description: offer.description,
    },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import { syncOfferToStripe } from '@/lib/stripe/syncOffer';

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: offer } = await admin
    .from('offers')
    .select('id, slug, name, is_published, price_cents, stripe_price_id')
    .eq('slug', slug)
    .single();
  if (!offer || !offer.is_published || offer.price_cents <= 0) {
    return NextResponse.json({ error: 'Offer not available for purchase' }, { status: 404 });
  }

  let priceId = offer.stripe_price_id;
  if (!priceId) {
    const sync = await syncOfferToStripe(offer.id);
    if (!sync.ok || !sync.offer.stripe_price_id) {
      return NextResponse.json({ error: 'Stripe price unavailable' }, { status: 500 });
    }
    priceId = sync.offer.stripe_price_id;
  }

  const origin = req.nextUrl.origin;
  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: user.email ?? undefined,
    success_url: `${origin}/learn?purchase=success`,
    cancel_url: `${origin}/learn?purchase=cancelled`,
    metadata: { offer_id: offer.id, user_id: user.id },
  });

  return NextResponse.json({ url: session.url });
}

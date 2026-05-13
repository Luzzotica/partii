import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe/client';
import { grantOfferAccess } from '@/lib/checkout/grantOfferAccess';
import { Polling } from './Polling';

export const dynamic = 'force-dynamic';

type SP = Promise<{
  payment_intent?: string;
  offer?: string;
}>;

export default async function CheckoutReturnPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const paymentIntentId = sp.payment_intent;
  const offerSlug = sp.offer ?? null;

  if (!paymentIntentId) {
    return <ErrorState message="Missing payment reference." offerSlug={offerSlug} />;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/?signin=1');

  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch {
    return <ErrorState message="Payments are not configured." offerSlug={offerSlug} />;
  }

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

  // Hard ownership check before we trust any metadata
  if (intent.metadata?.user_id !== user.id) {
    return <ErrorState message="This payment doesn't belong to your account." offerSlug={offerSlug} />;
  }
  const offerId = intent.metadata?.offer_id;
  if (!offerId) {
    return <ErrorState message="This payment isn't linked to an offer." offerSlug={offerSlug} />;
  }

  switch (intent.status) {
    case 'succeeded': {
      await grantOfferAccess({ userId: user.id, offerId, paymentRef: intent.id });
      redirect('/learn?purchase=success');
    }
    case 'processing':
    case 'requires_action':
    case 'requires_confirmation': {
      return (
        <div className="max-w-md mx-auto py-16 text-center space-y-4">
          <div className="text-2xl font-semibold">Finalizing your purchase…</div>
          <p className="text-white/60">
            Stripe is still confirming your payment. This page will refresh automatically.
          </p>
          <div className="mx-auto h-8 w-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          <Polling />
        </div>
      );
    }
    case 'requires_payment_method':
    case 'canceled':
    default: {
      return (
        <ErrorState
          message="Your payment didn't go through. You haven't been charged."
          offerSlug={offerSlug}
        />
      );
    }
  }
}

function ErrorState({ message, offerSlug }: { message: string; offerSlug: string | null }) {
  return (
    <div className="max-w-md mx-auto py-16 text-center space-y-4">
      <div className="text-2xl font-semibold">Something went wrong</div>
      <p className="text-white/60">{message}</p>
      <Link
        href={offerSlug ? `/store/${offerSlug}` : '/store'}
        className="inline-block px-4 py-2 bg-[#3742fa] hover:bg-[#5a67fa] rounded text-sm font-semibold"
      >
        Back to store
      </Link>
    </div>
  );
}

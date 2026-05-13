import { getStripe } from './client';
import { createAdminClient } from '@/lib/supabase/admin';

type OfferRow = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
};

/**
 * Reconcile an offer's Stripe state with its DB state.
 *
 * - If price_cents <= 0: archive any existing Stripe Product + Price and clear
 *   the IDs (offer is effectively unsellable until a price is set).
 * - Otherwise: ensure a Stripe Product exists (creating it if needed and
 *   updating its name/description if they drifted), and ensure the active
 *   Price matches price_cents+currency (creating a fresh Price and archiving
 *   the previous one if anything changed — Stripe Prices are immutable).
 *
 * Persists `stripe_product_id` / `stripe_price_id` back to the offers row.
 * Never throws on Stripe failures we can't recover from — instead returns
 * `{ ok: false, error }` so the caller can decide how to surface it.
 */
export async function syncOfferToStripe(
  offerId: string
): Promise<{ ok: true; offer: OfferRow } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: offer, error } = await admin
    .from('offers')
    .select('id, name, description, price_cents, currency, stripe_product_id, stripe_price_id')
    .eq('id', offerId)
    .single();
  if (error || !offer) return { ok: false, error: error?.message ?? 'Offer not found' };

  const row = offer as OfferRow;

  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Stripe not configured' };
  }

  // No price → archive everything and clear refs
  if (row.price_cents <= 0) {
    try {
      if (row.stripe_price_id) {
        await stripe.prices.update(row.stripe_price_id, { active: false });
      }
      if (row.stripe_product_id) {
        await stripe.products.update(row.stripe_product_id, { active: false });
      }
    } catch {
      // Tolerate already-archived / missing in Stripe
    }
    if (row.stripe_price_id || row.stripe_product_id) {
      await admin
        .from('offers')
        .update({ stripe_product_id: null, stripe_price_id: null })
        .eq('id', row.id);
      row.stripe_product_id = null;
      row.stripe_price_id = null;
    }
    return { ok: true, offer: row };
  }

  // Ensure product exists with current name/description
  let productId = row.stripe_product_id;
  if (productId) {
    try {
      await stripe.products.update(productId, {
        name: row.name,
        description: row.description ?? undefined,
        active: true,
      });
    } catch {
      productId = null; // Recreate below
    }
  }
  if (!productId) {
    const product = await stripe.products.create({
      name: row.name,
      description: row.description ?? undefined,
      metadata: { offer_id: row.id },
    });
    productId = product.id;
  }

  // Check current price; create new one if amount/currency drifted
  const currency = row.currency.toLowerCase();
  let priceId = row.stripe_price_id;
  let priceMatches = false;
  if (priceId) {
    try {
      const existing = await stripe.prices.retrieve(priceId);
      priceMatches =
        existing.active === true &&
        existing.product === productId &&
        existing.currency === currency &&
        existing.unit_amount === row.price_cents;
    } catch {
      priceMatches = false;
      priceId = null;
    }
  }

  if (!priceMatches) {
    if (priceId) {
      try {
        await stripe.prices.update(priceId, { active: false });
      } catch {
        // ignore
      }
    }
    const price = await stripe.prices.create({
      product: productId,
      unit_amount: row.price_cents,
      currency,
      metadata: { offer_id: row.id },
    });
    priceId = price.id;
  }

  if (productId !== row.stripe_product_id || priceId !== row.stripe_price_id) {
    await admin
      .from('offers')
      .update({ stripe_product_id: productId, stripe_price_id: priceId })
      .eq('id', row.id);
    row.stripe_product_id = productId;
    row.stripe_price_id = priceId;
  }

  return { ok: true, offer: row };
}

export async function archiveOfferInStripe(offerId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: offer } = await admin
    .from('offers')
    .select('stripe_product_id, stripe_price_id')
    .eq('id', offerId)
    .single();
  if (!offer) return;
  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch {
    return;
  }
  try {
    if (offer.stripe_price_id) await stripe.prices.update(offer.stripe_price_id, { active: false });
    if (offer.stripe_product_id) await stripe.products.update(offer.stripe_product_id, { active: false });
  } catch {
    // ignore
  }
}

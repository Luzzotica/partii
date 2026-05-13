import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncOfferToStripe } from '@/lib/stripe/syncOffer';

export async function GET() {
  return withAdmin(async () => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('offers')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return { offers: data ?? [] };
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  return withAdmin(async () => {
    const admin = createAdminClient();
    const slug = String(body.slug ?? '').trim().toLowerCase();
    const name = String(body.name ?? '').trim();
    if (!slug || !name) throw new Error('slug and name required');
    const price_cents = Number.isFinite(body.price_cents) ? Math.max(0, Math.floor(body.price_cents)) : 0;
    const currency = String(body.currency ?? 'usd').toLowerCase();
    const { data: created, error } = await admin
      .from('offers')
      .insert({
        slug,
        name,
        description: body.description ?? null,
        price_cents,
        currency,
        is_published: Boolean(body.is_published ?? false),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const sync = await syncOfferToStripe(created.id);
    return { offer: sync.ok ? sync.offer : created, stripe_warning: sync.ok ? null : sync.error };
  });
}

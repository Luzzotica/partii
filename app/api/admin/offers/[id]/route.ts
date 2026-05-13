import { NextRequest } from 'next/server';
import { withAdmin } from '@/lib/api/adminGuard';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncOfferToStripe, archiveOfferInStripe } from '@/lib/stripe/syncOffer';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withAdmin(async () => {
    const admin = createAdminClient();
    const { data: offer, error } = await admin.from('offers').select('*').eq('id', id).single();
    if (error) throw new Error(error.message);
    const { data: links } = await admin
      .from('offer_courses')
      .select('offer_id, course_id, position')
      .eq('offer_id', id)
      .order('position');
    return { offer, courses: links ?? [] };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json();
  return withAdmin(async () => {
    const admin = createAdminClient();
    const patch: Record<string, unknown> = {};
    for (const k of ['slug', 'name', 'description', 'price_cents', 'currency', 'cover_image_url', 'is_published']) {
      if (k in body) patch[k] = body[k];
    }
    if (typeof patch.currency === 'string') patch.currency = patch.currency.toLowerCase();
    if (typeof patch.slug === 'string') patch.slug = patch.slug.toLowerCase();
    const { error } = await admin.from('offers').update(patch).eq('id', id);
    if (error) throw new Error(error.message);

    const sync = await syncOfferToStripe(id);
    if (!sync.ok) {
      const { data: offer } = await admin.from('offers').select('*').eq('id', id).single();
      return { offer, stripe_warning: sync.error };
    }
    return { offer: sync.offer, stripe_warning: null };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withAdmin(async () => {
    await archiveOfferInStripe(id);
    const admin = createAdminClient();
    const { error } = await admin.from('offers').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
}

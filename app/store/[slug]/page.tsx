import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { PurchaseForm } from './PurchaseForm';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

function formatPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export default async function StoreOfferPage({ params }: Ctx) {
  const { slug } = await params;
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();

  const offerQuery = await admin
    .from('offers')
    .select('id, slug, name, description, price_cents, currency, cover_image_url, is_published')
    .eq('slug', slug)
    .eq('is_published', true)
    .single();
  const offerErr = offerQuery.error;
  let offer = offerQuery.data;
  if (offerErr || !offer) {
    if (offerErr) console.error('[store/slug] offer query error (with cover):', offerErr);
    const fallback = await admin
      .from('offers')
      .select('id, slug, name, description, price_cents, currency, is_published')
      .eq('slug', slug)
      .eq('is_published', true)
      .single();
    if (fallback.error || !fallback.data) {
      if (fallback.error) console.error('[store/slug] fallback offer query error:', fallback.error);
      notFound();
    }
    offer = { ...fallback.data, cover_image_url: null };
  }

  const { data: links } = await admin
    .from('offer_courses')
    .select('course_id, position, course:courses!inner(id, slug, title, subtitle)')
    .eq('offer_id', offer.id)
    .order('position');

  type LinkRow = {
    course_id: string;
    position: number;
    course: { id: string; slug: string; title: string; subtitle: string | null } | null;
  };
  const courses = ((links ?? []) as unknown as LinkRow[])
    .map((l) => l.course)
    .filter((c): c is NonNullable<typeof c> => !!c);

  if (user) {
    const courseIds = courses.map((c) => c.id);
    if (courseIds.length) {
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('course_id')
        .eq('user_id', user.id)
        .in('course_id', courseIds);
      const enrolledIds = new Set((enrollments ?? []).map((e) => e.course_id));
      const allEnrolled =
        courseIds.length > 0 && courseIds.every((id) => enrolledIds.has(id));
      if (allEnrolled) redirect('/learn');
    }
  }

  const priceLabel = offer.price_cents > 0 ? formatPrice(offer.price_cents, offer.currency) : 'Free';

  return (
    <div className="space-y-6">
      <Link href="/store" className="text-sm text-white/60 hover:text-white">← Back to store</Link>
      <div className="grid lg:grid-cols-2 gap-8">
          <section className="space-y-4">
            {offer.cover_image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={offer.cover_image_url}
                alt=""
                className="w-full rounded-xl border border-white/10 object-cover aspect-video"
              />
            )}
            <h1 className="text-3xl font-semibold">{offer.name}</h1>
            <div className="text-2xl font-mono">{priceLabel}</div>
            {offer.description && (
              <p className="text-white/70 whitespace-pre-line">{offer.description}</p>
            )}

            {courses.length > 0 && (
              <div className="space-y-2 pt-4">
                <div className="text-xs uppercase tracking-wider text-white/50">Includes</div>
                <ul className="space-y-2">
                  {courses.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-lg border border-white/10 bg-white/5 px-4 py-2"
                    >
                      <div className="font-medium">{c.title}</div>
                      {c.subtitle && <div className="text-sm text-white/60">{c.subtitle}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section>
            {!user ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-white/80">
                <p className="mb-3">Sign in to purchase this offer.</p>
                <Link
                  href="/?signin=1"
                  className="inline-block px-4 py-2 bg-[#3742fa] hover:bg-[#5a67fa] rounded text-sm font-semibold"
                >
                  Sign in
                </Link>
              </div>
            ) : offer.price_cents <= 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-white/70">
                This offer isn&apos;t set up for purchase. Contact the admin for access.
              </div>
            ) : (
              <PurchaseForm
                offerSlug={offer.slug}
                offerName={offer.name}
                priceLabel={priceLabel}
              />
            )}
        </section>
      </div>
    </div>
  );
}

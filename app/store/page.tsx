import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

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

export default async function StorePage() {
  const admin = createAdminClient();

  const offersQuery = await admin
    .from('offers')
    .select('id, slug, name, description, price_cents, currency, cover_image_url, is_published')
    .eq('is_published', true)
    .order('created_at', { ascending: false });
  const error = offersQuery.error;
  let offers = offersQuery.data;
  if (error) {
    console.error('[store] failed to load offers (with cover_image_url):', error);
    // Retry without cover_image_url in case the migration hasn't been applied yet
    const fallback = await admin
      .from('offers')
      .select('id, slug, name, description, price_cents, currency, is_published')
      .eq('is_published', true)
      .order('created_at', { ascending: false });
    if (fallback.error) {
      console.error('[store] fallback also failed:', fallback.error);
    } else {
      offers = (fallback.data ?? []).map((o) => ({ ...o, cover_image_url: null }));
    }
  }

  const list = offers ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold">Store</h1>
        <p className="text-white/60 mt-2 max-w-2xl">
          Buy access to courses and bundles. Each offer grants you membership in the courses listed on its page.
        </p>
      </div>

      {list.length === 0 ? (
        <p className="text-white/50 text-sm">No offers available right now. Check back soon.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {list.map((o) => (
            <Link
              key={o.id}
              href={`/store/${o.slug}`}
              className="group block rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors overflow-hidden"
            >
              {o.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={o.cover_image_url} alt="" className="w-full h-44 object-cover" />
              ) : (
                <div className="w-full h-44 bg-gradient-to-br from-[#3742fa] to-[#5a67fa]" />
              )}
              <div className="p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{o.name}</h3>
                  <span className="text-sm font-mono text-white/80">
                    {o.price_cents > 0 ? formatPrice(o.price_cents, o.currency) : 'Free'}
                  </span>
                </div>
                {o.description && (
                  <p className="text-sm text-white/60 line-clamp-2">{o.description}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

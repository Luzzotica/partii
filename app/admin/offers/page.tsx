import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { CreateOfferButton } from './CreateOfferForm';

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

export default async function AdminOffersPage() {
  const admin = createAdminClient();
  const { data: offers } = await admin
    .from('offers')
    .select('id, slug, name, price_cents, currency, is_published, stripe_price_id, created_at')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Offers</h1>
        <CreateOfferButton />
      </div>

      <p className="text-sm text-white/60 max-w-2xl">
        Offers are the things you charge money for. Each offer can grant access to one or more courses.
        Stripe Product + Price IDs are created and updated automatically when you save.
      </p>

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-white/60">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Slug</th>
              <th className="px-4 py-2 font-medium">Price</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Stripe</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(offers ?? []).map((o) => (
              <tr key={o.id} className="border-t border-white/5">
                <td className="px-4 py-2">{o.name}</td>
                <td className="px-4 py-2 text-white/60 font-mono text-xs">{o.slug}</td>
                <td className="px-4 py-2">{formatPrice(o.price_cents, o.currency)}</td>
                <td className="px-4 py-2">
                  {o.is_published ? (
                    <span className="text-emerald-400 text-xs">Published</span>
                  ) : (
                    <span className="text-white/40 text-xs">Draft</span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-white/60 font-mono">
                  {o.stripe_price_id ? '✓' : '—'}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/offers/${o.id}`} className="text-[#5a67fa] hover:underline">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {(!offers || offers.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-white/40">
                  No offers yet — create your first above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

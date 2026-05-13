import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { OfferEditor } from './OfferEditor';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export default async function AdminOfferEditPage({ params }: Ctx) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: offer } = await admin.from('offers').select('*').eq('id', id).single();
  if (!offer) notFound();

  const { data: links } = await admin
    .from('offer_courses')
    .select('course_id, position')
    .eq('offer_id', id)
    .order('position');
  const linkedIds = (links ?? []).map((l) => l.course_id as string);

  const { data: allCourses } = await admin
    .from('courses')
    .select('id, slug, title')
    .order('title');

  return (
    <div className="space-y-6">
      <Link href="/admin/offers" className="text-sm text-white/60 hover:text-white">
        ← All offers
      </Link>
      <h1 className="text-2xl font-semibold">{offer.name}</h1>
      <OfferEditor offer={offer} linkedCourseIds={linkedIds} allCourses={allCourses ?? []} />
    </div>
  );
}

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LearnHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let enrolled: CourseCard[] = [];
  if (user) {
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('course_id')
      .eq('user_id', user.id);
    const ids = (enrollments ?? []).map((e) => e.course_id as string);
    if (ids.length) {
      const { data: courses } = await supabase
        .from('courses')
        .select('id, slug, title, subtitle, cover_image_url, is_free')
        .in('id', ids)
        .eq('is_published', true);
      enrolled = (courses ?? []) as CourseCard[];
    }
  }

  return (
    <div className="space-y-12">
      {!user && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6">
          <p className="text-white/80">
            Sign in from the top right to access your courses.
          </p>
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-semibold">My Courses</h2>
        </div>
        {user && enrolled.length === 0 && (
          <p className="text-white/60 text-sm">
            You&apos;re not enrolled in anything yet. Visit the store to grab an offer.
          </p>
        )}
        {enrolled.length > 0 && <CourseGrid courses={enrolled} />}
      </section>

      <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#3742fa]/20 to-[#5a67fa]/10 p-8 text-center space-y-4">
        <h3 className="text-2xl font-semibold">Looking for more courses?</h3>
        <p className="text-white/70 max-w-xl mx-auto">
          The store is where new courses, bundles, and one-off offers live.
        </p>
        <Link
          href="/store"
          className="inline-block px-6 py-3 bg-[#3742fa] hover:bg-[#5a67fa] rounded-lg font-semibold transition-colors"
        >
          Visit the store →
        </Link>
      </section>
    </div>
  );
}

type CourseCard = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  cover_image_url: string | null;
  is_free: boolean;
};

function CourseGrid({ courses }: { courses: CourseCard[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {courses.map((c) => (
        <Link
          key={c.id}
          href={`/learn/${c.slug}`}
          className="block rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors overflow-hidden"
        >
          {c.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.cover_image_url} alt="" className="w-full h-40 object-cover" />
          ) : (
            <div className="w-full h-40 bg-gradient-to-br from-[#3742fa] to-[#5a67fa]" />
          )}
          <div className="p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="font-semibold">{c.title}</h3>
              {c.is_free && (
                <span className="text-[0.65rem] uppercase tracking-wider bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">
                  Free
                </span>
              )}
            </div>
            {c.subtitle && <p className="text-sm text-white/60">{c.subtitle}</p>}
          </div>
        </Link>
      ))}
    </div>
  );
}

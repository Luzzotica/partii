import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { computeCoursePercent, isLessonComplete } from '@/lib/learn/progress';
import { BuyButton } from './BuyButton';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ courseSlug: string }> };

export default async function CourseOutlinePage({ params }: Ctx) {
  const { courseSlug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: course } = await supabase
    .from('courses')
    .select('id, slug, title, subtitle, description, is_published, is_free')
    .eq('slug', courseSlug)
    .single();
  if (!course) notFound();

  const { data: offerLinks } = await supabase
    .from('offer_courses')
    .select('offer_id')
    .eq('course_id', course.id);
  const offerIds = (offerLinks ?? []).map((l) => l.offer_id as string);
  const { data: offersForCourse } = offerIds.length
    ? await supabase
        .from('offers')
        .select('id, slug, name, description, price_cents, currency, is_published')
        .in('id', offerIds)
        .eq('is_published', true)
    : { data: [] as Array<{ id: string; slug: string; name: string; description: string | null; price_cents: number; currency: string; is_published: boolean }> };

  let enrolled = false;
  if (user) {
    const { data: e } = await supabase
      .from('enrollments')
      .select('id')
      .eq('user_id', user.id)
      .eq('course_id', course.id)
      .maybeSingle();
    enrolled = !!e;
  }

  const { data: modules } = await supabase
    .from('modules')
    .select('id, title, position')
    .eq('course_id', course.id)
    .order('position');
  const moduleIds = (modules ?? []).map((m) => m.id);

  const { data: lessons } = moduleIds.length
    ? await supabase
        .from('lessons')
        .select('id, module_id, title, position, mux_playback_id')
        .in('module_id', moduleIds)
        .order('position')
    : { data: [] as Array<{ id: string; module_id: string; title: string; position: number; mux_playback_id: string | null }> };

  const progressMap = new Map<string, { completed: boolean; watch_percent: number }>();
  if (user && enrolled && lessons?.length) {
    const { data: progress } = await supabase
      .from('lesson_progress')
      .select('lesson_id, completed, watch_percent')
      .eq('user_id', user.id)
      .eq('course_id', course.id);
    for (const p of progress ?? []) progressMap.set(p.lesson_id, p);
  }

  const percent = enrolled ? computeCoursePercent(lessons ?? [], progressMap) : 0;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/learn" className="text-sm text-white/60 hover:text-white">← All courses</Link>
        <h1 className="text-3xl font-semibold mt-2">{course.title}</h1>
        {course.subtitle && <p className="text-white/70 mt-1">{course.subtitle}</p>}
        {course.description && <p className="text-white/60 mt-3 max-w-2xl whitespace-pre-line">{course.description}</p>}
      </div>

      {!user && (
        <p className="text-white/60">Sign in to enroll and start learning.</p>
      )}

      {user && !enrolled && (
        <EnrollmentCTA
          courseId={course.id}
          isFree={course.is_free}
          offers={offersForCourse ?? []}
        />
      )}

      {enrolled && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span>Your progress</span>
            <span className="text-white/60">{percent}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      <div className="space-y-4">
        {(modules ?? []).map((m) => (
          <div key={m.id} className="rounded-xl border border-white/10 bg-white/5">
            <div className="px-4 py-3 border-b border-white/10 font-medium">{m.title}</div>
            <ul>
              {(lessons ?? [])
                .filter((l) => l.module_id === m.id)
                .map((l) => {
                  const done = isLessonComplete(l, progressMap.get(l.id));
                  return (
                    <li key={l.id} className="border-b border-white/5 last:border-0">
                      {enrolled ? (
                        <Link
                          href={`/learn/${course.slug}/${l.id}`}
                          className="flex items-center justify-between px-4 py-2 text-sm hover:bg-white/5"
                        >
                          <span className="flex items-center gap-2">
                            <span className={`w-4 h-4 rounded-full border ${done ? 'bg-emerald-400 border-emerald-400' : 'border-white/30'}`} />
                            {l.title}
                          </span>
                          {l.mux_playback_id && (
                            <span className="text-[0.65rem] uppercase tracking-wider text-white/40">Video</span>
                          )}
                        </Link>
                      ) : (
                        <div className="flex items-center justify-between px-4 py-2 text-sm text-white/40">
                          <span>{l.title}</span>
                          {l.mux_playback_id && <span className="text-[0.65rem] uppercase tracking-wider">Video</span>}
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
        {(!modules || modules.length === 0) && (
          <p className="text-white/40">No lessons published yet.</p>
        )}
      </div>
    </div>
  );
}

type OfferCardData = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
};

function EnrollmentCTA({
  courseId,
  isFree,
  offers,
}: {
  courseId: string;
  isFree: boolean;
  offers: OfferCardData[];
}) {
  const buyable = offers.filter((o) => o.price_cents > 0);
  return (
    <div className="space-y-4">
      {isFree && (
        <form action="/api/learn/enroll-free" method="POST">
          <input type="hidden" name="course_id" value={courseId} />
          <button
            type="submit"
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 rounded-lg text-sm font-semibold"
          >
            Enroll for free
          </button>
        </form>
      )}
      {buyable.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {buyable.map((o) => (
            <div key={o.id} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
              <div className="font-semibold">{o.name}</div>
              {o.description && <p className="text-sm text-white/60">{o.description}</p>}
              <div className="text-lg">{formatPrice(o.price_cents, o.currency)}</div>
              <BuyButton offerSlug={o.slug} label={`Buy ${o.name}`} />
            </div>
          ))}
        </div>
      )}
      {!isFree && buyable.length === 0 && (
        <p className="text-white/60 text-sm">Ask the admin for access.</p>
      )}
    </div>
  );
}

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

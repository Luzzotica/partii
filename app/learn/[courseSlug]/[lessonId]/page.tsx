import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LessonView } from './LessonView';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ courseSlug: string; lessonId: string }> };

export default async function LessonViewerPage({ params }: Ctx) {
  const { courseSlug, lessonId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/learn/${courseSlug}`);

  const { data: course } = await supabase
    .from('courses')
    .select('id, slug, title')
    .eq('slug', courseSlug)
    .single();
  if (!course) notFound();

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id')
    .eq('user_id', user.id)
    .eq('course_id', course.id)
    .maybeSingle();
  if (!enrollment) redirect(`/learn/${courseSlug}`);

  const { data: lesson } = await supabase.from('lessons').select('*').eq('id', lessonId).single();
  if (!lesson) notFound();

  // Sibling lessons for prev/next navigation
  const { data: module_ } = await supabase
    .from('modules')
    .select('id, course_id')
    .eq('id', lesson.module_id)
    .single();
  if (!module_ || module_.course_id !== course.id) notFound();

  const { data: courseModules } = await supabase
    .from('modules')
    .select('id, position')
    .eq('course_id', course.id)
    .order('position');
  const moduleIds = (courseModules ?? []).map((m) => m.id);
  const { data: allLessons } = await supabase
    .from('lessons')
    .select('id, module_id, title, position')
    .in('module_id', moduleIds)
    .order('module_id')
    .order('position');

  // Sort lessons by their module position then lesson position
  const modulePosById = new Map((courseModules ?? []).map((m) => [m.id, m.position]));
  const ordered = [...(allLessons ?? [])].sort((a, b) => {
    const ma = modulePosById.get(a.module_id) ?? 0;
    const mb = modulePosById.get(b.module_id) ?? 0;
    if (ma !== mb) return ma - mb;
    return a.position - b.position;
  });
  const idx = ordered.findIndex((l) => l.id === lesson.id);
  const prev = idx > 0 ? ordered[idx - 1] : null;
  const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null;

  const { data: progress } = await supabase
    .from('lesson_progress')
    .select('completed, watch_seconds, watch_percent')
    .eq('user_id', user.id)
    .eq('lesson_id', lesson.id)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div className="text-sm text-white/60">
        <Link href={`/learn/${courseSlug}`} className="hover:text-white">← {course.title}</Link>
      </div>

      <LessonView lesson={lesson} courseId={course.id} initialProgress={progress ?? null} />

      <div className="flex items-center justify-between pt-4 border-t border-white/10">
        {prev ? (
          <Link href={`/learn/${courseSlug}/${prev.id}`} className="text-sm text-white/70 hover:text-white">
            ← {prev.title}
          </Link>
        ) : <span />}
        {next ? (
          <Link href={`/learn/${courseSlug}/${next.id}`} className="text-sm text-white/70 hover:text-white">
            {next.title} →
          </Link>
        ) : <span />}
      </div>
    </div>
  );
}

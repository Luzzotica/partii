import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const lesson_id = String(body.lesson_id ?? '');
  const course_id = String(body.course_id ?? '');
  if (!lesson_id || !course_id) {
    return NextResponse.json({ error: 'lesson_id and course_id required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify enrollment
  const { data: enrollment } = await admin
    .from('enrollments')
    .select('id')
    .eq('user_id', user.id)
    .eq('course_id', course_id)
    .maybeSingle();
  if (!enrollment) return NextResponse.json({ error: 'Not enrolled' }, { status: 403 });

  // Verify lesson belongs to course
  const { data: lesson } = await admin
    .from('lessons')
    .select('id, module_id, video_duration_seconds, modules:module_id(course_id)')
    .eq('id', lesson_id)
    .single();
  type LessonRow = { id: string; module_id: string; video_duration_seconds: number | null; modules: { course_id: string } | { course_id: string }[] | null };
  const lessonRow = lesson as LessonRow | null;
  const lessonCourseId = Array.isArray(lessonRow?.modules)
    ? lessonRow?.modules[0]?.course_id
    : lessonRow?.modules?.course_id;
  if (!lessonRow || lessonCourseId !== course_id) {
    return NextResponse.json({ error: 'Lesson not in course' }, { status: 400 });
  }

  // Read current progress (so we never regress watch_seconds backwards)
  const { data: existing } = await admin
    .from('lesson_progress')
    .select('completed, watch_seconds, watch_percent')
    .eq('user_id', user.id)
    .eq('lesson_id', lesson_id)
    .maybeSingle();

  const incomingSeconds = Number.isFinite(body.watch_seconds)
    ? Math.max(0, Math.floor(Number(body.watch_seconds)))
    : null;
  const watch_seconds = Math.max(existing?.watch_seconds ?? 0, incomingSeconds ?? 0);

  const duration = lessonRow.video_duration_seconds ?? 0;
  const watch_percent = duration > 0
    ? Math.min(100, Math.round((watch_seconds / duration) * 100))
    : (existing?.watch_percent ?? 0);

  const wasCompleted = existing?.completed ?? false;
  const completed = body.completed === true || wasCompleted || (duration > 0 && watch_percent >= 90);
  const completed_at = completed && !wasCompleted ? new Date().toISOString() : null;

  const upsert = {
    user_id: user.id,
    lesson_id,
    course_id,
    completed,
    watch_seconds,
    watch_percent,
    ...(completed_at ? { completed_at } : {}),
  };

  const { error } = await admin
    .from('lesson_progress')
    .upsert(upsert, { onConflict: 'user_id,lesson_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, completed, watch_seconds, watch_percent });
}

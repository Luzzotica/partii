import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { LessonEditor } from './LessonEditor';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; lessonId: string }> };

export default async function AdminLessonEditPage({ params }: Ctx) {
  const { id, lessonId } = await params;
  const admin = createAdminClient();

  const { data: lesson } = await admin.from('lessons').select('*').eq('id', lessonId).single();
  if (!lesson) notFound();

  const { data: module_ } = await admin
    .from('modules')
    .select('id, title, course_id')
    .eq('id', lesson.module_id)
    .single();

  if (!module_ || module_.course_id !== id) notFound();

  return (
    <div className="space-y-6">
      <div className="text-sm text-white/60">
        <Link href={`/admin/courses/${id}`} className="hover:text-white">← Back to course</Link>
        <span className="mx-2 text-white/30">/</span>
        <span>{module_.title}</span>
      </div>
      <LessonEditor lesson={lesson} courseId={id} />
    </div>
  );
}

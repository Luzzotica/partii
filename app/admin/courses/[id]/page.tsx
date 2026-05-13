import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { CourseEditor } from './CourseEditor';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export default async function AdminCourseEditPage({ params }: Ctx) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: course } = await admin.from('courses').select('*').eq('id', id).single();
  if (!course) notFound();

  const { data: modules } = await admin
    .from('modules')
    .select('*')
    .eq('course_id', id)
    .order('position');

  const moduleIds = (modules ?? []).map((m) => m.id);
  const { data: lessons } = moduleIds.length
    ? await admin.from('lessons').select('id, module_id, title, position, mux_playback_id').in('module_id', moduleIds).order('position')
    : { data: [] as Array<{ id: string; module_id: string; title: string; position: number; mux_playback_id: string | null }> };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-sm text-white/60">
        <Link href="/admin/courses" className="hover:text-white">← Courses</Link>
      </div>
      <CourseEditor
        course={course}
        modules={modules ?? []}
        lessons={lessons ?? []}
      />
    </div>
  );
}

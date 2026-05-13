import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { CreateCourseForm } from './CreateCourseForm';

export const dynamic = 'force-dynamic';

export default async function AdminCoursesPage() {
  const admin = createAdminClient();
  const { data: courses } = await admin
    .from('courses')
    .select('id, slug, title, is_published, is_free, created_at')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Courses</h1>
      </div>

      <CreateCourseForm />

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-white/60">
            <tr>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Slug</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Pricing</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(courses ?? []).map((c) => (
              <tr key={c.id} className="border-t border-white/5">
                <td className="px-4 py-2">{c.title}</td>
                <td className="px-4 py-2 text-white/60 font-mono text-xs">{c.slug}</td>
                <td className="px-4 py-2">
                  {c.is_published ? (
                    <span className="text-emerald-400 text-xs">Published</span>
                  ) : (
                    <span className="text-white/40 text-xs">Draft</span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-white/60">
                  {c.is_free ? 'Free' : 'Paid'}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/admin/courses/${c.id}`}
                    className="text-[#5a67fa] hover:underline"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {(!courses || courses.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-white/40">
                  No courses yet — create your first above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { createAdminClient } from '@/lib/supabase/admin';
import { UsersTable, type AdminUserRow, type AdminCourseOption } from './UsersTable';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const admin = createAdminClient();

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, display_name, is_admin, created_at')
    .order('created_at', { ascending: false });

  const profileIds = (profiles ?? []).map((p) => p.id);

  const { data: enrollments } = profileIds.length
    ? await admin
        .from('enrollments')
        .select('id, user_id, course_id, source, created_at')
        .in('user_id', profileIds)
    : { data: [] as Array<{ id: string; user_id: string; course_id: string; source: string; created_at: string }> };

  const { data: courses } = await admin
    .from('courses')
    .select('id, title')
    .order('title');

  // Lookup auth.users emails (admin only)
  const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 200 });
  const emailById = new Map<string, string>();
  for (const u of authUsers?.users ?? []) {
    if (u.email) emailById.set(u.id, u.email);
  }

  const titleById = new Map((courses ?? []).map((c) => [c.id, c.title]));

  const rows: AdminUserRow[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: emailById.get(p.id) ?? '',
    display_name: p.display_name,
    is_admin: p.is_admin,
    created_at: p.created_at,
    enrollments: (enrollments ?? [])
      .filter((e) => e.user_id === p.id)
      .map((e) => ({
        id: e.id,
        course_id: e.course_id,
        course_title: titleById.get(e.course_id) ?? '(deleted)',
        source: e.source,
      })),
  }));

  const courseOptions: AdminCourseOption[] = (courses ?? []).map((c) => ({
    id: c.id,
    title: c.title,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      <UsersTable rows={rows} courses={courseOptions} />
    </div>
  );
}

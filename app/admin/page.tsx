import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const admin = createAdminClient();

  const [{ count: courseCount }, { count: enrollmentCount }, { count: userCount }] =
    await Promise.all([
      admin.from('courses').select('*', { count: 'exact', head: true }),
      admin.from('enrollments').select('*', { count: 'exact', head: true }),
      admin.from('profiles').select('*', { count: 'exact', head: true }),
    ]);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Courses" value={courseCount ?? 0} />
        <Stat label="Enrollments" value={enrollmentCount ?? 0} />
        <Stat label="Users" value={userCount ?? 0} />
      </div>
      <div className="flex gap-3">
        <Link
          href="/admin/courses"
          className="px-4 py-2 rounded-lg bg-[#3742fa] hover:bg-[#5a67fa] text-sm"
        >
          Manage courses
        </Link>
        <Link
          href="/admin/users"
          className="px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 text-sm"
        >
          Manage users
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="text-xs uppercase tracking-wider text-white/50">{label}</div>
      <div className="text-3xl font-semibold mt-1">{value}</div>
    </div>
  );
}

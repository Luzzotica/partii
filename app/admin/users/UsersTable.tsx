'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type AdminCourseOption = { id: string; title: string };

export type AdminUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  created_at: string;
  enrollments: Array<{ id: string; course_id: string; course_title: string; source: string }>;
};

export function UsersTable({ rows, courses }: { rows: AdminUserRow[]; courses: AdminCourseOption[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [grantBusy, setGrantBusy] = useState<string | null>(null);

  const filtered = rows.filter((r) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      r.email.toLowerCase().includes(f) ||
      (r.display_name ?? '').toLowerCase().includes(f)
    );
  });

  async function grant(userId: string, courseId: string) {
    if (!courseId) return;
    setGrantBusy(userId);
    const res = await fetch('/api/admin/enrollments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: userId, course_id: courseId }),
    });
    setGrantBusy(null);
    if (res.ok) router.refresh();
    else {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? 'Failed to grant');
    }
  }

  async function revoke(enrollmentId: string) {
    if (!confirm('Revoke this enrollment?')) return;
    const res = await fetch(`/api/admin/enrollments/${enrollmentId}`, { method: 'DELETE' });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      <input
        placeholder="Search by email or name…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full sm:w-80 px-3 py-2 bg-black/30 border border-white/10 rounded text-sm"
      />

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-white/60">
            <tr>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Enrollments</th>
              <th className="px-4 py-2 font-medium w-[260px]">Grant access</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <UserRowComp
                key={r.id}
                row={r}
                courses={courses}
                onGrant={grant}
                onRevoke={revoke}
                busy={grantBusy === r.id}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-white/40">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRowComp({
  row,
  courses,
  onGrant,
  onRevoke,
  busy,
}: {
  row: AdminUserRow;
  courses: AdminCourseOption[];
  onGrant: (userId: string, courseId: string) => void;
  onRevoke: (enrollmentId: string) => void;
  busy: boolean;
}) {
  const enrolledIds = new Set(row.enrollments.map((e) => e.course_id));
  const available = courses.filter((c) => !enrolledIds.has(c.id));
  const [pick, setPick] = useState('');

  return (
    <tr className="border-t border-white/5 align-top">
      <td className="px-4 py-3">
        <div className="font-medium">{row.display_name || '(no name)'}</div>
        <div className="text-xs text-white/50">{row.email}</div>
        {row.is_admin && (
          <div className="text-[0.65rem] uppercase tracking-wider text-[#ffa502] mt-1">Admin</div>
        )}
      </td>
      <td className="px-4 py-3">
        {row.enrollments.length === 0 ? (
          <span className="text-white/40 text-xs">None</span>
        ) : (
          <ul className="space-y-1">
            {row.enrollments.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-xs">
                <span>{e.course_title}</span>
                <span className="text-white/40">({e.source})</span>
                <button
                  onClick={() => onRevoke(e.id)}
                  className="text-red-400 hover:underline ml-auto"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="flex-1 px-2 py-1.5 bg-black/30 border border-white/10 rounded text-xs"
          >
            <option value="">Choose course…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
          <button
            disabled={!pick || busy}
            onClick={() => {
              onGrant(row.id, pick);
              setPick('');
            }}
            className="px-3 py-1.5 bg-[#3742fa] hover:bg-[#5a67fa] rounded text-xs disabled:opacity-50"
          >
            {busy ? '…' : 'Grant'}
          </button>
        </div>
      </td>
    </tr>
  );
}

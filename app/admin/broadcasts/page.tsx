import { createAdminClient } from '@/lib/supabase/admin';
import { BroadcastForm } from './BroadcastForm';

export const dynamic = 'force-dynamic';

export default async function AdminBroadcastsPage() {
  const admin = createAdminClient();
  const [{ data: courses }, { data: log }] = await Promise.all([
    admin.from('courses').select('id, title').order('title'),
    admin
      .from('email_log')
      .select('id, kind, subject, status, to_email, sent_at')
      .eq('kind', 'broadcast')
      .order('sent_at', { ascending: false })
      .limit(50),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Broadcasts</h1>
      <BroadcastForm courses={(courses ?? []) as never} />

      <section>
        <h2 className="text-lg font-semibold mb-3">Recent broadcasts</h2>
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-left text-white/60">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">To</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(log ?? []).map((row) => (
                <tr key={row.id} className="border-t border-white/5">
                  <td className="px-4 py-2 text-white/60 text-xs">{new Date(row.sent_at).toLocaleString()}</td>
                  <td className="px-4 py-2">{row.subject}</td>
                  <td className="px-4 py-2 text-white/60 text-xs">{row.to_email}</td>
                  <td className={`px-4 py-2 text-xs ${row.status === 'sent' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {row.status}
                  </td>
                </tr>
              ))}
              {(!log || log.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-white/40">
                    No broadcasts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

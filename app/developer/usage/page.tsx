import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";

const admin = createAdminClient();

export default async function DeveloperUsagePage() {
  const auth = await requireUser();
  if (!auth.ok) return null;

  // All projects belonging to this user.
  const { data: projects } = await admin
    .from("projects")
    .select("id")
    .eq("user_id", auth.user.userId);
  const projectIds = (projects ?? []).map((p) => p.id);

  // All keys under those projects.
  let keyIds: string[] = [];
  if (projectIds.length > 0) {
    const { data: keys } = await admin
      .from("api_keys")
      .select("id")
      .in("project_id", projectIds);
    keyIds = (keys ?? []).map((k) => k.id);
  }

  let rows: { event_type: string; day: string; count: number }[] = [];
  if (keyIds.length > 0) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await admin
      .from("usage_events")
      .select("event_type, created_at")
      .in("api_key_id", keyIds)
      .gte("created_at", since)
      .limit(10000);
    const acc: Record<string, number> = {};
    for (const r of data ?? []) {
      const day = r.created_at.slice(0, 10);
      const k = `${r.event_type}\t${day}`;
      acc[k] = (acc[k] ?? 0) + 1;
    }
    rows = Object.entries(acc)
      .map(([k, count]) => {
        const [event_type, day] = k.split("\t");
        return { event_type, day, count };
      })
      .sort((a, b) => (b.day.localeCompare(a.day) || a.event_type.localeCompare(b.event_type)));
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Usage (last 30 days)</h1>
      <div className="rounded border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-white/60">
            <tr>
              <th className="p-3">Day</th>
              <th className="p-3">Event</th>
              <th className="p-3 text-right">Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={3} className="p-4 text-center text-white/40">No events recorded yet.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/5">
                <td className="p-3">{r.day}</td>
                <td className="p-3 font-mono text-xs">{r.event_type}</td>
                <td className="p-3 text-right">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

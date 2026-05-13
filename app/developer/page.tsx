import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDeveloperFromCookie } from "@/lib/api/developerAuth";

const admin = createAdminClient();

export default async function DeveloperDashboardPage() {
  const dev = await getDeveloperFromCookie();
  if (!dev) return null;

  const { data: keys } = await admin
    .from("api_keys")
    .select("id")
    .eq("developer_id", dev.developerId)
    .is("revoked_at", null);

  const apiKeyIds = (keys ?? []).map((k) => k.id);

  let lobbyCount = 0;
  let sessionCount = 0;
  let usageCount = 0;
  if (apiKeyIds.length > 0) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [{ count: lc }, { count: sc }, { count: uc }] = await Promise.all([
      admin.from("mp_lobbies").select("id", { count: "exact", head: true }).in("api_key_id", apiKeyIds),
      admin.from("party_sessions").select("id", { count: "exact", head: true }).in("api_key_id", apiKeyIds),
      admin.from("usage_events").select("id", { count: "exact", head: true }).in("api_key_id", apiKeyIds).gte("created_at", since),
    ]);
    lobbyCount = lc ?? 0;
    sessionCount = sc ?? 0;
    usageCount = uc ?? 0;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome{dev.displayName ? `, ${dev.displayName}` : ""}</h1>
        <p className="text-white/60 text-sm">Build multiplayer experiences with WebRTC lobbies.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Active API keys" value={apiKeyIds.length} />
        <Stat label="Lobbies created" value={lobbyCount} />
        <Stat label="Sessions created" value={sessionCount} />
      </div>

      <div className="rounded border border-white/10 p-4 bg-white/[0.02]">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Usage events (last 30 days)</div>
            <div className="text-3xl mt-1">{usageCount}</div>
          </div>
          <Link href="/developer/usage" className="text-blue-400 hover:underline text-sm">View detail →</Link>
        </div>
      </div>

      {apiKeyIds.length === 0 && (
        <div className="rounded border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm">
          You don&apos;t have any API keys yet. <Link href="/developer/keys" className="text-yellow-300 underline">Create one</Link> to start using the multiplayer API.
        </div>
      )}

      <div className="rounded border border-white/10 p-4 bg-white/[0.02] text-sm space-y-2">
        <div className="font-medium">Quick start</div>
        <pre className="bg-black/40 rounded p-3 overflow-x-auto text-xs">{`curl -X POST https://YOUR_HOST/api/mp/lobbies \\
  -H "X-API-Key: $MPK_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"game_id":"my-game","display_name":"Test","host_screen_session_id":"...","host_screen_secret":"..."}'`}</pre>
        <div className="text-white/60">Create a party_session first via <code>/api/party/sessions</code> to get a host_screen_session_id + host_secret, then create the multiplayer lobby on top of it.</div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-white/10 p-4 bg-white/[0.02]">
      <div className="text-white/60 text-xs uppercase tracking-wide">{label}</div>
      <div className="text-3xl mt-1">{value}</div>
    </div>
  );
}

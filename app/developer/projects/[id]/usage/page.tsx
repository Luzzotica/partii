import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { loadProjectUsage } from "@/lib/developer/projectUsage";
import { UsageTables } from "@/components/developer/UsageTables";

const admin = createAdminClient();

export default async function ProjectUsagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return null;

  const { data: project } = await admin
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .eq("user_id", auth.user.userId)
    .maybeSingle();
  if (!project) notFound();

  const { rows, turnRows, healthRows } = await loadProjectUsage(admin, project.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usage (last 30 days)</h1>
        <p className="text-white/60 text-sm mt-1">
          Lobbii multiplayer telemetry for <span className="text-white/80">{project.name}</span>{" "}
          only — not account-wide.
        </p>
      </div>
      <UsageTables rows={rows} turnRows={turnRows} healthRows={healthRows} />
    </div>
  );
}

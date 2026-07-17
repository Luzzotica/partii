import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ProjectKeysManager } from "../ProjectKeysManager";
import { PlanCard } from "../PlanCard";
import { planLimits, accountPlan } from "@/lib/billing/plans";
import { relayCapStatus } from "@/lib/billing/relayCap";

const admin = createAdminClient();

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return null;

  const { data: project } = await admin
    .from("projects")
    .select("id, name, slug, plan, relay_included_gb")
    .eq("id", id)
    .eq("user_id", auth.user.userId)
    .maybeSingle();
  if (!project) notFound();

  const plan = await accountPlan(admin, auth.user.userId);
  const cap = await relayCapStatus(admin, { ...project, plan });
  const limits = planLimits(plan);

  const { data: keys } = await admin
    .from("api_keys")
    .select("id, key_prefix, name, created_at, last_used_at, revoked_at")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-white/60 text-sm mt-1">
          Lobbii multiplayer keys and relay plan for this Partii project.{" "}
          <Link href="/docs" className="text-blue-300 hover:underline">
            Multiplayer docs →
          </Link>
        </p>
      </div>
      <ProjectKeysManager projectId={project.id} initial={keys ?? []} />
      <PlanCard
        info={{
          projectId: project.id,
          plan,
          relayIncludedGb: project.relay_included_gb ?? 5,
          relayUsedGb: cap.usedGb,
          limits,
        }}
      />
    </div>
  );
}

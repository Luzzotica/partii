import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ProjectKeysManager } from "./ProjectKeysManager";
import { ProjectSettingsManager } from "./ProjectSettingsManager";
import { PlanCard } from "./PlanCard";
import { PlayersPanel } from "./PlayersPanel";
import { planLimits, accountPlan } from "@/lib/billing/plans";
import { relayCapStatus } from "@/lib/billing/relayCap";

const admin = createAdminClient();

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return null;

  const { data: project } = await admin
    .from("projects")
    .select(
      "id, name, slug, created_at, allowed_origins, require_session_tokens, steam_app_id, plan, relay_included_gb, turnstile_secret_enc, steam_publisher_key_enc, apple_bundle_id, google_web_client_id, discord_client_id, discord_client_secret_enc, max_content_items, max_storage_bytes",
    )
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
      <div className="text-sm text-white/60">
        <Link href="/developer" className="hover:text-white">← Projects</Link>
      </div>
      <div>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <p className="text-white/60 text-sm font-mono">{project.slug}</p>
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
      <PlayersPanel projectId={project.id} />
      <ProjectSettingsManager
        initial={{
          id: project.id,
          allowed_origins: project.allowed_origins ?? [],
          require_session_tokens: project.require_session_tokens ?? false,
          steam_app_id: project.steam_app_id ?? null,
          turnstile_configured: !!project.turnstile_secret_enc,
          steam_configured: !!project.steam_publisher_key_enc,
          apple_bundle_id: project.apple_bundle_id ?? null,
          google_web_client_id: project.google_web_client_id ?? null,
          discord_client_id: project.discord_client_id ?? null,
          discord_configured: !!project.discord_client_secret_enc,
        }}
      />
    </div>
  );
}

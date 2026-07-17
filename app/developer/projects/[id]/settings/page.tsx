import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ProjectSettingsManager } from "../ProjectSettingsManager";

const admin = createAdminClient();

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return null;

  const { data: project } = await admin
    .from("projects")
    .select(
      "id, allowed_origins, require_session_tokens, steam_app_id, turnstile_secret_enc, steam_publisher_key_enc, apple_bundle_id, google_web_client_id, discord_client_id, discord_client_secret_enc",
    )
    .eq("id", id)
    .eq("user_id", auth.user.userId)
    .maybeSingle();
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-white/60 text-sm mt-1">
          Optional hardening — a bare Lobbii API key already works without these.
        </p>
      </div>
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

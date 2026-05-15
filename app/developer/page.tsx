import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ProjectsManager } from "./ProjectsManager";

const admin = createAdminClient();

export default async function DeveloperDashboardPage() {
  const auth = await requireUser();
  if (!auth.ok) return null;

  const { data: projects } = await admin
    .from("projects")
    .select("id, name, slug, created_at")
    .eq("user_id", auth.user.userId)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-white/60 text-sm">Group API keys by project. Each project has its own keys and usage.</p>
      </div>
      <ProjectsManager initial={projects ?? []} />
    </div>
  );
}

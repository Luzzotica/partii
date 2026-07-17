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

  // Per-project "N open · M inbox" badges for the table.
  const ids = (projects ?? []).map((p) => p.id);
  const badges: Record<string, { open: number; inbox: number }> = {};
  if (ids.length > 0) {
    const [{ data: openRows }, { data: fbRows }] = await Promise.all([
      admin.from("tasks").select("project_id").in("project_id", ids).eq("status", "open"),
      admin.from("feedback").select("project_id").in("project_id", ids).eq("status", "new").not("text", "is", null),
    ]);
    for (const id of ids) badges[id] = { open: 0, inbox: 0 };
    for (const r of openRows ?? []) badges[r.project_id].open += 1;
    for (const r of fbRows ?? []) badges[r.project_id].inbox += 1;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-white/60 text-sm">
          Partii Studio — each project has tasks, players, settings, and Lobbii multiplayer keys.
        </p>
      </div>
      <ProjectsManager initial={projects ?? []} badges={badges} />
    </div>
  );
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ProjectsManager } from "./ProjectsManager";

const admin = createAdminClient();
const LAST_PROJECT_COOKIE = "partii_last_project";

/** Studio home: jump into the last (or first) project's Tasks board. */
export default async function DeveloperDashboardPage() {
  const auth = await requireUser();
  if (!auth.ok) return null;

  const { data: projects } = await admin
    .from("projects")
    .select("id, name, slug, created_at")
    .eq("user_id", auth.user.userId)
    .order("created_at", { ascending: false });

  const list = projects ?? [];
  if (list.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Welcome to Partii Studio</h1>
          <p className="text-white/60 text-sm mt-1">
            Create a project to track tasks, players, and Lobbii multiplayer usage.
          </p>
        </div>
        <ProjectsManager initial={[]} badges={{}} />
      </div>
    );
  }

  const jar = await cookies();
  const last = jar.get(LAST_PROJECT_COOKIE)?.value;
  const preferred =
    (last && list.find((p) => p.id === last)) || list[0];

  redirect(`/developer/projects/${preferred.id}/tasks`);
}

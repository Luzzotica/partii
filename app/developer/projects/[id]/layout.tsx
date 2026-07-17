import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ProjectSwitcher } from "@/components/developer/ProjectSwitcher";
import { ProjectNav } from "@/components/developer/ProjectNav";

const admin = createAdminClient();

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return null;

  const [{ data: project }, { data: projects }] = await Promise.all([
    admin
      .from("projects")
      .select("id, name, slug")
      .eq("id", id)
      .eq("user_id", auth.user.userId)
      .maybeSingle(),
    admin
      .from("projects")
      .select("id, name, slug")
      .eq("user_id", auth.user.userId)
      .order("created_at", { ascending: false }),
  ]);
  if (!project) notFound();

  const [{ count: openTasks }, { count: newFeedback }] = await Promise.all([
    admin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id)
      .eq("status", "open"),
    admin
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id)
      .eq("status", "new")
      .not("text", "is", null),
  ]);

  const list = projects ?? [project];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-white/10 pb-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 min-w-0 pb-2 sm:pb-0">
          <ProjectSwitcher current={project} projects={list} />
          <ProjectNav
            projectId={project.id}
            taskBadge={{ open: openTasks ?? 0, inbox: newFeedback ?? 0 }}
          />
        </div>
      </div>
      {children}
    </div>
  );
}

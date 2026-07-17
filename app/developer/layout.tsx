import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/requireUser";
import { createAdminClient } from "@/lib/supabase/admin";
import { UserMenu } from "@/components/auth/UserMenu";
import { StudioHeader } from "@/components/developer/StudioHeader";

export const metadata = { title: "Partii Studio" };

const admin = createAdminClient();

export default async function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const result = await requireUser();
  if (!result.ok) redirect("/?signin=1");

  const { data: projects } = await admin
    .from("projects")
    .select("id, name, slug")
    .eq("user_id", result.user.userId)
    .order("created_at", { ascending: false });

  const list = projects ?? [];
  const ids = list.map((p) => p.id);
  const taskBadges: Record<string, number> = {};
  const feedbackBadges: Record<string, number> = {};
  if (ids.length > 0) {
    for (const id of ids) {
      taskBadges[id] = 0;
      feedbackBadges[id] = 0;
    }
    const [{ data: openRows }, { data: fbRows }] = await Promise.all([
      admin.from("tasks").select("project_id").in("project_id", ids).eq("status", "open"),
      admin
        .from("feedback")
        .select("project_id")
        .in("project_id", ids)
        .eq("status", "new")
        .not("text", "is", null),
    ]);
    for (const r of openRows ?? []) taskBadges[r.project_id] = (taskBadges[r.project_id] ?? 0) + 1;
    for (const r of fbRows ?? []) feedbackBadges[r.project_id] = (feedbackBadges[r.project_id] ?? 0) + 1;
  }

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white">
      <header className="flex items-center gap-4 px-4 sm:px-6 py-3 border-b border-white/10">
        <Link href="/developer" className="font-semibold tracking-tight shrink-0">
          Partii
        </Link>
        <StudioHeader projects={list} taskBadges={taskBadges} feedbackBadges={feedbackBadges} />
        <div className="flex items-center gap-3 shrink-0 ml-auto">
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-white/50 hover:text-white transition-colors hidden sm:inline"
          >
            Lobbii Docs ↗
          </a>
          <Link href="/learn" className="text-sm text-white/50 hover:text-white hidden md:inline">
            Member Area
          </Link>
          <UserMenu />
        </div>
      </header>
      <main className="px-4 sm:px-6 py-8 max-w-6xl mx-auto">{children}</main>
    </div>
  );
}

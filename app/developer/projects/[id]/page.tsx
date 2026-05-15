import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { ProjectKeysManager } from "./ProjectKeysManager";

const admin = createAdminClient();

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return null;

  const { data: project } = await admin
    .from("projects")
    .select("id, name, slug, created_at")
    .eq("id", id)
    .eq("user_id", auth.user.userId)
    .maybeSingle();
  if (!project) notFound();

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
    </div>
  );
}

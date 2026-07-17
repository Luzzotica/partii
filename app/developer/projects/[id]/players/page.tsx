import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { PlayersPanel } from "../PlayersPanel";

const admin = createAdminClient();

export default async function ProjectPlayersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return null;

  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("user_id", auth.user.userId)
    .maybeSingle();
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Players</h1>
        <p className="text-white/60 text-sm mt-1">
          Everyone who has signed into this project — any provider.
        </p>
      </div>
      <PlayersPanel projectId={project.id} />
    </div>
  );
}

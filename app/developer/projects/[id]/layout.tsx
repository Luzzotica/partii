import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";

const admin = createAdminClient();

/** Ownership gate only — chrome (switcher + tabs) lives in the Studio header. */
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

  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("user_id", auth.user.userId)
    .maybeSingle();
  if (!project) notFound();

  return <>{children}</>;
}

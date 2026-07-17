import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";

const admin = createAdminClient();
const LAST_PROJECT_COOKIE = "partii_last_project";

/** Legacy account-wide usage URL → per-project Usage tab. */
export default async function DeveloperUsageRedirectPage() {
  const auth = await requireUser();
  if (!auth.ok) return null;

  const { data: projects } = await admin
    .from("projects")
    .select("id")
    .eq("user_id", auth.user.userId)
    .order("created_at", { ascending: false });

  const list = projects ?? [];
  if (list.length === 0) redirect("/developer");

  const jar = await cookies();
  const last = jar.get(LAST_PROJECT_COOKIE)?.value;
  const preferred = (last && list.find((p) => p.id === last)) || list[0];
  redirect(`/developer/projects/${preferred.id}/usage`);
}

import type { SupabaseClient } from "@supabase/supabase-js";

/** True if projectId exists and belongs to userId — the ownership guard every
 *  /api/developer/* route runs after requireUser(). */
export async function ownedProject(
  admin: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<boolean> {
  if (!projectId) return false;
  const { data } = await admin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

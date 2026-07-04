import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** 8-char share code, unambiguous alphabet (no 0/O/1/I/L/U). */
export function shareCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// Content quota: item count + total bytes vs the project's plan-materialized
// caps. Pending (unfinalized) uploads count their DECLARED size so signed
// upload URLs can't reserve unbounded space.

export type ContentQuotaResult = {
  allowed: boolean;
  reason?: string;
  items: number;
  bytes: number;
  maxItems: number;
  maxBytes: number;
};

export async function checkContentQuota(
  admin: SupabaseClient,
  projectId: string,
  addBytes: number,
): Promise<ContentQuotaResult> {
  const { data: proj } = await admin
    .from("projects")
    .select("max_content_items, max_storage_bytes")
    .eq("id", projectId)
    .maybeSingle();
  const maxItems = proj?.max_content_items ?? 200;
  const maxBytes = proj?.max_storage_bytes ?? 100 * 1024 * 1024;

  const { data } = await admin
    .from("player_content")
    .select("size_bytes")
    .eq("project_id", projectId);
  const items = data?.length ?? 0;
  const bytes = (data ?? []).reduce((a, r) => a + Number(r.size_bytes ?? 0), 0);

  if (items + 1 > maxItems) {
    return { allowed: false, reason: `content item limit reached (${maxItems})`, items, bytes, maxItems, maxBytes };
  }
  if (bytes + addBytes > maxBytes) {
    return { allowed: false, reason: `storage limit reached (${(maxBytes / 1e6).toFixed(0)} MB)`, items, bytes, maxItems, maxBytes };
  }
  return { allowed: true, items, bytes, maxItems, maxBytes };
}

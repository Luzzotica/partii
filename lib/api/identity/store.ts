import type { SupabaseClient } from "@supabase/supabase-js";
import { openSecret } from "@/lib/api/secretBox";
import type { ProjectProviderCreds } from "./index";

// Shared player-identity data access (service-role only).

export const PROVIDER_CRED_COLUMNS =
  "steam_publisher_key_enc, steam_app_id, apple_bundle_id, google_web_client_id, discord_client_id, discord_client_secret_enc";

export function credsFromProjectRow(row: Record<string, unknown> | null): ProjectProviderCreds {
  return {
    steamPublisherKey: openSecret(row?.steam_publisher_key_enc as string | null),
    steamAppId: (row?.steam_app_id as string | null) ?? null,
    appleBundleId: (row?.apple_bundle_id as string | null) ?? null,
    googleWebClientId: (row?.google_web_client_id as string | null) ?? null,
    discordClientId: (row?.discord_client_id as string | null) ?? null,
    discordClientSecret: openSecret(row?.discord_client_secret_enc as string | null),
  };
}

export type PlayerRow = {
  id: string;
  project_id: string;
  display_name: string | null;
  banned: boolean;
  created_at: string;
  last_seen_at: string;
};

/** Find the player owning (project, provider, subject), or null. */
export async function findPlayerByIdentity(
  admin: SupabaseClient,
  projectId: string,
  provider: string,
  subject: string,
): Promise<PlayerRow | null> {
  const { data } = await admin
    .from("player_identities")
    .select("player_id, players!inner(id, project_id, display_name, banned, created_at, last_seen_at)")
    .eq("project_id", projectId)
    .eq("provider", provider)
    .eq("subject", subject)
    .maybeSingle();
  return (data?.players as unknown as PlayerRow) ?? null;
}

/** Create a player + its first identity. Cleans up the player row if the
 *  identity insert loses a race (unique violation → re-fetch winner). */
export async function createPlayerWithIdentity(
  admin: SupabaseClient,
  projectId: string,
  provider: string,
  subject: string,
  displayName?: string,
): Promise<PlayerRow | null> {
  const { data: player, error } = await admin
    .from("players")
    .insert({ project_id: projectId, display_name: displayName ?? null })
    .select("id, project_id, display_name, banned, created_at, last_seen_at")
    .single();
  if (error || !player) return null;

  const { error: identErr } = await admin
    .from("player_identities")
    .insert({ player_id: player.id, project_id: projectId, provider, subject });
  if (identErr) {
    // Race: another request created this identity first — drop our orphan
    // player and return the winner.
    await admin.from("players").delete().eq("id", player.id);
    return findPlayerByIdentity(admin, projectId, provider, subject);
  }
  return player as PlayerRow;
}

/** Does the player have at least one non-anonymous linked identity?
 *  The global publish gate: anonymous device players can play and save
 *  locally, but must sign in (email/Steam/etc.) to publish to the cloud. */
export async function playerHasRealIdentity(
  admin: SupabaseClient,
  playerId: string,
): Promise<boolean> {
  const { count } = await admin
    .from("player_identities")
    .select("id", { count: "exact", head: true })
    .eq("player_id", playerId)
    .neq("provider", "anon");
  return (count ?? 0) > 0;
}

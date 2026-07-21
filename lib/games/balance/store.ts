import type { SupabaseClient } from "@supabase/supabase-js";
import type { BalanceChannel, BalanceDocument, GameFlags } from "./types";
import { DEFAULT_FLAGS } from "./types";
import {
  DEFAULT_BALANCE,
  DEFAULT_BALANCE_ID,
  DEFAULT_BALANCE_SHA256,
  defaultFlags,
} from "./defaults";
import { contentSha256 } from "./canonical";

export type BalanceDocRow = {
  game_id: string;
  id: string;
  channel: string;
  semver: string;
  sha256: string;
  body: BalanceDocument;
  signature: string | null;
  created_at: string;
  retired_at: string | null;
};

export type ChannelRow = {
  game_id: string;
  channel: string;
  active_id: string;
  updated_at: string;
};

export type ConfigRow = {
  game_id: string;
  flags: GameFlags;
  updated_at: string;
};

function mergeFlags(raw: unknown): GameFlags {
  const base = defaultFlags();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  return {
    balance_ota: typeof o.balance_ota === "boolean" ? o.balance_ota : base.balance_ota,
    require_signed_balance:
      typeof o.require_signed_balance === "boolean" ? o.require_signed_balance : base.require_signed_balance,
    balance_channel_default:
      o.balance_channel_default === "stable" ||
      o.balance_channel_default === "beta" ||
      o.balance_channel_default === "dev"
        ? o.balance_channel_default
        : base.balance_channel_default,
    kill_switch_multiplayer:
      typeof o.kill_switch_multiplayer === "boolean"
        ? o.kill_switch_multiplayer
        : base.kill_switch_multiplayer,
  };
}

/** Load flags; falls back to code defaults when table empty / missing. */
export async function loadFlags(
  admin: SupabaseClient,
  gameId: string,
): Promise<{ flags: GameFlags; updated_at: string | null }> {
  const { data, error } = await admin
    .from("game_remote_config")
    .select("flags, updated_at")
    .eq("game_id", gameId)
    .maybeSingle();
  if (error || !data) {
    return { flags: defaultFlags(), updated_at: null };
  }
  return {
    flags: mergeFlags(data.flags),
    updated_at: data.updated_at as string,
  };
}

export async function loadChannel(
  admin: SupabaseClient,
  gameId: string,
  channel: BalanceChannel,
): Promise<ChannelRow | null> {
  const { data } = await admin
    .from("game_balance_channels")
    .select("game_id, channel, active_id, updated_at")
    .eq("game_id", gameId)
    .eq("channel", channel)
    .maybeSingle();
  return (data as ChannelRow | null) ?? null;
}

export async function loadDocById(
  admin: SupabaseClient,
  gameId: string,
  id: string,
): Promise<BalanceDocRow | null> {
  const { data } = await admin
    .from("game_balance_docs")
    .select("game_id, id, channel, semver, sha256, body, signature, created_at, retired_at")
    .eq("game_id", gameId)
    .eq("id", id)
    .maybeSingle();
  return (data as BalanceDocRow | null) ?? null;
}

/**
 * Resolve active document for a channel. Falls back to embedded defaults when
 * DB has no seed yet (migration lag / fresh env).
 */
export async function resolveActiveDoc(
  admin: SupabaseClient,
  gameId: string,
  channel: BalanceChannel,
): Promise<
  | { source: "db"; row: BalanceDocRow; channelUpdatedAt: string }
  | { source: "embedded"; doc: BalanceDocument; sha256: string; channelUpdatedAt: string }
  | { source: "retired"; id: string }
  | { source: "missing"; id: string }
> {
  const ch = await loadChannel(admin, gameId, channel);
  if (!ch) {
    if (gameId === "tankii" && channel === "stable") {
      return {
        source: "embedded",
        doc: DEFAULT_BALANCE,
        sha256: DEFAULT_BALANCE_SHA256,
        channelUpdatedAt: DEFAULT_BALANCE.generated_at ?? new Date(0).toISOString(),
      };
    }
    return { source: "missing", id: "" };
  }

  const row = await loadDocById(admin, gameId, ch.active_id);
  if (!row) {
    if (gameId === "tankii" && ch.active_id === DEFAULT_BALANCE_ID) {
      return {
        source: "embedded",
        doc: DEFAULT_BALANCE,
        sha256: DEFAULT_BALANCE_SHA256,
        channelUpdatedAt: ch.updated_at,
      };
    }
    return { source: "missing", id: ch.active_id };
  }
  if (row.retired_at) return { source: "retired", id: row.id };
  return { source: "db", row, channelUpdatedAt: ch.updated_at };
}

export async function upsertBalanceDoc(
  admin: SupabaseClient,
  params: {
    gameId: string;
    channel: BalanceChannel;
    doc: BalanceDocument;
    promote: boolean;
  },
): Promise<{ id: string; sha256: string; channel: BalanceChannel; promoted: boolean }> {
  const sha256 = contentSha256(params.doc);
  const { error: docErr } = await admin.from("game_balance_docs").upsert(
    {
      game_id: params.gameId,
      id: params.doc.id,
      channel: params.channel,
      semver: params.doc.semver,
      sha256,
      body: params.doc,
      signature: null,
      retired_at: null,
    },
    { onConflict: "game_id,id" },
  );
  if (docErr) throw new Error(docErr.message);

  let promoted = false;
  if (params.promote) {
    const { error: chErr } = await admin.from("game_balance_channels").upsert(
      {
        game_id: params.gameId,
        channel: params.channel,
        active_id: params.doc.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "game_id,channel" },
    );
    if (chErr) throw new Error(chErr.message);
    promoted = true;
  }

  // Ensure config row exists with defaults.
  const { data: existing } = await admin
    .from("game_remote_config")
    .select("game_id")
    .eq("game_id", params.gameId)
    .maybeSingle();
  if (!existing) {
    await admin.from("game_remote_config").insert({
      game_id: params.gameId,
      flags: DEFAULT_FLAGS,
    });
  }

  return {
    id: params.doc.id,
    sha256,
    channel: params.channel,
    promoted,
  };
}

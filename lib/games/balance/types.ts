/** Tankii balance OTA — wire types (schema tankii.balance/v1). */

export const BALANCE_SCHEMA = "tankii.balance/v1" as const;
export const BALANCE_MAX_BYTES = 64 * 1024;
export const SUPPORTED_GAMES = new Set(["tankii"]);
export const BALANCE_CHANNELS = new Set(["stable", "beta", "dev"]);
export type BalanceChannel = "stable" | "beta" | "dev";

export type GameFlags = {
  balance_ota: boolean;
  require_signed_balance: boolean;
  balance_channel_default: BalanceChannel;
  kill_switch_multiplayer: boolean;
};

export const DEFAULT_FLAGS: GameFlags = {
  balance_ota: true,
  require_signed_balance: false,
  balance_channel_default: "stable",
  kill_switch_multiplayer: false,
};

export type BalanceDocument = {
  schema: typeof BALANCE_SCHEMA;
  id: string;
  semver: string;
  generated_at?: string;
  notes?: string;
  player: Record<string, number>;
  bullet: Record<string, number>;
  grenade: Record<string, number>;
  powerups: Record<string, number>;
  match: Record<string, number>;
  ai: Record<string, number>;
  geometry: Record<string, number>;
};

export type ConfigResponse = {
  game_id: string;
  flags: GameFlags;
  balance: {
    channel: BalanceChannel;
    active_id: string;
    semver: string;
    sha256: string;
    url: string;
    updated_at: string;
  };
  min_client_semver: string | null;
};

-- =============================================
-- GAME REMOTE CONFIG + BALANCE DOCUMENTS (OTA)
--
-- Public-read feature flags + versioned balance tables for games (Tankii first).
-- Writes via admin API only (service role). Clients fall back to embedded
-- defaults if fetch fails — these tables are not on the join critical path.
-- =============================================

CREATE TABLE IF NOT EXISTS public.game_remote_config (
  game_id    TEXT        PRIMARY KEY,
  flags      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.game_balance_docs (
  game_id    TEXT        NOT NULL,
  id         TEXT        NOT NULL,
  channel    TEXT        NOT NULL DEFAULT 'stable'
                         CHECK (channel IN ('stable', 'beta', 'dev')),
  semver     TEXT        NOT NULL,
  sha256     TEXT        NOT NULL,
  body       JSONB       NOT NULL,
  signature  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  PRIMARY KEY (game_id, id)
);

CREATE INDEX IF NOT EXISTS idx_game_balance_docs_channel
  ON public.game_balance_docs (game_id, channel, created_at DESC);

CREATE TABLE IF NOT EXISTS public.game_balance_channels (
  game_id    TEXT        NOT NULL,
  channel    TEXT        NOT NULL
                         CHECK (channel IN ('stable', 'beta', 'dev')),
  active_id  TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, channel)
);

ALTER TABLE public.game_remote_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_balance_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_balance_channels ENABLE ROW LEVEL SECURITY;
-- No policies: service-role API only.

-- Seed Tankii defaults (flags + stable channel + document body).
INSERT INTO public.game_remote_config (game_id, flags)
VALUES (
  'tankii',
  '{
    "balance_ota": true,
    "require_signed_balance": false,
    "balance_channel_default": "stable",
    "kill_switch_multiplayer": false
  }'::jsonb
)
ON CONFLICT (game_id) DO NOTHING;

INSERT INTO public.game_balance_docs (game_id, id, channel, semver, sha256, body)
VALUES (
  'tankii',
  '2026-07-21.default',
  'stable',
  '1.0.0',
  -- Canonical JSON sha256 (sorted keys) of the body below.
  '43ef5173fe6371e8d261b0802d286944fc0b6a1ba440f49aad1a1890f31aac06',
  '{
    "schema": "tankii.balance/v1",
    "id": "2026-07-21.default",
    "semver": "1.0.0",
    "generated_at": "2026-07-21T00:00:00.000Z",
    "notes": "Shipping defaults mirrored from tank-core/src/types.rs (and shell mirrors in src/game/constants.ts).",
    "player": {
      "speed": 2.8,
      "turning_speed_factor": 0.1,
      "max_live_bullets": 5,
      "fire_cooldown": 0.25,
      "spawn_shield_time": 1.0,
      "fire_recoil_stop": 0.25
    },
    "bullet": {
      "speed": 5.8,
      "fast_speed": 9.5,
      "max_bounces": 1,
      "max_age": 12.0,
      "vs_bullet_dist": 0.26
    },
    "grenade": {
      "range": 4.5,
      "flight_time": 1.05,
      "arc_height": 2.4,
      "fuse": 2.25,
      "rest_y": 0.12,
      "roll_speed": 1.6,
      "gravity": 10.0,
      "bounce": 0.35,
      "friction": 1.5,
      "mine_radius": 0.3,
      "prox_radius": 1.8,
      "prox_fuse": 0.5,
      "dome_max_r": 1.8,
      "dome_expand_t": 0.4025,
      "dome_shrink_t": 0.4025
    },
    "powerups": {
      "crate_drop_chance": 0.35,
      "pickup_radius": 0.6,
      "buff_duration": 12.0,
      "respawn_seconds": 15.0
    },
    "match": {
      "countdown_seconds": 3.0,
      "round_end_seconds": 3.5,
      "respawn_seconds": 3.0,
      "tdm_kill_target": 10,
      "ctf_capture_target": 3,
      "ffa_kill_target": 10,
      "match_time_limit": 180.0,
      "flag_auto_return_seconds": 20.0,
      "flag_pickup_radius": 0.7,
      "flag_capture_radius": 1.0,
      "koth_score_target": 60,
      "koth_hill_radius": 2.6,
      "koth_move_min": 15.0,
      "koth_move_max": 30.0
    },
    "ai": {
      "speed": 1.8,
      "turret_turn_rate": 2.3,
      "max_live_bullets": 5,
      "offense_bullets": 3,
      "aim_jitter": 0.04,
      "fire_interval_min": 0.7,
      "fire_interval_max": 1.6,
      "range_close": 3.5,
      "range_far": 11.0,
      "powerup_seek_radius": 8.0,
      "grenade_aim_hold": 0.35,
      "grenade_interval_min": 6.0,
      "grenade_interval_max": 12.0
    },
    "geometry": {
      "tank_radius": 0.42,
      "tank_y": 0.32,
      "bullet_y": 0.5,
      "muzzle_offset": 0.62,
      "pit_block_height": 0.2
    }
  }'::jsonb
)
ON CONFLICT (game_id, id) DO NOTHING;

INSERT INTO public.game_balance_channels (game_id, channel, active_id)
VALUES ('tankii', 'stable', '2026-07-21.default')
ON CONFLICT (game_id, channel) DO NOTHING;

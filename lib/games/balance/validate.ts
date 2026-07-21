import {
  BALANCE_CHANNELS,
  BALANCE_MAX_BYTES,
  BALANCE_SCHEMA,
  type BalanceChannel,
  type BalanceDocument,
} from "./types";
import { jsonByteLength } from "./canonical";

type FieldSpec = Record<string, "pos" | "nonneg" | "unit" | "posInt" | "nonnegInt">;

const PLAYER: FieldSpec = {
  speed: "pos",
  turning_speed_factor: "unit",
  max_live_bullets: "posInt",
  fire_cooldown: "nonneg",
  spawn_shield_time: "nonneg",
  fire_recoil_stop: "nonneg",
};

const BULLET: FieldSpec = {
  speed: "pos",
  fast_speed: "pos",
  max_bounces: "nonnegInt",
  max_age: "pos",
  vs_bullet_dist: "pos",
};

const GRENADE: FieldSpec = {
  range: "pos",
  flight_time: "pos",
  arc_height: "pos",
  fuse: "pos",
  rest_y: "nonneg",
  roll_speed: "pos",
  gravity: "pos",
  bounce: "unit",
  friction: "nonneg",
  mine_radius: "pos",
  prox_radius: "pos",
  prox_fuse: "pos",
  dome_max_r: "pos",
  dome_expand_t: "pos",
  dome_shrink_t: "pos",
};

const POWERUPS: FieldSpec = {
  crate_drop_chance: "unit",
  pickup_radius: "pos",
  buff_duration: "pos",
  respawn_seconds: "pos",
};

const MATCH: FieldSpec = {
  countdown_seconds: "nonneg",
  round_end_seconds: "nonneg",
  respawn_seconds: "nonneg",
  tdm_kill_target: "posInt",
  ctf_capture_target: "posInt",
  ffa_kill_target: "posInt",
  match_time_limit: "pos",
  flag_auto_return_seconds: "pos",
  flag_pickup_radius: "pos",
  flag_capture_radius: "pos",
  koth_score_target: "posInt",
  koth_hill_radius: "pos",
  koth_move_min: "pos",
  koth_move_max: "pos",
};

const AI: FieldSpec = {
  speed: "pos",
  turret_turn_rate: "pos",
  max_live_bullets: "posInt",
  offense_bullets: "posInt",
  aim_jitter: "nonneg",
  fire_interval_min: "pos",
  fire_interval_max: "pos",
  range_close: "pos",
  range_far: "pos",
  powerup_seek_radius: "pos",
  grenade_aim_hold: "nonneg",
  grenade_interval_min: "pos",
  grenade_interval_max: "pos",
};

const GEOMETRY: FieldSpec = {
  tank_radius: "pos",
  tank_y: "nonneg",
  bullet_y: "nonneg",
  muzzle_offset: "pos",
  pit_block_height: "nonneg",
};

const SECTIONS: { key: keyof BalanceDocument; spec: FieldSpec }[] = [
  { key: "player", spec: PLAYER },
  { key: "bullet", spec: BULLET },
  { key: "grenade", spec: GRENADE },
  { key: "powerups", spec: POWERUPS },
  { key: "match", spec: MATCH },
  { key: "ai", spec: AI },
  { key: "geometry", spec: GEOMETRY },
];

function checkNum(kind: FieldSpec[string], v: unknown, path: string): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return `${path} must be a finite number`;
  const max = 1e6;
  if (v > max) return `${path} exceeds maximum`;
  switch (kind) {
    case "pos":
      if (!(v > 0)) return `${path} must be > 0`;
      break;
    case "nonneg":
      if (v < 0) return `${path} must be >= 0`;
      break;
    case "unit":
      if (v < 0 || v > 1) return `${path} must be in [0,1]`;
      break;
    case "posInt":
      if (!Number.isInteger(v) || v < 1) return `${path} must be integer >= 1`;
      break;
    case "nonnegInt":
      if (!Number.isInteger(v) || v < 0) return `${path} must be integer >= 0`;
      break;
  }
  return null;
}

/**
 * Validate a balance document against tankii.balance/v1 (hand-rolled from
 * ota-rnd schema — no AJV dependency). Returns null on success.
 */
export function validateBalanceDocument(raw: unknown): { ok: true; doc: BalanceDocument } | { ok: false; error: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "document must be an object" };
  }
  if (jsonByteLength(raw) > BALANCE_MAX_BYTES) {
    return { ok: false, error: `document exceeds ${BALANCE_MAX_BYTES} bytes` };
  }

  const o = raw as Record<string, unknown>;
  const allowedTop = new Set([
    "schema", "id", "semver", "generated_at", "notes",
    "player", "bullet", "grenade", "powerups", "match", "ai", "geometry",
  ]);
  for (const k of Object.keys(o)) {
    if (!allowedTop.has(k)) return { ok: false, error: `unknown property: ${k}` };
  }

  if (o.schema !== BALANCE_SCHEMA) {
    return { ok: false, error: `schema must be ${BALANCE_SCHEMA}` };
  }
  if (typeof o.id !== "string" || o.id.length < 1 || o.id.length > 128) {
    return { ok: false, error: "id must be a string 1..128 chars" };
  }
  if (typeof o.semver !== "string" || !/^\d+\.\d+\.\d+$/.test(o.semver)) {
    return { ok: false, error: "semver must match N.N.N" };
  }
  if (o.generated_at !== undefined && typeof o.generated_at !== "string") {
    return { ok: false, error: "generated_at must be a string" };
  }
  if (o.notes !== undefined) {
    if (typeof o.notes !== "string" || o.notes.length > 2000) {
      return { ok: false, error: "notes must be a string ≤2000 chars" };
    }
  }

  for (const { key, spec } of SECTIONS) {
    const section = o[key];
    if (section === null || typeof section !== "object" || Array.isArray(section)) {
      return { ok: false, error: `${key} must be an object` };
    }
    const s = section as Record<string, unknown>;
    for (const k of Object.keys(s)) {
      if (!(k in spec)) return { ok: false, error: `unknown property: ${key}.${k}` };
    }
    for (const [field, kind] of Object.entries(spec)) {
      if (!(field in s)) return { ok: false, error: `missing ${key}.${field}` };
      const err = checkNum(kind, s[field], `${key}.${field}`);
      if (err) return { ok: false, error: err };
    }
  }

  return { ok: true, doc: o as unknown as BalanceDocument };
}

export function parseChannel(raw: string | null | undefined): BalanceChannel | null {
  const c = (raw ?? "stable").trim().toLowerCase();
  if (!BALANCE_CHANNELS.has(c)) return null;
  return c as BalanceChannel;
}

/** Player marble (ball) radius in world units; used for mesh height and roll rotation. */
export const PLAYER_BALL_RADIUS = 0.5;

/** Gravity (m/s²); must match server physics world. */
export const GRAVITY = -9.81;

/** Player movement; must match server constants.rs. */
export const PLAYER_ACCEL = 12.0;
export const PLAYER_DAMPING = 0.96;
export const PLAYER_INPUT_TICK_DT = 0.05;

/**
 * Bullet speed in world units/sec (client applies this for visuals; server uses same value)
 */
export const BULLET_SPEED = 35000;

/**
 * Projectile TTL in seconds - must match server. Bullets expire quickly; rockets last longer.
 */
export const PROJECTILE_TTL_BULLET_SEC = 4;
export const PROJECTILE_TTL_ROCKET_SEC = 6;

/**
 * Compute muzzle world position - must match server muzzle_world_position in weapons/common.rs
 */
export function computeMuzzleWorldPosition(
  px: number,
  py: number,
  pz: number,
  aimX: number,
  aimZ: number,
  weaponTag: string,
): { x: number; y: number; z: number } {
  let ax = aimX;
  let az = aimZ;
  const lenSq = ax * ax + az * az;
  if (lenSq < 0.001) {
    ax = 0;
    az = -1;
  } else {
    const len = Math.sqrt(lenSq);
    ax /= len;
    az /= len;
  }
  let lx = 1;
  const ly = 0;
  const lz = 0;
  if (weaponTag === "PhotonRifle") lx = 0.5;
  return {
    x: px - az * lx - ax * lz,
    y: py + ly,
    z: pz + ax * lx - az * lz,
  };
}

export const GUN_MUZZLE_OFFSET_FORWARD = 0.65;
export const GUN_MUZZLE_OFFSET_UP = 0.35;

/**
 * Default camera zoom: distance-based zoom (mouse far from player = zoom out).
 * Can be overridden per weapon via WeaponConfig.cameraZoom.
 */
export interface CameraZoomConfig {
  /** Min camera radius (zoomed in when mouse is at player). */
  radiusMin: number;
  /** Max camera radius (zoomed out when mouse is far). */
  radiusMax: number;
  /** World-space distance from player at which zoom is fully "out" (capped). */
  mouseZoomMaxDist: number;
}

export const DEFAULT_CAMERA_ZOOM: CameraZoomConfig = {
  radiusMin: 25,
  radiusMax: 30,
  mouseZoomMaxDist: 25,
};

/** Server beam capsule radius (BEAM_HALF_WIDTH); visual matches collider. */
export const PHOTON_BEAM_RADIUS = 0.3;

/** Beam duration in ticks (must match server BEAM_DURATION_TICKS) for fade calculation. */
export const PHOTON_BEAM_DURATION_TICKS = 60;

/** Cooldown after photon rifle fire before next charge can start (ms); must match server. */
export const PHOTON_RIFLE_RECHARGE_MS = 2000;

/** Health stored as tenths on server (1000 = 100.0 displayed). Must match server HEALTH_SCALE/MAX_HEALTH. */
export const HEALTH_SCALE = 10;
export const MAX_HEALTH = 1000;

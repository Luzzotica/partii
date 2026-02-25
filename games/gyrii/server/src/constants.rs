//! Shared game constants

/// Health stored internally as tenths (1000 = 100.0 displayed).
pub const HEALTH_SCALE: i32 = 10;
pub const MAX_HEALTH: i32 = 1000;

/// Photon beam duration in physics ticks.
pub const BEAM_DURATION_TICKS: i32 = 60;
pub const BEAM_HALF_WIDTH: f32 = 0.3;
pub const PHOTON_RAY_MAX_DISTANCE: f32 = 2000.0;

/// Player acceleration and damping.
pub const PLAYER_ACCEL: f32 = 10.2; // 12.0 * 0.85 (15% slower)
pub const PLAYER_DAMPING: f32 = 0.96;
pub const PLAYER_INPUT_TICK_DT: f32 = 0.05;

/// Grenade constants.
pub const GRENADE_FUSE_SEC: u64 = 5;
pub const GRENADE_THROW_SPEED: f32 = 7.2;
pub const GRENADE_THROWER_IMPULSE: f32 = 1.35; // 0.9 * 1.5 (50% faster)
pub const GRENADE_RESTITUTION: f32 = 1.9;
pub const GRENADE_KNOCKBACK_BASE: f32 = 10.0;
pub const GRENADE_COOLDOWN_MICROS: i64 = 1_000_000;

/// Player mass for knockback physics (used with projectile mass from weapon config).
pub const PLAYER_MASS: f32 = 1.0;

/// Below this Y position, player dies (fell through floor hole / pit).
pub const FALL_DEATH_Y_THRESHOLD: f32 = -10.0;

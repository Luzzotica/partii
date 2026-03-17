//! Shared game constants

/// Health stored internally as tenths (1000 = 100.0 displayed).
pub const HEALTH_SCALE: i32 = 10;
pub const MAX_HEALTH: i32 = 1000;

/// Photon beam duration in physics ticks.
pub const BEAM_DURATION_TICKS: i32 = 60;
pub const BEAM_HALF_WIDTH: f32 = 0.3;
pub const PHOTON_RAY_MAX_DISTANCE: f32 = 2000.0;

/// Fixed timestep for physics and player input. Must match client PHYSICS_TICK_DT.
/// Server game loop runs at 1/TICK_DT Hz (60 Hz).
pub const PHYSICS_TICK_DT: f32 = 1.0 / 60.0;

/// Player acceleration and damping.
/// Scaled for PHYSICS_TICK_DT: 10.2 * (0.05 / (1/60)) = 30.6 to preserve speed from dt=0.05 era.
pub const PLAYER_ACCEL: f32 = 30.6;
pub const PLAYER_DAMPING: f32 = 0.96;

/// Grenade constants.
pub const GRENADE_FUSE_SEC: u64 = 2;
pub const GRENADE_THROW_SPEED: f32 = 7.2;
pub const GRENADE_THROWER_IMPULSE: f32 = 1.35; // 0.9 * 1.5 (50% faster)
pub const GRENADE_RESTITUTION: f32 = 1.9;
pub const GRENADE_KNOCKBACK_BASE: f32 = 10.0;
pub const GRENADE_IMPULSE_RADIUS_MULT: f32 = 1.6;
pub const GRENADE_COOLDOWN_MICROS: i64 = 1_000_000;
/// Throwing a grenade interrupts primary fire for this duration.
pub const GRENADE_SHOOT_LOCKOUT_MICROS: i64 = 750_000; // 0.75s

/// Player mass for knockback physics (used with projectile mass from weapon config).
pub const PLAYER_MASS: f32 = 1.0;

/// Below this Y position, player dies (fell through floor hole / pit).
pub const FALL_DEATH_Y_THRESHOLD: f32 = -10.0;

/// Popup Hammers secondary ability.
/// Forced cooldown = ability cooldown: no shoot/grenade/secondary for this duration.
pub const POPUP_HAMMERS_COOLDOWN_MICROS: i64 = 800_000; // 0.8s
pub const POPUP_HAMMERS_ABILITY_COOLDOWN_MICROS: i64 = 800_000; // same as forced
pub const POPUP_HAMMERS_RADIUS: f32 = 1.3;
pub const POPUP_HAMMERS_DAMAGE: f32 = 60.0;

/// Dash secondary ability.
/// Forced cooldown = ability cooldown: no shoot/grenade/secondary for this duration.
pub const DASH_IMPULSE: f32 = 25.0;
pub const DASH_COOLDOWN_MICROS: i64 = 800_000; // 0.8s
pub const DASH_ABILITY_COOLDOWN_MICROS: i64 = 800_000; // same as forced

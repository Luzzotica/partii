//! Shared game constants (player movement, etc.)

/// Health stored internally as tenths (1000 = 100.0 displayed). Enables fractional damage up to 1 decimal.
pub const HEALTH_SCALE: i32 = 10;
/// Max health internal (displayed as 100.0).
pub const MAX_HEALTH: i32 = 1000;

/// Photon beam duration in physics ticks before it disappears.
pub const BEAM_DURATION_TICKS: i32 = 60;
/// Photon beam capsule radius; visual matches collider.
pub const BEAM_HALF_WIDTH: f32 = 0.3;
/// Raycast runs until it hits a wall; large max so beam has no practical max length.
pub const PHOTON_RAY_MAX_DISTANCE: f32 = 2000.0;

/// Player acceleration in world units per second squared.
pub const PLAYER_ACCEL: f32 = 28.8;

/// Velocity damping per input tick when no input (velocity *= PLAYER_DAMPING).
pub const PLAYER_DAMPING: f32 = 0.84;

/// Approximate time delta between client input updates in seconds (~50ms).
pub const PLAYER_INPUT_TICK_DT: f32 = 0.05;

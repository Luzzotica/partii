//! In-memory game state

use std::collections::HashMap;
use tokio::sync::mpsc::UnboundedSender;

pub use lobby::*;
pub use player::*;

#[derive(Clone)]
pub struct PhotonBeamData {
    pub id: u64,
    pub owner_id: String,
    pub lobby_id: u64,
    pub origin_x: f32,
    pub origin_y: f32,
    pub origin_z: f32,
    pub end_x: f32,
    pub end_y: f32,
    pub end_z: f32,
    pub remaining_ticks: i32,
}

#[derive(Clone)]
pub struct GrenadeData {
    pub rigid_body_id: u64,
    pub lobby_id: u64,
    pub owner_id: String,
    pub expires_at_micros: u64,
    pub damage: f32,
    pub radius: f32,
}

#[derive(Clone)]
pub struct ProjectileData {
    pub owner_id: String,
    pub lobby_id: u64,
    pub weapon_type: WeaponType,
    pub damage: f32,
    pub velocity_x: f32,
    pub velocity_y: f32,
    pub velocity_z: f32,
    pub expires_at_micros: u64,
    /// Origin position for distance-based damage falloff.
    pub origin_x: f32,
    pub origin_y: f32,
    pub origin_z: f32,
}

mod flag;
mod lobby;
mod player;
mod spawn;

pub use flag::{FlagData, FlagState};
pub use spawn::get_best_spawn_position;

#[derive(Clone, Debug)]
pub struct PendingRoundRestart {
    pub next_map_id: crate::state::MapId,
    pub starts_at_ms: u64,
    /// When set, use this custom map JSON instead of built-in.
    pub custom_map_json: Option<String>,
}

/// Vec3 for positions
#[derive(Clone, Copy, Debug)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            lobbies: HashMap::new(),
            lobby_secrets: HashMap::new(),
            lobby_players: Vec::new(),
            players: HashMap::new(),
            spawn_points: Vec::new(),
            flag_locations: Vec::new(),
            physics_worlds: HashMap::new(),
            projectiles: HashMap::new(),
            grenades: HashMap::new(),
            photon_beams: HashMap::new(),
            flags: HashMap::new(),
            grenade_inserts_sent: std::collections::HashSet::new(),
            grenade_deletes_this_tick: Vec::new(),
            secondary_effect_events_this_tick: Vec::new(),
            pending_secondary_actions: Vec::new(),
            identity_user_ids: HashMap::new(),
            ongoing_matches: HashMap::new(),
            stats_flush_tx: None,
            pending_round_restarts: HashMap::new(),
            next_lobby_id: 1,
            next_lobby_player_id: 1,
            next_photon_beam_id: 1,
        }
    }
}

pub struct ServerState {
    pub lobbies: HashMap<u64, Lobby>,
    pub lobby_secrets: HashMap<u64, String>,
    pub lobby_players: Vec<LobbyPlayer>,
    pub players: HashMap<String, Player>,
    pub spawn_points: Vec<MapSpawnPoint>,
    pub flag_locations: Vec<MapFlagLocation>,
    pub physics_worlds: HashMap<u64, crate::physics::PhysicsWorldState>,
    pub projectiles: HashMap<u64, ProjectileData>,
    pub grenades: HashMap<u64, GrenadeData>,
    /// CTF flags: key (lobby_id, team) -> FlagData
    pub flags: HashMap<(u64, i32), FlagData>,
    pub photon_beams: HashMap<u64, PhotonBeamData>,
    /// Grenade rigid_body_ids we've already sent an insert for (so we send updates, not re-insert)
    pub grenade_inserts_sent: std::collections::HashSet<u64>,
    /// (rigid_body_id, lobby_id) for grenades removed this tick (for delta grenade_deletes)
    pub grenade_deletes_this_tick: Vec<(u64, u64)>,
    /// (lobby_id, payload) for secondary ability effects this tick (hammers, dash)
    pub secondary_effect_events_this_tick: Vec<(u64, crate::protocol::SecondaryEffectPayload)>,
    /// (identity, secondary_type) - drained each tick by game loop
    pub pending_secondary_actions: Vec<(String, crate::state::SecondaryType)>,
    /// Socket identity -> authenticated Supabase user id (UUID as string).
    pub identity_user_ids: HashMap<String, String>,
    /// Active in-memory stats trackers keyed by lobby id.
    pub ongoing_matches: HashMap<u64, crate::stats::OngoingMatchStats>,
    /// Background queue sender for finalized match snapshots.
    pub stats_flush_tx: Option<UnboundedSender<crate::stats::StatsFlushJob>>,
    /// Lobby_id -> scheduled next round restart metadata.
    pub pending_round_restarts: HashMap<u64, PendingRoundRestart>,
    pub next_lobby_id: u64,
    pub next_lobby_player_id: u64,
    pub next_photon_beam_id: u64,
}

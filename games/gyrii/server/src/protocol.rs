//! Protocol message types for WebSocket communication

use serde::{Deserialize, Serialize};

/// Identity: hex string (UUID-based for anonymous)
pub type Identity = String;

/// Client -> Server: action message
#[derive(Debug, Deserialize)]
pub struct ActionMessage {
    pub action: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// Server -> Client: init on connect
#[derive(Debug, Serialize)]
pub struct InitMessage {
    pub r#type: &'static str,
    pub identity: Identity,
}

/// Server -> Client: success response
#[derive(Debug, Serialize)]
pub struct OkMessage {
    pub ok: bool,
}

/// Server -> Client: error response
#[derive(Debug, Serialize)]
pub struct ErrorMessage {
    pub error: String,
}

/// Server -> Client: full lobby state (on join)
#[derive(Debug, Serialize)]
pub struct LobbyStateMessage {
    pub r#type: &'static str,
    pub lobby: LobbyPayload,
    pub players: Vec<PlayerPayload>,
}

#[derive(Debug, Serialize)]
pub struct LobbyPayload {
    pub id: String,
    pub name: String,
    pub host_id: String,
    pub map_id: String,
    pub map_pool: Vec<String>,
    pub max_players: u8,
    pub game_mode: String,
    pub game_state: String,
    pub score_limit: i32,
    pub flag_limit: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_round_starts_at_ms: Option<u64>,
}

/// Full player payload (profile + realtime) - synced on join / lobby_state
#[derive(Debug, Clone, Serialize)]
pub struct PlayerPayload {
    pub id: String,
    pub name: String,
    pub position: [f32; 3],
    pub health: i32,
    pub kills: i32,
    pub deaths: i32,
    pub team: i32,
    pub color: [f32; 3],
    pub design_id: u8,
    pub secondary_color: [f32; 3],
    pub weapon: String,
    pub secondary: String,
    pub velocity: [f32; 3],
    pub is_alive: bool,
    pub grenade_count: i32,
    pub molotov_count: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_shot_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_grenade_thrown_at: Option<i64>,
    pub aim_x: f32,
    pub aim_z: f32,
}

/// Profile (appearance) - synced on join and when a new player spawns
#[derive(Debug, Clone, Serialize)]
pub struct PlayerProfilePayload {
    pub id: String,
    pub name: String,
    pub team: i32,
    pub color: [f32; 3],
    pub design_id: u8,
    pub secondary_color: [f32; 3],
    pub weapon: String,
    pub secondary: String,
}

/// Realtime data - sent every tick in delta
#[derive(Debug, Clone, Serialize)]
pub struct PlayerRealtimePayload {
    pub id: String,
    pub team: i32,
    pub weapon: String,
    pub secondary: String,
    pub position: [f32; 3],
    pub health: i32,
    pub kills: i32,
    pub deaths: i32,
    pub velocity: [f32; 3],
    pub is_alive: bool,
    pub grenade_count: i32,
    pub molotov_count: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_shot_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_grenade_thrown_at: Option<i64>,
    pub aim_x: f32,
    pub aim_z: f32,
}

/// Sent when a new player spawns (broadcast to lobby)
#[derive(Debug, Serialize)]
pub struct PlayerJoinedMessage {
    pub r#type: &'static str,
    pub player: PlayerProfilePayload,
}

/// Sent when a player leaves a lobby (broadcast to lobby)
#[derive(Debug, Serialize)]
pub struct PlayerLeftMessage {
    pub r#type: &'static str,
    pub player_id: String,
}

/// Server -> Client: list of available lobbies
#[derive(Debug, Serialize)]
pub struct LobbyListMessage {
    pub r#type: &'static str,
    pub lobbies: Vec<LobbySummaryPayload>,
}

#[derive(Debug, Serialize)]
pub struct LobbySummaryPayload {
    pub id: String,
    pub name: String,
    pub host_id: String,
    pub map_id: String,
    pub map_pool: Vec<String>,
    pub max_players: u8,
    pub player_count: u32,
    pub game_mode: String,
    pub game_state: String,
    pub has_password: bool,
    pub score_limit: i32,
    pub flag_limit: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_round_starts_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GameEndedMessage {
    pub r#type: &'static str,
    pub lobby_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner_team: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner_player_identity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner_player_name: Option<String>,
    pub next_map_id: String,
    pub countdown_ms: u64,
}

/// Server -> Client: incremental update (each tick)
#[derive(Debug, Serialize)]
pub struct DeltaMessage {
    pub r#type: &'static str,
    pub tick: u64,
    pub players: Vec<PlayerRealtimePayload>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub shot_events: Vec<ShotEventPayload>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub grenade_inserts: Vec<GrenadeInsertPayload>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub grenade_deletes: Vec<GrenadeDeletePayload>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub grenade_updates: Vec<GrenadeUpdatePayload>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub kill_events: Vec<KillEventPayload>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub photon_beams: Vec<PhotonBeamPayload>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PhotonBeamPayload {
    pub id: u64,
    pub owner_id: String,
    pub origin_x: f32,
    pub origin_y: f32,
    pub origin_z: f32,
    pub end_x: f32,
    pub end_y: f32,
    pub end_z: f32,
    pub remaining_ticks: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShotEventPayload {
    pub player_id: String,
    pub weapon: String,
    pub projectile_type: u8,
    pub position: [f32; 3],
    pub velocity: [f32; 3],
}

#[derive(Debug, Clone, Serialize)]
pub struct GrenadeInsertPayload {
    pub rigid_body_id: u64,
    pub position: [f32; 3],
    pub velocity: [f32; 3],
    pub owner_id: String,
    pub owner_color: [f32; 3],
}

#[derive(Debug, Clone, Serialize)]
pub struct GrenadeDeletePayload {
    pub rigid_body_id: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GrenadeUpdatePayload {
    pub rigid_body_id: u64,
    pub position: [f32; 3],
    pub velocity: [f32; 3],
}

#[derive(Debug, Clone, Serialize)]
pub struct KillEventPayload {
    pub killer_id: String,
    pub killer_name: String,
    pub victim_id: String,
    pub victim_name: String,
    pub weapon: String,
    pub timestamp: u64,
}

impl InitMessage {
    pub fn new(identity: Identity) -> Self {
        Self {
            r#type: "init",
            identity,
        }
    }
}

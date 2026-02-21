//! Lobby state types

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum MapId {
    Arena,
    Maze,
    Warehouse,
}

impl MapId {
    pub fn as_pascal(self) -> &'static str {
        match self {
            MapId::Arena => "Arena",
            MapId::Maze => "Maze",
            MapId::Warehouse => "Warehouse",
        }
    }

    pub fn as_lower(self) -> &'static str {
        match self {
            MapId::Arena => "arena",
            MapId::Maze => "maze",
            MapId::Warehouse => "warehouse",
        }
    }

    pub fn from_pascal(s: &str) -> Option<Self> {
        match s {
            "Arena" => Some(MapId::Arena),
            "Maze" => Some(MapId::Maze),
            "Warehouse" => Some(MapId::Warehouse),
            _ => None,
        }
    }

    pub fn from_lower(s: &str) -> Option<Self> {
        match s {
            "arena" => Some(MapId::Arena),
            "maze" => Some(MapId::Maze),
            "warehouse" => Some(MapId::Warehouse),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum GameMode {
    FreeForAll,
    TeamDeathmatch,
    CaptureTheFlag,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum GameState {
    Waiting,
    Starting,
    InProgress,
    Ended,
}

#[derive(Clone, Debug)]
pub struct Lobby {
    pub id: u64,
    pub name: String,
    pub host_id: String,
    /// Active map for the current round.
    pub map_id: MapId,
    /// Pool selected by host for round rotation.
    pub map_pool: Vec<MapId>,
    pub map_width: u32,
    pub map_height: u32,
    pub physics_world_id: u64,
    pub max_players: u8,
    pub game_state: GameState,
    pub game_mode: GameMode,
    pub score_limit: i32,
    pub flag_limit: i32,
    pub has_password: bool,
    /// When set, next round starts at this unix timestamp (ms).
    pub next_round_starts_at_ms: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct LobbyPlayer {
    pub id: u64,
    pub lobby_id: u64,
    pub player_identity: String,
    pub name: String,
    pub team: i32,
    pub is_ready: bool,
}

#[derive(Clone, Debug)]
pub struct MapSpawnPoint {
    pub lobby_id: u64,
    pub position_x: f32,
    pub position_z: f32,
    pub team: i32,
}

#[derive(Clone, Debug)]
pub struct MapFlagLocation {
    pub lobby_id: u64,
    pub position_x: f32,
    pub position_z: f32,
    pub team: i32,
}

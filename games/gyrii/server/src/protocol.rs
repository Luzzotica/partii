//! Protocol types - ActionMessage for JSON client actions; server messages use pb::gyrii

use serde::Deserialize;

/// Identity: string (UUID-based for anonymous)
pub type Identity = String;

/// Client -> Server: action message (JSON, client actions stay JSON)
#[derive(Debug, Deserialize)]
pub struct ActionMessage {
    pub action: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// Shot event from combat (used before encoding to proto)
#[derive(Debug, Clone)]
pub struct ShotEventPayload {
    pub player_id: String,
    pub weapon: String,
    pub projectile_type: u8,
    pub position: [f32; 3],
    pub velocity: [f32; 3],
}

/// Kill event from combat (used before encoding to proto)
#[derive(Debug, Clone)]
pub struct KillEventPayload {
    pub killer_id: String,
    pub killer_name: String,
    pub victim_id: String,
    pub victim_name: String,
    pub weapon: String,
    pub timestamp: u64,
}

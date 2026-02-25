//! Action handlers (reducers)

use crate::protocol::Identity;
use crate::state::{Player, ServerState};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;

/// When a new player spawns, broadcast their profile to the lobby
#[derive(Clone)]
pub struct BroadcastPlayerJoined {
    pub lobby_id: u64,
    pub player: Player,
}

pub type ActionResult = Result<Option<BroadcastPlayerJoined>, String>;

/// Route an action to the appropriate handler
pub async fn handle_action(
    state: Arc<RwLock<ServerState>>,
    identity: &Identity,
    action: &str,
    params: Value,
) -> ActionResult {
    match action {
        "authenticate" => auth::authenticate(state, identity, params).await,
        "list_lobbies" => lobby::list_lobbies(state).await,
        "create_lobby" => lobby::create_lobby(state, identity, params).await,
        "join_lobby" => lobby::join_lobby(state, identity, params).await,
        "request_lobby_state" => lobby::request_lobby_state(state, identity).await,
        "leave_lobby" => lobby::leave_lobby(state, identity).await,
        "set_ready" => lobby::set_ready(state, identity, params).await,
        "start_game" => lobby::start_game(state, identity).await,
        "end_game" => lobby::end_game(state, identity, params).await,
        "request_spawn" => player::request_spawn(state, identity, params).await,
        "update_input" => player::update_input(state, identity, params).await,
        "set_shooting" => player::set_shooting(state, identity, params).await,
        "set_loadout" => player::set_loadout(state, identity, params).await,
        "set_marble_config" => player::set_marble_config(state, identity, params).await,
        "shoot" => weapons::shoot(state, identity).await,
        "detonate_rocket" => weapons::detonate_rocket(state, identity).await,
        "throw_grenade" => weapons::throw_grenade(state, identity, params).await,
        "throw_molotov" => weapons::throw_molotov(state, identity, params).await,
        "use_secondary" => weapons::use_secondary(state, identity).await,
        _ => Err(format!("Unknown action: {}", action)),
    }
}

pub mod lobby;
pub mod auth;
pub mod player;
pub mod weapons;

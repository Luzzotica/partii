//! Build action-specific responses (ok/error, direct replies, broadcasts)

use crate::actions::ActionResult;
use crate::registry::Registry;
use crate::state::ServerState;
use crate::sync;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub enum ResponseTarget {
    Direct,
    BroadcastToLobby(u64),
    BroadcastToAll,
}

pub async fn build_action_responses(
    action: &str,
    result: &ActionResult,
    identity: &str,
    state: &Arc<RwLock<ServerState>>,
    registry: &Registry,
) -> Vec<(ResponseTarget, Vec<u8>)> {
    let mut responses = Vec::new();

    match result {
        Ok(maybe_broadcast) => {
            responses.push((ResponseTarget::Direct, sync::build_ok()));

            if let Some(ref broadcast) = maybe_broadcast {
                let msg = sync::build_player_joined(&broadcast.player);
                responses.push((
                    ResponseTarget::BroadcastToLobby(broadcast.lobby_id),
                    msg,
                ));
            }

            match action {
                "join_lobby" => {
                    if let Some(lobby_id) = get_identity_lobby_id(state, identity).await {
                        registry.write().await.set_lobby(identity, Some(lobby_id));
                        if let Some(bytes) =
                            build_lobby_state_for_requester(state, lobby_id).await
                        {
                            responses.push((ResponseTarget::Direct, bytes));
                        }
                    }
                    let bytes = build_lobby_list(state).await;
                    responses.push((ResponseTarget::BroadcastToAll, bytes));
                }
                "create_lobby" => {
                    if let Some(lobby_id) = get_creator_lobby_id(state, identity).await {
                        registry.write().await.set_lobby(identity, Some(lobby_id));
                        if let Some(bytes) =
                            build_lobby_state_for_requester(state, lobby_id).await
                        {
                            responses.push((ResponseTarget::Direct, bytes));
                        }
                    }
                    let bytes = build_lobby_list(state).await;
                    responses.push((ResponseTarget::BroadcastToAll, bytes));
                }
                "request_lobby_state" => {
                    if let Some(lobby_id) = get_identity_lobby_id(state, identity).await {
                        if let Some(bytes) =
                            build_lobby_state_for_requester(state, lobby_id).await
                        {
                            responses.push((ResponseTarget::Direct, bytes));
                        }
                    }
                }
                "request_spawn" => {
                    if let Some(lobby_id) = get_identity_lobby_id(state, identity).await {
                        if let Some((_, bytes)) =
                            build_lobby_state_broadcast(state, lobby_id).await
                        {
                            responses.push((ResponseTarget::BroadcastToLobby(lobby_id), bytes));
                        }
                    }
                }
                "start_game" => {
                    if let Some(lobby_id) = get_identity_lobby_id(state, identity).await {
                        if let Some((_, bytes)) =
                            build_lobby_state_broadcast(state, lobby_id).await
                        {
                            responses.push((ResponseTarget::BroadcastToLobby(lobby_id), bytes));
                        }
                    }
                }
                "leave_lobby" => {
                    let lobby_id_before = registry.read().await.get_lobby(identity);
                    if let Some(lobby_id) = lobby_id_before {
                        let left_msg = sync::build_player_left(identity);
                        responses.push((ResponseTarget::BroadcastToLobby(lobby_id), left_msg));
                    }
                    registry.write().await.set_lobby(identity, None);
                    let bytes = build_lobby_list(state).await;
                    responses.push((ResponseTarget::BroadcastToAll, bytes));
                }
                "list_lobbies" => {
                    let bytes = build_lobby_list(state).await;
                    responses.push((ResponseTarget::Direct, bytes));
                }
                _ => {}
            }
        }
        Err(e) => {
            responses.push((ResponseTarget::Direct, sync::build_error(e)));
        }
    }

    responses
}

async fn get_identity_lobby_id(
    state: &Arc<RwLock<ServerState>>,
    identity: &str,
) -> Option<u64> {
    let state_guard = state.read().await;
    state_guard
        .lobby_players
        .iter()
        .find(|lp| lp.player_identity == identity)
        .map(|lp| lp.lobby_id)
}

async fn get_creator_lobby_id(
    state: &Arc<RwLock<ServerState>>,
    identity: &str,
) -> Option<u64> {
    let state_guard = state.read().await;
    state_guard
        .lobby_players
        .iter()
        .find(|lp| lp.player_identity == identity)
        .map(|lp| lp.lobby_id)
}

async fn build_lobby_state_for_requester(
    state: &Arc<RwLock<ServerState>>,
    lobby_id: u64,
) -> Option<Vec<u8>> {
    let mut state_guard = state.write().await;
    let (lobby_payload, snapshot_id, last_delta_id) = state_guard
        .lobbies
        .get_mut(&lobby_id)
        .map(|lobby| {
            let snapshot_id = lobby.allocate_snapshot_id();
            let last_delta_id = lobby.current_delta_id;
            (lobby.clone(), snapshot_id, last_delta_id)
        })?;
    let players: Vec<_> = state_guard
        .players
        .values()
        .filter(|p| p.lobby_id == lobby_id)
        .cloned()
        .collect();
    let flags: Vec<_> = state_guard
        .flags
        .values()
        .filter(|f| f.lobby_id == lobby_id)
        .cloned()
        .collect();
    Some(sync::build_lobby_state(
        &lobby_payload,
        &players,
        &flags,
        snapshot_id,
        last_delta_id,
    ))
}

async fn build_lobby_state_broadcast(
    state: &Arc<RwLock<ServerState>>,
    lobby_id: u64,
) -> Option<(u64, Vec<u8>)> {
    let mut state_guard = state.write().await;
    let (lobby_payload, snapshot_id, last_delta_id) = state_guard
        .lobbies
        .get_mut(&lobby_id)
        .map(|lobby| {
            let snapshot_id = lobby.allocate_snapshot_id();
            let last_delta_id = lobby.current_delta_id;
            (lobby.clone(), snapshot_id, last_delta_id)
        })?;
    let players: Vec<_> = state_guard
        .players
        .values()
        .filter(|p| p.lobby_id == lobby_id)
        .cloned()
        .collect();
    let flags: Vec<_> = state_guard
        .flags
        .values()
        .filter(|f| f.lobby_id == lobby_id)
        .cloned()
        .collect();
    let bytes = sync::build_lobby_state(
        &lobby_payload,
        &players,
        &flags,
        snapshot_id,
        last_delta_id,
    );
    Some((lobby_id, bytes))
}

async fn build_lobby_list(state: &Arc<RwLock<ServerState>>) -> Vec<u8> {
    let lobbies: Vec<_> = {
        let state_guard = state.read().await;
        state_guard
            .lobbies
            .values()
            .map(|lobby| {
                let player_count = state_guard
                    .lobby_players
                    .iter()
                    .filter(|lp| lp.lobby_id == lobby.id)
                    .count() as u32;
                (lobby.clone(), player_count)
            })
            .collect()
    };
    sync::build_lobby_list(&lobbies)
}
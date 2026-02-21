//! WebSocket connection handler

use crate::actions;
use crate::protocol::{ActionMessage, ErrorMessage, InitMessage, OkMessage};
use crate::registry::Registry;
use crate::state::ServerState;
use crate::stats;
use crate::sync;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

async fn broadcast_lobby_list(state: &Arc<RwLock<ServerState>>, registry: &Registry) {
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
    let lobby_list = sync::build_lobby_list(&lobbies);
    if let Ok(json) = serde_json::to_string(&lobby_list) {
        registry.read().await.broadcast_to_all(&json);
    }
}

/// Handle a single WebSocket connection
pub async fn handle_connection(
    ws_stream: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    state: Arc<RwLock<ServerState>>,
    registry: Registry,
) {
    let identity = Uuid::new_v4().to_string();
    let (mut write, mut read) = ws_stream.split();

    let mut rx = {
        let mut r = registry.write().await;
        r.register(identity.clone())
    };

    // Send init with assigned identity
    let init = InitMessage::new(identity.clone());
    if let Ok(json) = serde_json::to_string(&init) {
        let _ = write.send(Message::Text(json)).await;
    }

    tracing::info!("Client connected: identity={}", identity);

    loop {
        tokio::select! {
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<ActionMessage>(&text) {
                            Ok(action_msg) => {
                                let result = actions::handle_action(
                                    Arc::clone(&state),
                                    &identity,
                                    &action_msg.action,
                                    action_msg.params.clone(),
                                )
                                .await;

                                match result {
                                    Ok(maybe_broadcast) => {
                                        let ok_msg = OkMessage { ok: true };
                                        if let Ok(json) = serde_json::to_string(&ok_msg) {
                                            let _ = write.send(Message::Text(json)).await;
                                        }
                                        if let Some(broadcast) = maybe_broadcast {
                                            let msg = sync::build_player_joined(&broadcast.player);
                                            if let Ok(json) = serde_json::to_string(&msg) {
                                                registry.read().await.broadcast_to_lobby(broadcast.lobby_id, &json);
                                            }
                                        }
                                        if action_msg.action == "join_lobby" {
                                            if let Some(lobby_id) = action_msg.params.get("lobbyId").and_then(|v| v.as_u64()) {
                                                registry.write().await.set_lobby(&identity, Some(lobby_id));
                                                let state_guard = state.read().await;
                                                if let Some(lobby) = state_guard.lobbies.get(&lobby_id) {
                                                    let players: Vec<_> = state_guard.players.values().filter(|p| p.lobby_id == lobby_id).cloned().collect();
                                                    let lobby_state = sync::build_lobby_state(lobby, &players);
                                                    if let Ok(json) = serde_json::to_string(&lobby_state) {
                                                        let _ = write.send(Message::Text(json)).await;
                                                    }
                                                }
                                            }
                                            broadcast_lobby_list(&state, &registry).await;
                                        }
                                        if action_msg.action == "create_lobby" {
                                            let state_guard = state.read().await;
                                            if let Some(lp) = state_guard.lobby_players.iter().find(|lp| lp.player_identity == identity) {
                                                let lobby_id = lp.lobby_id;
                                                registry.write().await.set_lobby(&identity, Some(lobby_id));
                                                if let Some(lobby) = state_guard.lobbies.get(&lobby_id) {
                                                    let players: Vec<_> = state_guard.players.values().filter(|p| p.lobby_id == lobby_id).cloned().collect();
                                                    let lobby_state = sync::build_lobby_state(lobby, &players);
                                                    if let Ok(json) = serde_json::to_string(&lobby_state) {
                                                        let _ = write.send(Message::Text(json)).await;
                                                    }
                                                }
                                            }
                                            broadcast_lobby_list(&state, &registry).await;
                                        }
                                        if action_msg.action == "leave_lobby" {
                                            let lobby_id_before_leave = registry.read().await.get_lobby(&identity);
                                            if let Some(lobby_id) = lobby_id_before_leave {
                                                let left_msg = sync::build_player_left(&identity);
                                                if let Ok(json) = serde_json::to_string(&left_msg) {
                                                    registry.read().await.broadcast_to_lobby(lobby_id, &json);
                                                }
                                            }
                                            registry.write().await.set_lobby(&identity, None);
                                            broadcast_lobby_list(&state, &registry).await;
                                        }
                                        if action_msg.action == "list_lobbies" {
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
                                            let lobby_list = sync::build_lobby_list(&lobbies);
                                            if let Ok(json) = serde_json::to_string(&lobby_list) {
                                                let _ = write.send(Message::Text(json)).await;
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        let err_msg = ErrorMessage { error: e };
                                        if let Ok(json) = serde_json::to_string(&err_msg) {
                                            let _ = write.send(Message::Text(json)).await;
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                let err_msg = ErrorMessage {
                                    error: format!("Invalid message: {}", e),
                                };
                                if let Ok(json) = serde_json::to_string(&err_msg) {
                                    let _ = write.send(Message::Text(json)).await;
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            msg = rx.recv() => {
                if let Some(json) = msg {
                    if write.send(Message::Text(json)).await.is_err() {
                        break;
                    }
                } else {
                    break;
                }
            }
        }
    }

    // If socket closed while still in a lobby, remove from lobby and broadcast player_left.
    let lobby_id_before_disconnect = registry.read().await.get_lobby(&identity);
    if let Some(lobby_id) = lobby_id_before_disconnect {
        let _ = crate::actions::lobby::leave_lobby(Arc::clone(&state), &identity).await;
        let left_msg = sync::build_player_left(&identity);
        if let Ok(json) = serde_json::to_string(&left_msg) {
            registry.read().await.broadcast_to_lobby(lobby_id, &json);
        }
        broadcast_lobby_list(&state, &registry).await;
    }

    registry.write().await.unregister(&identity);
    {
        let mut state_guard = state.write().await;
        stats::clear_identity_user_id(&mut state_guard, &identity);
    }
    tracing::info!("Client disconnected: identity={}", identity);
}

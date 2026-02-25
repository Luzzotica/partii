//! WebSocket connection handler - binary protobuf only

use crate::actions;
use crate::registry::Registry;
use crate::state::ServerState;
use crate::stats;
use crate::sync;
use crate::ws::{build_action_responses, decode_client_message, ResponseTarget};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

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
    let bytes = sync::build_lobby_list(&lobbies);
    registry.read().await.broadcast_to_all(&bytes);
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

    let init_bytes = sync::build_init(&identity);
    let _ = write.send(Message::Binary(init_bytes)).await;

    tracing::info!("Client connected: identity={}", identity);

    loop {
        tokio::select! {
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        if let Some((action, params)) = decode_client_message(&data) {
                            let result = actions::handle_action(
                                Arc::clone(&state),
                                &identity,
                                action,
                                params,
                            )
                            .await;

                            let responses = build_action_responses(
                                action,
                                &result,
                                &identity,
                                &state,
                                &registry,
                            )
                            .await;

                            for (target, bytes) in responses {
                                match target {
                                    ResponseTarget::Direct => {
                                        let _ = write.send(Message::Binary(bytes)).await;
                                    }
                                    ResponseTarget::BroadcastToLobby(lobby_id) => {
                                        registry.read().await.broadcast_to_lobby(lobby_id, &bytes);
                                    }
                                    ResponseTarget::BroadcastToAll => {
                                        registry.read().await.broadcast_to_all(&bytes);
                                    }
                                }
                            }
                        } else {
                            let err_bytes = sync::build_error("Invalid message");
                            let _ = write.send(Message::Binary(err_bytes)).await;
                        }
                    }
                    Some(Ok(Message::Text(_))) => {
                        let err_bytes = sync::build_error("Text messages not supported, use binary protobuf");
                        let _ = write.send(Message::Binary(err_bytes)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            msg = rx.recv() => {
                if let Some(bytes) = msg {
                    if write.send(Message::Binary(bytes)).await.is_err() {
                        break;
                    }
                } else {
                    break;
                }
            }
        }
    }

    let lobby_id_before_disconnect = registry
        .read()
        .await
        .get_lobby(&identity)
        .or(get_identity_lobby_id(&state, &identity).await);
    let _ = crate::actions::lobby::leave_lobby(Arc::clone(&state), &identity).await;
    if let Some(lobby_id) = lobby_id_before_disconnect {
        let left_msg = sync::build_player_left(&identity);
        registry.read().await.broadcast_to_lobby(lobby_id, &left_msg);
    }
    broadcast_lobby_list(&state, &registry).await;

    registry.write().await.unregister(&identity);
    {
        let mut state_guard = state.write().await;
        stats::clear_identity_user_id(&mut state_guard, &identity);
    }
    tracing::info!("Client disconnected: identity={}", identity);
}

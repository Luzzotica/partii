//! Gyrii Rust Physics Server - WebSocket game server with persistent Rapier physics

mod actions;
mod combat;
mod ctf;
mod config;
mod pb;
mod collision_groups;
mod constants;
mod weapon_config;
mod game_loop;
mod map_parser;
mod physics;
mod protocol;
mod registry;
mod stats;
mod state;
mod sync;
mod websocket;
mod ws;

use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_tungstenite::accept_async;

fn load_server_env() {
    let env_file = std::env::var("GYRII_ENV_FILE").unwrap_or_else(|_| ".env".to_string());
    let manifest_env = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), env_file);
    if dotenvy::from_filename(&manifest_env).is_ok() {
        tracing::info!("Loaded environment from {}", manifest_env);
        return;
    }
    tracing::warn!("Could not load env file at {}", manifest_env);
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    load_server_env();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    let host = config::host();
    let port = config::port();
    let addr = format!("{}:{}", host, port);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Gyrii server listening on ws://{}", addr);

    let state = Arc::new(RwLock::new(state::ServerState::default()));
    let registry = Arc::new(RwLock::new(registry::ConnectionRegistry::new()));
    let stats_flush_tx = stats::spawn_stats_flush_worker();
    {
        let mut guard = state.write().await;
        stats::attach_flush_sender(&mut guard, stats_flush_tx);
    }
    game_loop::spawn_game_loop(Arc::clone(&state), Arc::clone(&registry));

    loop {
        let (stream, peer_addr) = listener.accept().await?;
        tracing::debug!("Connection from {}", peer_addr);

        let state = Arc::clone(&state);
        let registry = Arc::clone(&registry);

        tokio::spawn(async move {
            match accept_async(stream).await {
                Ok(ws_stream) => {
                    websocket::handle_connection(ws_stream, state, registry).await;
                }
                Err(e) => {
                    tracing::warn!("WebSocket handshake failed: {}", e);
                }
            }
        });
    }
}

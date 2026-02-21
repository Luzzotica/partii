//! Lobby actions

use crate::actions::ActionResult;
use crate::map_parser::{get_builtin_map_json, parse_map_json};
use crate::physics::{create_map_geometry, PhysicsWorldState};
use crate::protocol::{GameEndedMessage, Identity};
use crate::state::{
    GameMode, GameState, Lobby, LobbyPlayer, MapId, MapFlagLocation, MapSpawnPoint,
    PendingRoundRestart, ServerState,
};
use crate::stats;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

pub const ROUND_RESTART_COUNTDOWN_MS: u64 = 7000;

#[derive(Deserialize)]
struct CreateLobbyParams {
    name: String,
    #[serde(rename = "hostPlayerName")]
    host_player_name: Option<String>,
    #[serde(rename = "mapId")]
    map_id: MapIdParam,
    #[serde(rename = "gameMode")]
    game_mode: GameModeParam,
    #[serde(rename = "maxPlayers")]
    max_players: Option<u8>,
    #[serde(rename = "scoreLimit")]
    score_limit: Option<i32>,
    #[serde(rename = "flagLimit")]
    flag_limit: Option<i32>,
    password: Option<String>,
    #[serde(rename = "customMapJson")]
    custom_map_json: Option<String>,
    #[serde(rename = "mapPool")]
    map_pool: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct JoinLobbyParams {
    #[serde(rename = "lobbyId")]
    lobby_id: u64,
    #[serde(rename = "playerName")]
    player_name: String,
    password: Option<String>,
}

#[derive(Deserialize)]
struct SetReadyParams {
    ready: Option<bool>,
}

#[derive(Deserialize)]
struct EndGameParams {
    #[serde(rename = "lobbyId")]
    lobby_id: u64,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum MapIdParam {
    Tag { tag: String },
    Plain(String),
}

#[derive(Deserialize)]
#[serde(untagged)]
enum GameModeParam {
    Tag { tag: String },
    Plain(String),
}

fn parse_map_id(s: &str) -> Result<MapId, String> {
    MapId::from_pascal(s).ok_or_else(|| format!("Unknown map: {}", s))
}

fn parse_game_mode(s: &str) -> Result<GameMode, String> {
    match s {
        "FreeForAll" => Ok(GameMode::FreeForAll),
        "TeamDeathmatch" => Ok(GameMode::TeamDeathmatch),
        "CaptureTheFlag" => Ok(GameMode::CaptureTheFlag),
        _ => Err(format!("Unknown game mode: {}", s)),
    }
}

pub async fn list_lobbies(state: Arc<RwLock<ServerState>>) -> ActionResult {
    // No-op: websocket handler builds and sends the list from state
    let _ = state;
    Ok(None)
}

pub async fn create_lobby(
    state: Arc<RwLock<ServerState>>,
    identity: &Identity,
    params: Value,
) -> ActionResult {
    let p: CreateLobbyParams = serde_json::from_value(params).map_err(|e| e.to_string())?;

    let mut state = state.write().await;

    if state
        .lobby_players
        .iter()
        .any(|lp| lp.player_identity == *identity)
    {
        return Err("Already in a lobby".to_string());
    }

    let map_id_str = match &p.map_id {
        MapIdParam::Tag { tag } => tag.as_str(),
        MapIdParam::Plain(s) => s.as_str(),
    };
    let game_mode_str = match &p.game_mode {
        GameModeParam::Tag { tag } => tag.as_str(),
        GameModeParam::Plain(s) => s.as_str(),
    };
    let map_id = parse_map_id(map_id_str)?;
    let mut parsed_pool = Vec::new();
    for s in p.map_pool.unwrap_or_default() {
        let map = parse_map_id(&s)?;
        if !parsed_pool.contains(&map) {
            parsed_pool.push(map);
        }
    }
    if parsed_pool.is_empty() {
        parsed_pool.push(map_id);
    }
    let game_mode = parse_game_mode(game_mode_str)?;
    let password = p.password.unwrap_or_default();
    let has_password = !password.is_empty();

    let json = if p
        .custom_map_json
        .as_ref()
        .map(|s| !s.is_empty())
        .unwrap_or(false)
    {
        p.custom_map_json.unwrap()
    } else {
        get_builtin_map_json(map_id).to_string()
    };

    let parsed = parse_map_json(&json)?;

    let lobby_id = state.next_lobby_id;
    state.next_lobby_id += 1;

    let physics_world_id = lobby_id;

    let display_name = p
        .host_player_name
        .as_deref()
        .unwrap_or("Player")
        .trim();
    let display_name = if display_name.is_empty() {
        "Player"
    } else {
        display_name
    };

    let lobby = Lobby {
        id: lobby_id,
        name: p.name.clone(),
        host_id: identity.clone(),
        map_id,
        map_pool: parsed_pool,
        map_width: parsed.width,
        map_height: parsed.height,
        physics_world_id,
        max_players: p.max_players.unwrap_or(8).clamp(2, 16),
        game_state: GameState::Waiting,
        game_mode,
        score_limit: p.score_limit.unwrap_or(25).clamp(3, 50),
        flag_limit: p.flag_limit.unwrap_or(3).clamp(1, 7),
        has_password,
        next_round_starts_at_ms: None,
    };

    let mut physics = PhysicsWorldState::new();
    create_map_geometry(&mut physics, lobby_id, &parsed);
    state.physics_worlds.insert(lobby_id, physics);

    state.lobbies.insert(lobby_id, lobby);

    if has_password {
        state.lobby_secrets.insert(lobby_id, password);
    }

    for (x, z, team) in &parsed.spawn_points {
        state.spawn_points.push(MapSpawnPoint {
            lobby_id,
            position_x: *x,
            position_z: *z,
            team: team.unwrap_or(-1),
        });
    }
    for (x, z, team) in &parsed.flag_locations {
        state.flag_locations.push(MapFlagLocation {
            lobby_id,
            position_x: *x,
            position_z: *z,
            team: *team,
        });
    }

    let lp_id = state.next_lobby_player_id;
    state.next_lobby_player_id += 1;

    state.lobby_players.push(LobbyPlayer {
        id: lp_id,
        lobby_id,
        player_identity: identity.clone(),
        name: display_name.to_string(),
        team: 0,
        is_ready: false,
    });

    tracing::info!("Lobby '{}' created by {}", p.name, identity);
    Ok(None)
}

pub async fn join_lobby(
    state: Arc<RwLock<ServerState>>,
    identity: &Identity,
    params: Value,
) -> ActionResult {
    let p: JoinLobbyParams = serde_json::from_value(params).map_err(|e| e.to_string())?;

    let mut state = state.write().await;

    if state
        .lobby_players
        .iter()
        .any(|lp| lp.player_identity == *identity)
    {
        return Err("Already in a lobby".to_string());
    }

    let lobby = state
        .lobbies
        .get(&p.lobby_id)
        .ok_or("Lobby not found")?
        .clone();

    if lobby.has_password {
        let secret = state
            .lobby_secrets
            .get(&p.lobby_id)
            .ok_or("Lobby secret not found")?;
        if secret != &p.password.unwrap_or_default() {
            return Err("Incorrect password".to_string());
        }
    }

    let player_count = state
        .lobby_players
        .iter()
        .filter(|lp| lp.lobby_id == p.lobby_id)
        .count();

    if player_count >= lobby.max_players as usize {
        return Err("Lobby is full".to_string());
    }

    if lobby.game_state != GameState::Waiting {
        return Err("Game already in progress".to_string());
    }

    let team0 = state
        .lobby_players
        .iter()
        .filter(|lp| lp.lobby_id == p.lobby_id && lp.team == 0)
        .count();
    let team1 = state
        .lobby_players
        .iter()
        .filter(|lp| lp.lobby_id == p.lobby_id && lp.team == 1)
        .count();

    let team = if lobby.game_mode == GameMode::FreeForAll {
        player_count as i32
    } else if team0 <= team1 {
        0
    } else {
        1
    };

    let lp_id = state.next_lobby_player_id;
    state.next_lobby_player_id += 1;

    state.lobby_players.push(LobbyPlayer {
        id: lp_id,
        lobby_id: p.lobby_id,
        player_identity: identity.clone(),
        name: p.player_name.clone(),
        team,
        is_ready: false,
    });

    tracing::info!("{} joined lobby {}", p.player_name, p.lobby_id);
    Ok(None)
}

fn remove_player_from_lobby(state: &mut ServerState, identity: &str) -> Option<u64> {
    let idx = state.lobby_players.iter().position(|lp| lp.player_identity == identity)?;
    let lp = state.lobby_players.remove(idx);
    let lobby_id = lp.lobby_id;

    if let Some(player) = state.players.remove(identity) {
        if player.rigid_body_id > 0 {
            if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
                physics.remove_body(player.rigid_body_id);
            }
        }
    }

    Some(lobby_id)
}

pub async fn leave_lobby(state: Arc<RwLock<ServerState>>, identity: &Identity) -> ActionResult {
    let mut state = state.write().await;

    let lobby_id = remove_player_from_lobby(&mut state, identity).ok_or("Not in a lobby")?;

    let remaining: Vec<_> = state
        .lobby_players
        .iter()
        .filter(|p| p.lobby_id == lobby_id)
        .cloned()
        .collect();

    if remaining.is_empty() {
        stats::finalize_match_tracking(&mut state, lobby_id);
        state.lobbies.remove(&lobby_id);
        state.lobby_secrets.remove(&lobby_id);
        state.physics_worlds.remove(&lobby_id);
        state.spawn_points.retain(|s| s.lobby_id != lobby_id);
        state.flag_locations.retain(|f| f.lobby_id != lobby_id);
        tracing::info!("Deleted empty lobby {}", lobby_id);
    } else if let Some(lobby) = state.lobbies.get_mut(&lobby_id) {
        if lobby.host_id == *identity {
            lobby.host_id = remaining[0].player_identity.clone();
            tracing::info!("Host transferred to {}", lobby.host_id);
        }
    }

    Ok(None)
}

pub async fn set_ready(
    state: Arc<RwLock<ServerState>>,
    identity: &Identity,
    params: Value,
) -> ActionResult {
    let p: SetReadyParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
    let ready = p.ready.unwrap_or(true);

    let mut state = state.write().await;

    let lp = state
        .lobby_players
        .iter_mut()
        .find(|lp| lp.player_identity == *identity)
        .ok_or("Not in a lobby")?;

    lp.is_ready = ready;
    Ok(None)
}

pub async fn start_game(state: Arc<RwLock<ServerState>>, identity: &Identity) -> ActionResult {
    let mut state = state.write().await;

    let lp = state
        .lobby_players
        .iter()
        .find(|lp| lp.player_identity == *identity)
        .ok_or("Not in a lobby")?
        .clone();

    let all_ready = state
        .lobby_players
        .iter()
        .filter(|p| p.lobby_id == lp.lobby_id)
        .all(|p| p.is_ready || p.player_identity == *identity);

    if !all_ready {
        return Err("Not all players are ready".to_string());
    }

    let lobby = state
        .lobbies
        .get_mut(&lp.lobby_id)
        .ok_or("Lobby not found")?;

    if lobby.host_id != *identity {
        return Err("Only host can start the game".to_string());
    }

    lobby.game_state = GameState::InProgress;
    stats::start_match_tracking(&mut state, lp.lobby_id);
    tracing::info!("Game started in lobby {}", lp.lobby_id);
    Ok(None)
}

pub async fn end_game(
    state: Arc<RwLock<ServerState>>,
    _identity: &Identity,
    params: Value,
) -> ActionResult {
    let p: EndGameParams = serde_json::from_value(params).map_err(|e| e.to_string())?;

    let mut state = state.write().await;

    let _ = state.lobbies.get(&p.lobby_id).ok_or("Lobby not found")?;
    let _ = end_round_and_schedule(
        &mut state,
        p.lobby_id,
        None,
        ROUND_RESTART_COUNTDOWN_MS,
    );
    tracing::info!("Game ended in lobby {}", p.lobby_id);
    Ok(None)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn pick_next_map_from_pool(lobby: &Lobby) -> MapId {
    if lobby.map_pool.is_empty() {
        return lobby.map_id;
    }
    let seed = now_millis()
        .wrapping_add(lobby.id.wrapping_mul(7919))
        .wrapping_add(lobby.score_limit as u64);
    let idx = (seed as usize) % lobby.map_pool.len();
    lobby.map_pool[idx]
}

pub fn end_round_and_schedule(
    state: &mut ServerState,
    lobby_id: u64,
    winner_hint: Option<(Option<i32>, Option<String>, Option<String>)>,
    countdown_ms: u64,
) -> Option<GameEndedMessage> {
    let (game_mode, next_map_id) = {
        let lobby = state.lobbies.get(&lobby_id)?;
        if lobby.game_state == GameState::Ended {
            return None;
        }
        (lobby.game_mode, pick_next_map_from_pool(lobby))
    };

    let (winner_team, winner_player_identity, winner_player_name) = if let Some(hint) = winner_hint
    {
        hint
    } else {
        let players: Vec<_> = state
            .players
            .values()
            .filter(|p| p.lobby_id == lobby_id)
            .cloned()
            .collect();
        if game_mode == GameMode::FreeForAll {
            let winner = players
                .iter()
                .max_by(|a, b| a.kills.cmp(&b.kills).then(b.deaths.cmp(&a.deaths)));
            (
                None,
                winner.map(|p| p.identity.clone()),
                winner.map(|p| p.name.clone()),
            )
        } else {
            let mut kills_by_team: HashMap<i32, i32> = HashMap::new();
            for p in &players {
                *kills_by_team.entry(p.team).or_insert(0) += p.kills;
            }
            let winner_team = kills_by_team
                .into_iter()
                .max_by_key(|(_, kills)| *kills)
                .map(|(team, _)| team);
            let winner_player = winner_team.and_then(|team| {
                players
                    .iter()
                    .filter(|p| p.team == team)
                    .max_by(|a, b| a.kills.cmp(&b.kills).then(b.deaths.cmp(&a.deaths)))
            });
            (
                winner_team,
                winner_player.map(|p| p.identity.clone()),
                winner_player.map(|p| p.name.clone()),
            )
        }
    };

    if let Some(lobby) = state.lobbies.get_mut(&lobby_id) {
        lobby.game_state = GameState::Ended;
    }

    let rigid_ids: Vec<u64> = state
        .players
        .values()
        .filter(|p| p.lobby_id == lobby_id && p.rigid_body_id > 0)
        .map(|p| p.rigid_body_id)
        .collect();
    // Freeze current round and force all players into respawn/loadout state.
    for p in state.players.values_mut().filter(|p| p.lobby_id == lobby_id) {
        p.is_alive = false;
        p.is_shooting = false;
    }
    if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
        for rb_id in rigid_ids {
            physics.set_body_enabled(rb_id, false);
        }
    }

    stats::finalize_match_tracking(state, lobby_id);
    let starts_at_ms = now_millis().saturating_add(countdown_ms);
    if let Some(lobby) = state.lobbies.get_mut(&lobby_id) {
        lobby.next_round_starts_at_ms = Some(starts_at_ms);
    }
    state.pending_round_restarts.insert(
        lobby_id,
        PendingRoundRestart {
            next_map_id,
            starts_at_ms,
        },
    );

    Some(crate::sync::build_game_ended(
        lobby_id,
        winner_team,
        winner_player_identity,
        winner_player_name,
        next_map_id,
        countdown_ms,
    ))
}

pub fn process_scheduled_round_restarts(state: &mut ServerState) -> Vec<u64> {
    let now = now_millis();
    let due: Vec<u64> = state
        .pending_round_restarts
        .iter()
        .filter(|(_, r)| now >= r.starts_at_ms)
        .map(|(lobby_id, _)| *lobby_id)
        .collect();

    let mut restarted = Vec::new();
    for lobby_id in due {
        if restart_lobby_round(state, lobby_id) {
            restarted.push(lobby_id);
        }
    }
    restarted
}

fn restart_lobby_round(state: &mut ServerState, lobby_id: u64) -> bool {
    let schedule = match state.pending_round_restarts.remove(&lobby_id) {
        Some(s) => s,
        None => return false,
    };
    let map_id = schedule.next_map_id;
    let map_json = get_builtin_map_json(map_id);
    let parsed = match parse_map_json(map_json) {
        Ok(m) => m,
        Err(err) => {
            tracing::error!("Failed to parse next map for lobby {}: {}", lobby_id, err);
            return false;
        }
    };

    let mut physics = PhysicsWorldState::new();
    create_map_geometry(&mut physics, lobby_id, &parsed);
    state.physics_worlds.insert(lobby_id, physics);

    state.spawn_points.retain(|s| s.lobby_id != lobby_id);
    state.flag_locations.retain(|f| f.lobby_id != lobby_id);
    for (x, z, team) in &parsed.spawn_points {
        state.spawn_points.push(MapSpawnPoint {
            lobby_id,
            position_x: *x,
            position_z: *z,
            team: team.unwrap_or(-1),
        });
    }
    for (x, z, team) in &parsed.flag_locations {
        state.flag_locations.push(MapFlagLocation {
            lobby_id,
            position_x: *x,
            position_z: *z,
            team: *team,
        });
    }

    let projectile_ids: Vec<u64> = state
        .projectiles
        .iter()
        .filter(|(_, p)| p.lobby_id == lobby_id)
        .map(|(id, _)| *id)
        .collect();
    for id in projectile_ids {
        state.projectiles.remove(&id);
    }

    let grenade_ids: Vec<u64> = state
        .grenades
        .iter()
        .filter(|(_, g)| g.lobby_id == lobby_id)
        .map(|(id, _)| *id)
        .collect();
    for id in &grenade_ids {
        state.grenades.remove(id);
        state.grenade_inserts_sent.remove(id);
    }
    state
        .grenade_deletes_this_tick
        .retain(|(_, lid)| *lid != lobby_id);
    state.photon_beams.retain(|_, b| b.lobby_id != lobby_id);

    for p in state.players.values_mut().filter(|p| p.lobby_id == lobby_id) {
        p.rigid_body_id = 0;
        p.is_alive = false;
        p.health = p.max_health;
        p.kills = 0;
        p.deaths = 0;
        p.flag_captures = 0;
        p.velocity_x = 0.0;
        p.velocity_y = 0.0;
        p.velocity_z = 0.0;
        p.input_x = 0.0;
        p.input_z = 0.0;
        p.aim_x = 0.0;
        p.aim_z = -1.0;
        p.is_shooting = false;
        p.last_shot_at = 0;
        p.last_grenade_thrown_at = 0;
        p.last_impulse_x = 0.0;
        p.last_impulse_y = 0.0;
        p.last_impulse_z = 0.0;
        p.last_impulse_time = 0;
        p.photon_rifle_charge_started_at = None;
        p.grenades = 2;
        p.molotovs = 1;
    }

    if let Some(lobby) = state.lobbies.get_mut(&lobby_id) {
        lobby.map_id = map_id;
        lobby.map_width = parsed.width;
        lobby.map_height = parsed.height;
        lobby.game_state = GameState::InProgress;
        lobby.next_round_starts_at_ms = None;
    }

    stats::start_match_tracking(state, lobby_id);
    true
}

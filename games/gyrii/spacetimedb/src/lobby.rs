// Lobby management reducers

use spacetimedb::{reducer, table, Identity, ReducerContext, SpacetimeType, Table, Timestamp};
use spacetime_rapier::PhysicsWorld;

use crate::game::{schedule_physics_tick, GameState};
use crate::maps::{create_map_geometry, MapId};
use crate::player::{create_player_in_lobby, remove_player};

// Re-export table traits for other modules
pub use lobby::lobby;
pub use lobby_player::lobby_player;
pub use lobby_secret::lobby_secret;

// ============================================================================
// LOBBY TABLE
// ============================================================================

#[derive(Clone)]
#[table(name = lobby, public)]
pub struct Lobby {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub host_id: Identity,
    pub map_id: MapId,
    pub physics_world_id: u64,
    pub max_players: u8,
    pub game_state: GameState,
    pub game_mode: GameMode,
    pub created_at: Timestamp,
    pub score_limit: i32,
    pub time_limit_seconds: i32,
    pub has_password: bool,
}

// ============================================================================
// LOBBY SECRET TABLE (private - server only, invisible to clients)
// ============================================================================

#[derive(Clone)]
#[table(name = lobby_secret, private)]
pub struct LobbySecret {
    #[primary_key]
    pub lobby_id: u64,
    pub password: String,
}

// ============================================================================
// LOBBY PLAYER TABLE
// ============================================================================

#[derive(Clone)]
#[table(name = lobby_player, public)]
pub struct LobbyPlayer {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub lobby_id: u64,
    pub player_identity: Identity,
    pub team: i32,
    pub is_ready: bool,
    pub joined_at: Timestamp,
}

// ============================================================================
// GAME MODE
// ============================================================================

#[derive(Clone, Copy, PartialEq, Eq, Debug, SpacetimeType)]
pub enum GameMode {
    FreeForAll,
    TeamDeathmatch,
    CaptureTheFlag,
}

// ============================================================================
// LOBBY REDUCERS
// ============================================================================

#[reducer]
pub fn create_lobby(
    ctx: &ReducerContext,
    name: String,
    map_id: MapId,
    game_mode: GameMode,
    max_players: u8,
    score_limit: i32,
    password: String, // empty string = no password
) -> Result<(), String> {
    let identity = ctx.sender;
    
    // Check if player already in a lobby
    if ctx.db.lobby_player().iter().any(|lp| lp.player_identity == identity) {
        return Err("Already in a lobby".to_string());
    }
    
    let has_password = !password.is_empty();
    
    // Create physics world for this lobby
    let world = PhysicsWorld::builder()
        .ticks_per_second(60.0)
        .gravity_y(-9.81)
        .build()
        .insert(ctx);
    
    // Create the lobby
    let lobby = Lobby {
        id: 0, // auto_inc
        name: name.clone(),
        host_id: identity,
        map_id,
        physics_world_id: world.id,
        max_players: max_players.clamp(2, 16),
        game_state: GameState::Waiting,
        game_mode,
        created_at: ctx.timestamp,
        score_limit,
        time_limit_seconds: 600, // 10 minutes default
        has_password,
    };
    let lobby = ctx.db.lobby().insert(lobby);
    
    // Store password in private table if set
    if has_password {
        ctx.db.lobby_secret().insert(LobbySecret {
            lobby_id: lobby.id,
            password,
        });
    }
    
    // Create map geometry
    create_map_geometry(ctx, lobby.id, lobby.physics_world_id, map_id);

    // Start physics tick so player positions sync from Rapier immediately (movement works in lobby)
    schedule_physics_tick(ctx, lobby.physics_world_id);

    // Add host as first player
    ctx.db.lobby_player().insert(LobbyPlayer {
        id: 0,
        lobby_id: lobby.id,
        player_identity: identity,
        team: 0,
        is_ready: false,
        joined_at: ctx.timestamp,
    });
    
    // Create player entity
    create_player_in_lobby(ctx, identity, "Host".to_string(), &lobby, 0)?;
    
    log::info!("Lobby '{}' created by {:?}", name, identity);
    Ok(())
}

#[reducer]
pub fn join_lobby(ctx: &ReducerContext, lobby_id: u64, player_name: String, password: String) -> Result<(), String> {
    let identity = ctx.sender;
    
    // Check if player already in a lobby
    if ctx.db.lobby_player().iter().any(|lp| lp.player_identity == identity) {
        return Err("Already in a lobby".to_string());
    }
    
    // Find lobby
    let lobby = ctx.db.lobby().id().find(lobby_id)
        .ok_or("Lobby not found")?;
    
    // Validate password if lobby is password-protected
    if lobby.has_password {
        let secret = ctx.db.lobby_secret().lobby_id().find(lobby_id)
            .ok_or("Lobby secret not found")?;
        if secret.password != password {
            return Err("Incorrect password".to_string());
        }
    }
    
    // Check if lobby is full
    let player_count = ctx.db.lobby_player().iter()
        .filter(|lp| lp.lobby_id == lobby_id)
        .count();
    
    if player_count >= lobby.max_players as usize {
        return Err("Lobby is full".to_string());
    }
    
    // Check game state
    if lobby.game_state != GameState::Waiting {
        return Err("Game already in progress".to_string());
    }
    
    // Assign team (balance teams)
    let team = if lobby.game_mode == GameMode::FreeForAll {
        player_count as i32
    } else {
        let team0_count = ctx.db.lobby_player().iter()
            .filter(|lp| lp.lobby_id == lobby_id && lp.team == 0)
            .count();
        let team1_count = ctx.db.lobby_player().iter()
            .filter(|lp| lp.lobby_id == lobby_id && lp.team == 1)
            .count();
        if team0_count <= team1_count { 0 } else { 1 }
    };
    
    // Add to lobby_player
    ctx.db.lobby_player().insert(LobbyPlayer {
        id: 0,
        lobby_id,
        player_identity: identity,
        team,
        is_ready: false,
        joined_at: ctx.timestamp,
    });
    
    // Create player entity
    create_player_in_lobby(ctx, identity, player_name.clone(), &lobby, team)?;
    
    log::info!("{} joined lobby {}", player_name, lobby_id);
    Ok(())
}

#[reducer]
pub fn leave_lobby(ctx: &ReducerContext) -> Result<(), String> {
    let identity = ctx.sender;
    
    // Find player's lobby membership
    let lp = ctx.db.lobby_player().iter()
        .find(|lp| lp.player_identity == identity)
        .ok_or("Not in a lobby")?
        .clone();
    
    let lobby_id = lp.lobby_id;
    
    // Remove player
    ctx.db.lobby_player().id().delete(lp.id);
    remove_player(ctx, identity);
    
    // Check if lobby is empty or host left
    let remaining_players: Vec<_> = ctx.db.lobby_player().iter()
        .filter(|p| p.lobby_id == lobby_id)
        .collect();
    
    if remaining_players.is_empty() {
        // Delete empty lobby and its secret
        if let Some(lobby) = ctx.db.lobby().id().find(lobby_id) {
            if let Some(world) = PhysicsWorld::find(ctx, lobby.physics_world_id) {
                world.delete(ctx);
            }
            // Clean up password secret if it exists
            ctx.db.lobby_secret().lobby_id().delete(lobby_id);
            ctx.db.lobby().id().delete(lobby_id);
            log::info!("Deleted empty lobby {}", lobby_id);
        }
    } else if let Some(lobby) = ctx.db.lobby().id().find(lobby_id) {
        if lobby.host_id == identity {
            // Transfer host to next player
            let new_host = remaining_players[0].player_identity;
            let mut updated_lobby = lobby.clone();
            updated_lobby.host_id = new_host;
            ctx.db.lobby().id().update(updated_lobby);
            log::info!("Host transferred to {:?}", new_host);
        }
    }
    
    Ok(())
}

#[reducer]
pub fn set_ready(ctx: &ReducerContext, ready: bool) -> Result<(), String> {
    let identity = ctx.sender;
    
    let mut lp = ctx.db.lobby_player().iter()
        .find(|lp| lp.player_identity == identity)
        .ok_or("Not in a lobby")?
        .clone();
    
    lp.is_ready = ready;
    ctx.db.lobby_player().id().update(lp);
    
    Ok(())
}

#[reducer]
pub fn start_game(ctx: &ReducerContext) -> Result<(), String> {
    let identity = ctx.sender;
    
    // Find player's lobby
    let lp = ctx.db.lobby_player().iter()
        .find(|lp| lp.player_identity == identity)
        .ok_or("Not in a lobby")?;
    
    let lobby_id = lp.lobby_id;
    
    let lobby = ctx.db.lobby().id().find(lobby_id)
        .ok_or("Lobby not found")?;
    
    // Only host can start
    if lobby.host_id != identity {
        return Err("Only host can start the game".to_string());
    }
    
    // Check all players are ready
    let all_ready = ctx.db.lobby_player().iter()
        .filter(|p| p.lobby_id == lobby_id)
        .all(|p| p.is_ready || p.player_identity == identity);
    
    if !all_ready {
        return Err("Not all players are ready".to_string());
    }
    
    // Update game state (physics tick already running since create_lobby)
    let mut updated_lobby = lobby.clone();
    updated_lobby.game_state = GameState::InProgress;
    ctx.db.lobby().id().update(updated_lobby);

    log::info!("Game started in lobby {}", lobby_id);
    Ok(())
}

#[reducer]
pub fn end_game(ctx: &ReducerContext, lobby_id: u64) -> Result<(), String> {
    let mut lobby = ctx.db.lobby().id().find(lobby_id)
        .ok_or("Lobby not found")?;
    
    lobby.game_state = GameState::Ended;
    ctx.db.lobby().id().update(lobby);
    
    log::info!("Game ended in lobby {}", lobby_id);
    Ok(())
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

pub fn get_lobby_player_count(ctx: &ReducerContext, lobby_id: u64) -> usize {
    ctx.db.lobby_player().iter()
        .filter(|lp| lp.lobby_id == lobby_id)
        .count()
}

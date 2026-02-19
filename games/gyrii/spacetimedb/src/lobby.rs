// Lobby management reducers

use spacetimedb::{reducer, table, Identity, ReducerContext, SpacetimeType, Table, Timestamp};
use spacetime_rapier::PhysicsWorld;

use crate::game::{schedule_physics_tick, GameState};
use crate::map_parser::{get_builtin_map_json, parse_map_json};
use crate::maps::{
    create_map_geometry, map_flag_location, map_spawn_point, map_wall, MapFlagLocation, MapId,
    MapSpawnPoint,
};
use crate::player::remove_player;

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
    pub map_width: u32,
    pub map_height: u32,
    pub physics_world_id: u64,
    pub max_players: u8,
    pub game_state: GameState,
    pub game_mode: GameMode,
    pub created_at: Timestamp,
    pub score_limit: i32,
    pub time_limit_seconds: i32,
    pub has_password: bool,
    pub friendly_fire: FriendlyFire,
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
    pub name: String,
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

#[derive(Clone, Copy, PartialEq, Eq, Debug, SpacetimeType)]
pub enum FriendlyFire {
    Off,
    Reduced,
    Full,
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
    custom_map_json: String, // non-empty = use this JSON instead of built-in for map_id
) -> Result<(), String> {
    let identity = ctx.sender;

    if ctx.db.lobby_player().iter().any(|lp| lp.player_identity == identity) {
        return Err("Already in a lobby".to_string());
    }

    let has_password = !password.is_empty();

    // Parse map JSON once: custom or built-in
    let json = if custom_map_json.is_empty() {
        get_builtin_map_json(map_id)
    } else {
        custom_map_json.as_str()
    };
    let parsed = parse_map_json(json)?;

    let world = PhysicsWorld::builder()
        .ticks_per_second(60.0)
        .gravity_y(-9.81)
        .build()
        .insert(ctx);

    let lobby = Lobby {
        id: 0,
        name: name.clone(),
        host_id: identity,
        map_id,
        map_width: parsed.width,
        map_height: parsed.height,
        physics_world_id: world.id,
        max_players: max_players.clamp(2, 16),
        game_state: GameState::Waiting,
        game_mode,
        created_at: ctx.timestamp,
        score_limit,
        time_limit_seconds: 600,
        has_password,
        friendly_fire: FriendlyFire::Off,
    };
    let lobby = ctx.db.lobby().insert(lobby);

    if has_password {
        ctx.db.lobby_secret().insert(LobbySecret {
            lobby_id: lobby.id,
            password,
        });
    }

    // Store spawn points and flag locations (parsed once, used for spawn/CTF)
    for (x, z, team) in &parsed.spawn_points {
        ctx.db.map_spawn_point().insert(MapSpawnPoint {
            id: 0,
            lobby_id: lobby.id,
            position_x: *x,
            position_z: *z,
            team: team.unwrap_or(-1),
        });
    }
    for (x, z, team) in &parsed.flag_locations {
        ctx.db.map_flag_location().insert(MapFlagLocation {
            id: 0,
            lobby_id: lobby.id,
            position_x: *x,
            position_z: *z,
            team: *team,
        });
    }

    create_map_geometry(ctx, lobby.id, lobby.physics_world_id, &parsed);

    schedule_physics_tick(ctx, lobby.physics_world_id);

    ctx.db.lobby_player().insert(LobbyPlayer {
        id: 0,
        lobby_id: lobby.id,
        player_identity: identity,
        name: "Host".to_string(),
        team: 0,
        is_ready: false,
        joined_at: ctx.timestamp,
    });

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
        name: player_name.clone(),
        team,
        is_ready: false,
        joined_at: ctx.timestamp,
    });
    
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
        if let Some(lobby) = ctx.db.lobby().id().find(lobby_id) {
            let world_id = lobby.physics_world_id;
            if let Some(world) = PhysicsWorld::find(ctx, world_id) {
                world.delete(ctx);
            }
            for row in ctx.db.map_spawn_point().iter().filter(|s| s.lobby_id == lobby_id) {
                ctx.db.map_spawn_point().id().delete(row.id);
            }
            for row in ctx.db.map_flag_location().iter().filter(|f| f.lobby_id == lobby_id) {
                ctx.db.map_flag_location().id().delete(row.id);
            }
            for row in ctx.db.map_wall().iter().filter(|w| w.lobby_id == lobby_id) {
                ctx.db.map_wall().id().delete(row.id);
            }
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

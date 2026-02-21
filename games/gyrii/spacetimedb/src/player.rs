// Player tables and reducers

use spacetimedb::{reducer, table, Identity, ReducerContext, SpacetimeType, Table, Timestamp};
use spacetime_rapier::{Collider, RigidBody, RigidBodyProperties, RigidBodyType, Vec3};

use crate::collision_groups::{GROUP_BULLET, GROUP_FLOOR, GROUP_GRENADE, GROUP_PLAYER, GROUP_WALL};
use crate::constants::{PLAYER_ACCEL, PLAYER_DAMPING, PLAYER_INPUT_TICK_DT};
use crate::lobby::{lobby, lobby_player, lobby_secret, Lobby};
use crate::ctf::get_flag_spawn_position;
use crate::lobby::GameMode;
use crate::maps::{get_best_spawn_position, get_spawn_position};

// Re-export table trait for other modules
pub use player::player;

// ============================================================================
// PLAYER TABLE
// ============================================================================

#[derive(Clone)]
#[table(name = player, public)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,
    pub name: String,
    #[index(btree)]
    pub lobby_id: u64,
    pub rigid_body_id: u64,
    // Position stored as separate components for SpacetimeDB
    pub position_x: f32,
    pub position_y: f32,
    pub position_z: f32,
    /// Spawn position; player does not collide with other players until moved 1 unit away.
    pub spawn_x: f32,
    pub spawn_y: f32,
    pub spawn_z: f32,
    pub health: i32,
    pub max_health: i32,
    pub is_alive: bool,
    pub team: i32,
    pub kills: i32,
    pub deaths: i32,
    pub flag_captures: i32,
    pub weapon: WeaponType,
    pub secondary: SecondaryType,
    pub grenades: i32,
    pub molotovs: i32,
    pub color_r: f32,
    pub color_g: f32,
    pub color_b: f32,
    pub design_id: u8,
    pub secondary_color_r: f32,
    pub secondary_color_g: f32,
    pub secondary_color_b: f32,
    pub velocity_x: f32,
    pub velocity_y: f32,
    pub velocity_z: f32,
    /// Monotonic server-authored snapshot id for position/velocity reconciliation.
    pub server_snapshot_id: u64,
    pub input_x: f32,
    pub input_z: f32,
    pub aim_x: f32,
    pub aim_z: f32,
    pub is_shooting: bool,
    pub respawn_at: i64,
    pub last_shot_at: i64,
    /// Last time player threw a grenade (micros since epoch); used for cooldown.
    pub last_grenade_thrown_at: i64,
    pub joined_at: Timestamp,
    /// Last impulse applied (e.g. from bullet hit); client adds to predicted velocity once. 0,0,0 and 0 = none.
    pub last_impulse_x: f32,
    pub last_impulse_y: f32,
    pub last_impulse_z: f32,
    pub last_impulse_time: i64,
}

impl Player {
    /// Get position as Vec3
    pub fn position(&self) -> Vec3 {
        Vec3::new(self.position_x, self.position_y, self.position_z)
    }
    
    /// Set position from Vec3
    pub fn set_position(&mut self, pos: Vec3) {
        self.position_x = pos.x;
        self.position_y = pos.y;
        self.position_z = pos.z;
    }
}

// ============================================================================
// WEAPON & SECONDARY TYPES
// ============================================================================

#[derive(Clone, Copy, PartialEq, Eq, Debug, SpacetimeType)]
pub enum WeaponType {
    Smg,
    DualMachineGun,
    ChainGun,
    PhotonRifle,
    Bazooka,
    Flamethrower,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, SpacetimeType)]
pub enum SecondaryType {
    PopupKnives,
    BubbleShield,
    SelfDestructNuke,
}

// ============================================================================
// PLAYER CREATION
// ============================================================================

/// Creates a player entity at the given spawn position with the given loadout.
/// Used by request_spawn (random spawn) and optionally by create_player_in_lobby (team spawn).
pub fn create_player_at(
    ctx: &ReducerContext,
    identity: Identity,
    name: String,
    lobby: &Lobby,
    team: i32,
    spawn_pos: Vec3,
    weapon: WeaponType,
    secondary: SecondaryType,
) -> Result<Player, String> {
    // Create rigid body properties for player (dynamic, with damping so it slows when input stops)
    let rb_properties = RigidBodyProperties::builder()
        .world_id(lobby.physics_world_id)
        .mass(1.0)
        .restitution(0.3) // slight bounce off walls
        .linear_damping(3.5) // marble slows when input released
        .ccd_enabled(true) // prevent tunneling through walls at speed
        .build()
        .insert(ctx);

    let mut collider = Collider::ball(lobby.physics_world_id, 0.5);
    collider.collision_memberships = GROUP_PLAYER;
    collider.collision_filter = GROUP_BULLET | GROUP_WALL | GROUP_FLOOR | GROUP_GRENADE;
    let collider = collider.insert(ctx);

    // Create dynamic rigid body - Rapier handles collision with walls; we only set velocity from input
    let rigid_body = RigidBody::builder()
        .world_id(lobby.physics_world_id)
        .position_x(spawn_pos.x)
        .position_y(spawn_pos.y)
        .position_z(spawn_pos.z)
        .collider_id(collider.id)
        .properties_id(rb_properties.id)
        .body_type(RigidBodyType::Dynamic)
        .build()
        .insert(ctx);

    let player = Player {
        identity,
        name,
        lobby_id: lobby.id,
        rigid_body_id: rigid_body.id,
        position_x: spawn_pos.x,
        position_y: spawn_pos.y,
        position_z: spawn_pos.z,
        spawn_x: spawn_pos.x,
        spawn_y: spawn_pos.y,
        spawn_z: spawn_pos.z,
        health: crate::constants::MAX_HEALTH,
        max_health: crate::constants::MAX_HEALTH,
        is_alive: true,
        team,
        kills: 0,
        deaths: 0,
        flag_captures: 0,
        weapon,
        secondary,
        grenades: 100,
        molotovs: 1,
        color_r: 0.0,
        color_g: 1.0,
        color_b: 1.0,
        design_id: 0,
        secondary_color_r: 1.0,
        secondary_color_g: 0.0,
        secondary_color_b: 0.5,
        velocity_x: 0.0,
        velocity_y: 0.0,
        velocity_z: 0.0,
        server_snapshot_id: ctx.timestamp.to_micros_since_unix_epoch() as u64,
        input_x: 0.0,
        input_z: 0.0,
        aim_x: 0.0,
        aim_z: -1.0,
        is_shooting: false,
        respawn_at: 0,
        last_shot_at: 0,
        last_grenade_thrown_at: 0,
        joined_at: ctx.timestamp,
        last_impulse_x: 0.0,
        last_impulse_y: 0.0,
        last_impulse_z: 0.0,
        last_impulse_time: 0,
    };

    ctx.db.player().insert(player.clone());
    Ok(player)
}

/// Legacy: create player at team spawn with default loadout. Used when something needs to spawn by team (e.g. tests).
pub fn create_player_in_lobby(
    ctx: &ReducerContext,
    identity: Identity,
    name: String,
    lobby: &Lobby,
    team: i32,
) -> Result<Player, String> {
    let spawn_pos = get_spawn_position(ctx, lobby.id, team as usize);
    create_player_at(
        ctx,
        identity,
        name,
        lobby,
        team,
        spawn_pos,
        WeaponType::Smg,
        SecondaryType::PopupKnives,
    )
}

#[reducer]
pub fn request_spawn(
    ctx: &ReducerContext,
    weapon: WeaponType,
    secondary: SecondaryType,
) -> Result<(), String> {
    let identity = ctx.sender;

    // Respawn case: player exists but is dead → respawn with new loadout
    if let Some(mut player) = ctx.db.player().identity().find(identity) {
        if player.is_alive {
            return Err("Already spawned".to_string());
        }
        let lobby = ctx
            .db
            .lobby()
            .id()
            .find(player.lobby_id)
            .ok_or("Lobby not found")?;
        let existing: Vec<(Vec3, i32)> = ctx
            .db
            .player()
            .iter()
            .filter(|p| p.lobby_id == lobby.id && p.is_alive && p.identity != identity)
            .map(|p| (Vec3::new(p.position_x, p.position_y, p.position_z), p.team))
            .collect();
        let seed = ctx.timestamp.to_micros_since_unix_epoch() as u64;
        let is_team_mode = lobby.game_mode != GameMode::FreeForAll;
        let spawn_pos = get_best_spawn_position(
            ctx,
            lobby.id,
            player.team,
            is_team_mode,
            &existing,
            seed,
        );
        player.health = crate::constants::MAX_HEALTH;
        player.max_health = crate::constants::MAX_HEALTH;
        player.is_alive = true;
        player.respawn_at = 0;
        player.weapon = weapon;
        player.secondary = secondary;
        player.position_x = spawn_pos.x;
        player.position_y = spawn_pos.y;
        player.position_z = spawn_pos.z;
        player.spawn_x = spawn_pos.x;
        player.spawn_y = spawn_pos.y;
        player.spawn_z = spawn_pos.z;
        player.velocity_x = 0.0;
        player.velocity_y = 0.0;
        player.velocity_z = 0.0;
        player.server_snapshot_id = ctx.timestamp.to_micros_since_unix_epoch() as u64;
        player.input_x = 0.0;
        player.input_z = 0.0;
        player.aim_x = 0.0;
        player.aim_z = -1.0;
        player.is_shooting = false;
        player.last_impulse_x = 0.0;
        player.last_impulse_y = 0.0;
        player.last_impulse_z = 0.0;
        player.last_impulse_time = 0;
        ctx.db.player().identity().update(player.clone());
        // Sync RigidBody position and velocity; re-enable body for respawn
        if player.rigid_body_id > 0 {
            if let Some(mut rb) = RigidBody::find(ctx, player.rigid_body_id) {
                rb.position_x = spawn_pos.x;
                rb.position_y = spawn_pos.y;
                rb.position_z = spawn_pos.z;
                rb.linear_velocity_x = 0.0;
                rb.linear_velocity_y = 0.0;
                rb.linear_velocity_z = 0.0;
                rb.enabled = true;
                rb.update(ctx);
                // Reset collider filter so player does not collide with others until moved 1 unit
                if let Some(mut col) = Collider::find(ctx, rb.collider_id) {
                    col.collision_filter = GROUP_BULLET | GROUP_WALL | GROUP_FLOOR | GROUP_GRENADE;
                    col.update(ctx);
                }
            }
        }
        return Ok(());
    }

    // Initial spawn: no Player row yet
    let lp = ctx
        .db
        .lobby_player()
        .iter()
        .find(|lp| lp.player_identity == identity)
        .ok_or("Not in a lobby")?
        .clone();

    let lobby = ctx
        .db
        .lobby()
        .id()
        .find(lp.lobby_id)
        .ok_or("Lobby not found")?;

    let existing: Vec<(Vec3, i32)> = ctx
        .db
        .player()
        .iter()
        .filter(|p| p.lobby_id == lobby.id && p.is_alive)
        .map(|p| (Vec3::new(p.position_x, p.position_y, p.position_z), p.team))
        .collect();

    let seed = ctx.timestamp.to_micros_since_unix_epoch() as u64;
    let spawn_pos = if lobby.game_mode == GameMode::CaptureTheFlag && existing.is_empty() {
        get_flag_spawn_position(ctx, lobby.id, lp.team).unwrap_or_else(|| {
            get_best_spawn_position(ctx, lobby.id, lp.team, true, &existing, seed)
        })
    } else {
        let is_team_mode = lobby.game_mode != GameMode::FreeForAll;
        get_best_spawn_position(
            ctx,
            lobby.id,
            lp.team,
            is_team_mode,
            &existing,
            seed,
        )
    };

    create_player_at(
        ctx,
        identity,
        lp.name,
        &lobby,
        lp.team,
        spawn_pos,
        weapon,
        secondary,
    )?;
    Ok(())
}

pub fn remove_player(ctx: &ReducerContext, identity: Identity) {
    if let Some(player) = ctx.db.player().identity().find(identity) {
        // Clean up physics objects
        if player.rigid_body_id > 0 {
            if let Some(rb) = RigidBody::find(ctx, player.rigid_body_id) {
                rb.delete(ctx);
            }
        }
        ctx.db.player().identity().delete(identity);
    }
}

// ============================================================================
// INPUT REDUCERS
// ============================================================================

/// Discrete shooting state: call on mouse down (true) and mouse up (false).
/// Instant response - no polling delay.
#[reducer]
pub fn set_shooting(
    ctx: &ReducerContext,
    is_shooting: bool,
    aim_x: f32,
    aim_z: f32,
) -> Result<(), String> {
    let identity = ctx.sender;

    if is_shooting {
        log::info!("start shooting identity={:?} aim=({}, {})", identity, aim_x, aim_z);
    } else {
        log::info!("stop shooting identity={:?}", identity);
    }

    if let Some(mut player) = ctx.db.player().identity().find(identity) {
        player.is_shooting = is_shooting;
        player.aim_x = aim_x;
        player.aim_z = aim_z;

        crate::weapons::on_input_for_weapon(ctx, player.weapon, identity, is_shooting);

        ctx.db.player().identity().update(player);
    }
    Ok(())
}

#[reducer]
pub fn update_input(
    ctx: &ReducerContext,
    input_x: f32,
    input_z: f32,
    aim_x: f32,
    aim_z: f32,
) -> Result<(), String> {
    let identity = ctx.sender;

    if let Some(mut player) = ctx.db.player().identity().find(identity) {
        player.input_x = input_x.clamp(-1.0, 1.0);
        player.input_z = input_z.clamp(-1.0, 1.0);
        // Normalize so diagonal movement isn't faster than cardinal
        let len_sq = player.input_x * player.input_x + player.input_z * player.input_z;
        if len_sq > 1.0 {
            let len = len_sq.sqrt();
            player.input_x /= len;
            player.input_z /= len;
        }
        player.aim_x = aim_x;
        player.aim_z = aim_z;

        // Update velocity from input; Rapier will move the body and resolve wall collision
        if player.is_alive {
            player.velocity_x += player.input_x * PLAYER_ACCEL * PLAYER_INPUT_TICK_DT;
            player.velocity_z += player.input_z * PLAYER_ACCEL * PLAYER_INPUT_TICK_DT;
            player.velocity_x *= PLAYER_DAMPING;
            player.velocity_z *= PLAYER_DAMPING;
            // velocity_y is left to physics (gravity, bullet impulse)

            // Write velocity to RigidBody so next physics step moves the player (Rapier handles wall collision)
            if let Some(mut rb) = RigidBody::find(ctx, player.rigid_body_id) {
                rb.linear_velocity_x = player.velocity_x;
                rb.linear_velocity_y = player.velocity_y;
                rb.linear_velocity_z = player.velocity_z;
                rb.update(ctx);
                // Keep Player in sync with RigidBody position/velocity (authoritative state from physics)
                player.position_x = rb.position_x;
                player.position_y = rb.position_y;
                player.position_z = rb.position_z;
                player.velocity_x = rb.linear_velocity_x;
                player.velocity_y = rb.linear_velocity_y;
                player.velocity_z = rb.linear_velocity_z;
            }
        }

        ctx.db.player().identity().update(player);
        Ok(())
    } else {
        Err("Player not found".to_string())
    }
}

#[reducer]
pub fn set_loadout(
    ctx: &ReducerContext,
    weapon: WeaponType,
    secondary: SecondaryType,
) -> Result<(), String> {
    let identity = ctx.sender;

    if let Some(mut player) = ctx.db.player().identity().find(identity) {
        player.weapon = weapon;
        player.secondary = secondary;
        ctx.db.player().identity().update(player);
        Ok(())
    } else {
        Err("Player not found".to_string())
    }
}

#[reducer]
pub fn set_player_color(
    ctx: &ReducerContext,
    r: f32,
    g: f32,
    b: f32,
) -> Result<(), String> {
    let identity = ctx.sender;

    if let Some(mut player) = ctx.db.player().identity().find(identity) {
        player.color_r = r.clamp(0.0, 1.0);
        player.color_g = g.clamp(0.0, 1.0);
        player.color_b = b.clamp(0.0, 1.0);
        ctx.db.player().identity().update(player);
        Ok(())
    } else {
        Err("Player not found".to_string())
    }
}

#[reducer]
pub fn set_marble_config(
    ctx: &ReducerContext,
    design_id: u8,
    main_r: f32,
    main_g: f32,
    main_b: f32,
    sec_r: f32,
    sec_g: f32,
    sec_b: f32,
) -> Result<(), String> {
    let identity = ctx.sender;

    if let Some(mut player) = ctx.db.player().identity().find(identity) {
        player.design_id = design_id.min(4);
        player.color_r = main_r.clamp(0.0, 1.0);
        player.color_g = main_g.clamp(0.0, 1.0);
        player.color_b = main_b.clamp(0.0, 1.0);
        player.secondary_color_r = sec_r.clamp(0.0, 1.0);
        player.secondary_color_g = sec_g.clamp(0.0, 1.0);
        player.secondary_color_b = sec_b.clamp(0.0, 1.0);
        ctx.db.player().identity().update(player);
        Ok(())
    } else {
        Err("Player not found".to_string())
    }
}

// ============================================================================
// WEAPON HELPERS
// ============================================================================

pub fn get_weapon_damage(weapon: WeaponType) -> i32 {
    match weapon {
        WeaponType::Smg => 8,
        WeaponType::DualMachineGun => 6,
        WeaponType::ChainGun => 5,
        WeaponType::PhotonRifle => 50,
        WeaponType::Bazooka => 80,
        WeaponType::Flamethrower => 3,
    }
}

pub fn get_weapon_fire_rate_ms(weapon: WeaponType) -> i64 {
    match weapon {
        WeaponType::Smg => 67,          // ~15 shots/sec
        WeaponType::DualMachineGun => 50, // ~20 shots/sec
        WeaponType::ChainGun => 33,     // ~30 shots/sec
        WeaponType::PhotonRifle => 2000, // 0.5 shots/sec (recharge cooldown)
        WeaponType::Bazooka => 1000,    // 1 shot/sec
        WeaponType::Flamethrower => 17, // ~60 ticks/sec
    }
}

pub fn get_weapon_knockback(weapon: WeaponType) -> f32 {
    match weapon {
        WeaponType::Smg => 0.5,
        WeaponType::DualMachineGun => 0.4,
        WeaponType::ChainGun => 0.8,
        WeaponType::PhotonRifle => 2.0,
        WeaponType::Bazooka => 3.0,
        WeaponType::Flamethrower => 0.2,
    }
}

// ============================================================================
// CONNECTION HANDLERS
// ============================================================================

#[reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    log::info!("Client connected: {:?}", ctx.sender);
}

#[reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    log::info!("Client disconnected: {:?}", ctx.sender);
    
    // Leave any lobby they're in
    if let Some(player) = ctx.db.player().identity().find(ctx.sender) {
        let lobby_id = player.lobby_id;
        remove_player(ctx, ctx.sender);
        
        // Remove from lobby_player table
        if let Some(lp) = ctx.db.lobby_player().iter().find(|lp| lp.player_identity == ctx.sender) {
            ctx.db.lobby_player().id().delete(lp.id);
        }
        
        // Check if lobby is empty
        let remaining = ctx.db.lobby_player().iter().filter(|lp| lp.lobby_id == lobby_id).count();
        if remaining == 0 {
            if let Some(lobby) = ctx.db.lobby().id().find(lobby_id) {
                if let Some(world) = spacetime_rapier::PhysicsWorld::find(ctx, lobby.physics_world_id) {
                    world.delete(ctx);
                }
                // Clean up password secret if it exists
                ctx.db.lobby_secret().lobby_id().delete(lobby_id);
                ctx.db.lobby().id().delete(lobby_id);
                log::info!("Deleted empty lobby {}", lobby_id);
            }
        }
    }
}

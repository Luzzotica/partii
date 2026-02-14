// Player tables and reducers

use spacetimedb::{reducer, table, Identity, ReducerContext, SpacetimeType, Table, Timestamp};
use spacetime_rapier::{Collider, RigidBody, RigidBodyProperties, RigidBodyType, Vec3};

use crate::lobby::{lobby, lobby_player, lobby_secret, Lobby};
use crate::maps::get_spawn_position;

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
    pub lobby_id: u64,
    pub rigid_body_id: u64,
    // Position stored as separate components for SpacetimeDB
    pub position_x: f32,
    pub position_y: f32,
    pub position_z: f32,
    pub health: i32,
    pub max_health: i32,
    pub is_alive: bool,
    pub team: i32,
    pub kills: i32,
    pub deaths: i32,
    pub weapon: WeaponType,
    pub secondary: SecondaryType,
    pub ammo: i32,
    pub max_ammo: i32,
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
    pub velocity_z: f32,
    pub input_x: f32,
    pub input_z: f32,
    pub aim_x: f32,
    pub aim_z: f32,
    pub is_shooting: bool,
    pub respawn_at: i64,
    pub last_shot_at: i64,
    pub joined_at: Timestamp,
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

pub fn create_player_in_lobby(
    ctx: &ReducerContext,
    identity: Identity,
    name: String,
    lobby: &Lobby,
    team: i32,
) -> Result<Player, String> {
    let spawn_pos = get_spawn_position(lobby.map_id, team as usize);

    // Create rigid body properties for player (dynamic, with damping so it slows when input stops)
    let rb_properties = RigidBodyProperties::builder()
        .world_id(lobby.physics_world_id)
        .mass(1.0)
        .restitution(0.3) // slight bounce off walls
        .linear_damping(3.5) // marble slows when input released
        .ccd_enabled(true) // prevent tunneling through walls at speed
        .build()
        .insert(ctx);

    // Create sphere collider for player ball
    let collider = Collider::ball(lobby.physics_world_id, 0.5).insert(ctx);

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
        health: 100,
        max_health: 100,
        is_alive: true,
        team,
        kills: 0,
        deaths: 0,
        weapon: WeaponType::Smg,
        secondary: SecondaryType::PopupKnives,
        ammo: 30,
        max_ammo: 30,
        grenades: 2,
        molotovs: 1,
        color_r: 0.0,
        color_g: 1.0,
        color_b: 1.0,
        design_id: 0,
        secondary_color_r: 1.0,
        secondary_color_g: 0.0,
        secondary_color_b: 0.5,
        velocity_x: 0.0,
        velocity_z: 0.0,
        input_x: 0.0,
        input_z: 0.0,
        aim_x: 0.0,
        aim_z: -1.0,
        is_shooting: false,
        respawn_at: 0,
        last_shot_at: 0,
        joined_at: ctx.timestamp,
    };

    ctx.db.player().insert(player.clone());
    Ok(player)
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

#[reducer]
pub fn update_input(
    ctx: &ReducerContext,
    input_x: f32,
    input_z: f32,
    aim_x: f32,
    aim_z: f32,
    is_shooting: bool,
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
        player.is_shooting = is_shooting;

        // Update velocity from input; Rapier will move the body and resolve wall collision
        if player.is_alive {
            const ACCEL: f32 = 24.0; // acceleration per second
            const DAMPING: f32 = 0.84; // per input tick (velocity *= DAMPING when no input)
            const TICK_DT: f32 = 0.05; // ~50ms between input updates

            player.velocity_x += player.input_x * ACCEL * TICK_DT;
            player.velocity_z += player.input_z * ACCEL * TICK_DT;
            player.velocity_x *= DAMPING;
            player.velocity_z *= DAMPING;

            // Write velocity to RigidBody so next physics step moves the player (Rapier handles wall collision)
            if let Some(mut rb) = RigidBody::find(ctx, player.rigid_body_id) {
                rb.linear_velocity_x = player.velocity_x;
                rb.linear_velocity_y = 0.0;
                rb.linear_velocity_z = player.velocity_z;
                rb.update(ctx);
                // Keep Player in sync with RigidBody position/velocity (authoritative state from physics)
                player.position_x = rb.position_x;
                player.position_y = rb.position_y;
                player.position_z = rb.position_z;
                player.velocity_x = rb.linear_velocity_x;
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
        player.ammo = get_weapon_max_ammo(weapon);
        player.max_ammo = get_weapon_max_ammo(weapon);
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

pub fn get_weapon_max_ammo(weapon: WeaponType) -> i32 {
    match weapon {
        WeaponType::Smg => 30,
        WeaponType::DualMachineGun => 40,
        WeaponType::ChainGun => 100,
        WeaponType::PhotonRifle => 5,
        WeaponType::Bazooka => 4,
        WeaponType::Flamethrower => 100,
    }
}

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
        WeaponType::PhotonRifle => 2000, // 0.5 shots/sec
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

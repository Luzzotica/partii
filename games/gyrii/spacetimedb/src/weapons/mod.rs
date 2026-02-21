// Modular weapon system: trait, handlers, component tables, reducers.

mod common;
mod handler;
mod photon_rifle;
mod hitscan;
mod bazooka;
mod machine_gun;

use spacetimedb::{reducer, Identity, ReducerContext, Table};
use spacetime_rapier::{Collider, RigidBody, RigidBodyProperties, RigidBodyType, Trigger, Vec3};

use crate::collision_groups::{GROUP_BULLET, GROUP_FLOOR, GROUP_GRENADE, GROUP_PLAYER, GROUP_WALL};
use crate::constants::{
    GRENADE_COOLDOWN_MICROS, GRENADE_FUSE_SEC, GRENADE_RESTITUTION, GRENADE_THROW_SPEED,
    GRENADE_THROWER_IMPULSE, HEALTH_SCALE,
};
use crate::game::apply_damage;
use crate::lobby::lobby;
use crate::player::{player, Player, WeaponType};

pub use common::{
    DamageZone, Grenade, PendingPhotonBeam, PhotonBeam, Projectile,
    damage_zone, grenade, pending_photon_beam, photon_beam, projectile,
};
pub use handler::WeaponHandler;

use photon_rifle::PhotonRifleHandler;
use hitscan::HitscanHandler;
use bazooka::BazookaHandler;
use machine_gun::MachineGunHandler;

// ============================================================================
// WEAPON REGISTRY
// ============================================================================

pub fn weapon_handler(weapon: WeaponType) -> &'static dyn WeaponHandler {
    match weapon {
        WeaponType::DualMachineGun | WeaponType::Smg | WeaponType::ChainGun => {
            &MachineGunHandler
        }
        WeaponType::PhotonRifle => &PhotonRifleHandler,
        WeaponType::Bazooka => &BazookaHandler,
        _ => &HitscanHandler,
    }
}

/// Called from update_input so the current weapon can update its component state.
pub fn on_input_for_weapon(
    ctx: &ReducerContext,
    weapon: WeaponType,
    identity: Identity,
    is_shooting: bool,
) {
    weapon_handler(weapon).on_input(ctx, identity, is_shooting);
}

/// Called from physics_tick (and optionally shoot reducer). Returns true if a shot was fired.
pub fn try_fire_player(ctx: &ReducerContext, player: &Player) -> Result<bool, String> {
    if !player.is_shooting || !player.is_alive {
        return Ok(false);
    }
    let lobby = match ctx.db.lobby().id().find(player.lobby_id) {
        Some(l) => l,
        None => return Ok(false),
    };
    let handler = weapon_handler(player.weapon);
    if !handler.can_fire(ctx, player) {
        return Ok(false);
    }
    handler.fire(ctx, player, lobby.physics_world_id)?;
    Ok(true)
}

// ============================================================================
// SHOOT REDUCER (API compatibility)
// ============================================================================

#[reducer]
pub fn shoot(ctx: &ReducerContext) -> Result<(), String> {
    let identity = ctx.sender;
    let player = ctx.db.player().identity().find(identity).ok_or("Player not found")?;
    try_fire_player(ctx, &player).map(|_| ())
}

// ============================================================================
// DETONATE ROCKET
// ============================================================================

#[reducer]
pub fn detonate_rocket(ctx: &ReducerContext) -> Result<(), String> {
    let identity = ctx.sender;
    let rocket = ctx.db.projectile().iter()
        .find(|p| p.owner_id == identity && p.can_detonate)
        .ok_or("No detonatable rocket found")?
        .clone();
    let rb = spacetime_rapier::RigidBody::find(ctx, rocket.rigid_body_id)
        .ok_or("Rocket rigid body not found")?;
    crate::game::insert_pending_explosion(
        ctx,
        rocket.world_id,
        rb.position(),
        rocket.damage,
        rocket.radius,
        identity,
    );
    ctx.db.projectile().rigid_body_id().delete(rocket.rigid_body_id);
    rb.delete(ctx);
    Ok(())
}

// ============================================================================
// THROWABLE REDUCERS
// ============================================================================

#[reducer]
pub fn throw_grenade(ctx: &ReducerContext, aim_x: f32, aim_z: f32) -> Result<(), String> {
    let identity = ctx.sender;
    let player = ctx.db.player().identity().find(identity).ok_or("Player not found")?;
    if !player.is_alive {
        return Err("Player is dead".to_string());
    }
    if player.grenades <= 0 {
        return Err("No grenades".to_string());
    }
    let now_micros = ctx.timestamp.to_micros_since_unix_epoch();
    if now_micros - player.last_grenade_thrown_at < GRENADE_COOLDOWN_MICROS {
        return Err("Grenade on cooldown".to_string());
    }
    let lobby = ctx.db.lobby().id().find(player.lobby_id).ok_or("Lobby not found")?;

    // Guard against near-zero throw vectors so grenades never "snap" unpredictably.
    let mut aim_dir = Vec3::new(aim_x, 0.0, aim_z);
    if aim_dir.length_squared() < 1e-4 {
        aim_dir = Vec3::new(player.aim_x, 0.0, player.aim_z);
    }
    if aim_dir.length_squared() < 1e-4 {
        aim_dir = Vec3::new(0.0, 0.0, -1.0);
    }
    let aim_dir = aim_dir.normalize();
    // 45-degree lob: horizontal and vertical speeds equal
    let s = GRENADE_THROW_SPEED;
    let velocity = Vec3::new(aim_dir.x * s, s, aim_dir.z * s);
    // Spawn from behind the player
    let start_pos = Vec3::new(
        player.position_x - aim_dir.x * 0.5,
        player.position_y + 0.5,
        player.position_z - aim_dir.z * 0.5,
    );

    let rb_props = RigidBodyProperties::builder()
        .world_id(lobby.physics_world_id)
        .mass(0.3)
        .restitution(GRENADE_RESTITUTION)
        .ccd_enabled(true) // prevent tunneling through walls/floor
        .build()
        .insert(ctx);
    let mut collider = Collider::ball(lobby.physics_world_id, 0.15);
    collider.collision_memberships = GROUP_GRENADE;
    collider.collision_filter = GROUP_WALL | GROUP_FLOOR | GROUP_PLAYER | GROUP_BULLET;
    let collider = collider.insert(ctx);
    let grenade_rb = RigidBody::builder()
        .world_id(lobby.physics_world_id)
        .position_x(start_pos.x)
        .position_y(start_pos.y)
        .position_z(start_pos.z)
        .linear_velocity_x(velocity.x)
        .linear_velocity_y(velocity.y)
        .linear_velocity_z(velocity.z)
        .collider_id(collider.id)
        .properties_id(rb_props.id)
        .body_type(RigidBodyType::Dynamic)
        .gravity_scale(1.0)
        .build()
        .insert(ctx);

    ctx.db.grenade().insert(Grenade {
        rigid_body_id: grenade_rb.id,
        world_id: lobby.physics_world_id,
        owner_id: identity,
        expires_at_micros: now_micros as u64 + GRENADE_FUSE_SEC * 1_000_000,
        damage: 110.0,
        radius: 5.0,
        position_x: start_pos.x,
        position_y: start_pos.y,
        position_z: start_pos.z,
        velocity_x: velocity.x,
        velocity_y: velocity.y,
        velocity_z: velocity.z,
    });

    // Apply small impulse to thrower in throw direction
    if player.rigid_body_id != 0 {
        if let Some(mut rb) = RigidBody::find(ctx, player.rigid_body_id) {
            let imp = GRENADE_THROWER_IMPULSE;
            rb.linear_velocity_x += aim_dir.x * imp;
            rb.linear_velocity_y += aim_dir.y * imp;
            rb.linear_velocity_z += aim_dir.z * imp;
            rb.update(ctx);
        }
    }

    let mut updated_player = player.clone();
    updated_player.grenades -= 1;
    updated_player.last_grenade_thrown_at = now_micros;
    ctx.db.player().identity().update(updated_player);
    log::info!(
        "[grenade] THROW rb={} world={} pos=({:.2},{:.2},{:.2}) vel=({:.2},{:.2},{:.2})",
        grenade_rb.id,
        lobby.physics_world_id,
        start_pos.x, start_pos.y, start_pos.z,
        velocity.x, velocity.y, velocity.z,
    );
    Ok(())
}

#[reducer]
pub fn throw_molotov(ctx: &ReducerContext, aim_x: f32, aim_z: f32) -> Result<(), String> {
    let identity = ctx.sender;
    let player = ctx.db.player().identity().find(identity).ok_or("Player not found")?;
    if !player.is_alive {
        return Err("Player is dead".to_string());
    }
    if player.molotovs <= 0 {
        return Err("No molotovs".to_string());
    }
    let lobby = ctx.db.lobby().id().find(player.lobby_id).ok_or("Lobby not found")?;

    let mut aim_dir = Vec3::new(aim_x, 0.0, aim_z);
    if aim_dir.length_squared() < 1e-4 {
        aim_dir = Vec3::new(player.aim_x, 0.0, player.aim_z);
    }
    if aim_dir.length_squared() < 1e-4 {
        aim_dir = Vec3::new(0.0, 0.0, -1.0);
    }
    let aim_dir = aim_dir.normalize();
    let target_pos = Vec3::new(
        player.position_x + aim_dir.x * 10.0,
        0.1,
        player.position_z + aim_dir.z * 10.0,
    );

    let collider = Collider::cuboid(
        lobby.physics_world_id,
        Vec3::new(4.0, 1.0, 4.0),
    ).insert(ctx);
    let trigger = Trigger::builder()
        .world_id(lobby.physics_world_id)
        .position_x(target_pos.x)
        .position_y(target_pos.y)
        .position_z(target_pos.z)
        .collider_id(collider.id)
        .build()
        .insert(ctx);

    ctx.db.damage_zone().insert(DamageZone {
        trigger_id: trigger.id,
        owner_id: identity,
        damage_per_tick: 2,
        remaining_ticks: 300,
    });

    let mut updated_player = player.clone();
    updated_player.molotovs -= 1;
    ctx.db.player().identity().update(updated_player);
    log::info!("Molotov thrown by {:?}", identity);
    Ok(())
}

// ============================================================================
// SECONDARY ABILITY REDUCERS
// ============================================================================

#[reducer]
pub fn use_secondary(ctx: &ReducerContext) -> Result<(), String> {
    let identity = ctx.sender;
    let player = ctx.db.player().identity().find(identity).ok_or("Player not found")?;
    if !player.is_alive {
        return Err("Player is dead".to_string());
    }
    match player.secondary {
        crate::player::SecondaryType::PopupKnives => use_popup_knives(ctx, &player)?,
        crate::player::SecondaryType::BubbleShield => {}
        crate::player::SecondaryType::SelfDestructNuke => use_self_destruct(ctx, &player)?,
    }
    Ok(())
}

fn use_popup_knives(ctx: &ReducerContext, player: &Player) -> Result<(), String> {
    let knife_range = 2.0;
    let knife_damage_tenths = 50 * HEALTH_SCALE;
    for other in ctx.db.player().iter() {
        if other.identity == player.identity || !other.is_alive {
            continue;
        }
        let dx = other.position_x - player.position_x;
        let dz = other.position_z - player.position_z;
        let distance = (dx * dx + dz * dz).sqrt();
        if distance <= knife_range {
            apply_damage(ctx, other.identity, knife_damage_tenths, player.identity);
        }
    }
    Ok(())
}

fn use_self_destruct(ctx: &ReducerContext, player: &Player) -> Result<(), String> {
    let nuke_damage = 200.0;
    let nuke_radius = 10.0;
    let world_id = ctx
        .db
        .lobby()
        .id()
        .find(player.lobby_id)
        .map(|l| l.physics_world_id)
        .unwrap_or(1);
    crate::game::insert_pending_explosion(
        ctx,
        world_id,
        player.position(),
        nuke_damage,
        nuke_radius,
        player.identity,
    );
    apply_damage(ctx, player.identity, crate::constants::MAX_HEALTH, player.identity);
    Ok(())
}

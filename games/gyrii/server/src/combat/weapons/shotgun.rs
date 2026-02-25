//! Shotgun: multiple pellets per shot

use rapier3d::prelude::*;

use crate::collision_groups::{GROUP_BULLET, GROUP_FLOOR, GROUP_GRENADE, GROUP_PLAYER, GROUP_WALL};
use crate::protocol::ShotEventPayload;
use crate::state::{ProjectileData, ServerState, WeaponType};
use crate::weapon_config;

fn muzzle_world_position(
    px: f32, py: f32, pz: f32, aim_x: f32, aim_z: f32, weapon: WeaponType,
) -> (f32, f32, f32) {
    let (mut ax, mut az) = (aim_x, aim_z);
    let len_sq = ax * ax + az * az;
    if len_sq < 0.001 {
        ax = 0.0;
        az = -1.0;
    } else {
        let len = len_sq.sqrt();
        ax /= len;
        az /= len;
    }
    let (lx, ly, lz) = weapon_config::weapon_config(weapon).muzzle_offset;
    let mx = px - az * lx - ax * lz;
    let my = py + ly;
    let mz = pz + ax * lx - az * lz;
    (mx, my, mz)
}

fn now_micros() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_micros() as u64
}

pub fn try_fire(
    state: &mut ServerState,
    lobby_id: u64,
    identity: &str,
) -> Vec<ShotEventPayload> {
    let player = match state.players.get(identity) {
        Some(p) => p.clone(),
        None => return Vec::new(),
    };
    let proj = weapon_config::weapon_config(WeaponType::Shotgun)
        .projectile
        .expect("Shotgun has projectile config");
    let pellet_count = proj.pellets.unwrap_or(1) as usize;
    let fire_rate = weapon_config::weapon_fire_rate_micros(WeaponType::Shotgun);
    let now = now_micros() as i64;
    if now - player.last_shot_at < fire_rate {
        return Vec::new();
    }

    let physics = match state.physics_worlds.get_mut(&lobby_id) {
        Some(p) => p,
        None => return Vec::new(),
    };
    let (px, py, pz) = match physics.get_position(player.rigid_body_id) {
        Some(p) => p,
        None => return Vec::new(),
    };

    let mut aim_x = player.aim_x;
    let mut aim_z = player.aim_z;
    let len_sq = aim_x * aim_x + aim_z * aim_z;
    if len_sq < 0.001 {
        aim_x = 0.0;
        aim_z = -1.0;
    } else {
        let len = len_sq.sqrt();
        aim_x /= len;
        aim_z /= len;
    }

    let (mx, my, mz) = muzzle_world_position(px, py, pz, aim_x, aim_z, WeaponType::Shotgun);
    let damage_per_pellet = weapon_config::weapon_damage(WeaponType::Shotgun) as f32;
    let expires = now_micros() + proj.ttl_micros;

    let mut events = Vec::with_capacity(pellet_count);
    let perp_x = -aim_z;
    let perp_z = aim_x;

    for i in 0..pellet_count {
        let seed = (i as u64).wrapping_mul(2654435761).wrapping_add(now as u64);
        let rand1 = ((seed % 10000) as f32 / 10000.0) * 2.0 - 1.0;
        let rand2 = (((seed >> 16) % 10000) as f32 / 10000.0) * 2.0 - 1.0;
        let ax = (aim_x + perp_x * rand1 * proj.spray_radians
            + aim_x * rand2 * proj.spray_radians * 0.5)
            .clamp(-1.0, 1.0);
        let az = (aim_z + perp_z * rand1 * proj.spray_radians
            + aim_z * rand2 * proj.spray_radians * 0.5)
            .clamp(-1.0, 1.0);
        let len2 = (ax * ax + az * az).sqrt();
        let (ax, az) = if len2 > 1e-6 {
            (ax / len2, az / len2)
        } else {
            (aim_x, aim_z)
        };

        let vx = ax * proj.speed;
        let vy = 0.0;
        let vz = az * proj.speed;

        let body_id = physics.next_body_id();
        let rb = RigidBodyBuilder::dynamic()
            .translation(vector![mx, my, mz])
            .linvel(vector![vx, vy, vz])
            .linear_damping(0.0)
            .gravity_scale(0.0)
            .ccd_enabled(true);
        let collider = ColliderBuilder::ball(0.16)
            .sensor(true)
            .active_events(ActiveEvents::COLLISION_EVENTS)
            .collision_groups(InteractionGroups::new(
                Group::from_bits_truncate(GROUP_BULLET),
                Group::from_bits_truncate(GROUP_PLAYER | GROUP_WALL | GROUP_FLOOR | GROUP_GRENADE),
            ));

        physics.insert_body_with_sensor(body_id, rb, collider);

        state.projectiles.insert(
            body_id,
            ProjectileData {
                owner_id: identity.to_string(),
                lobby_id,
                weapon_type: WeaponType::Shotgun,
                damage: damage_per_pellet,
                velocity_x: vx,
                velocity_y: vy,
                velocity_z: vz,
                expires_at_micros: expires,
                origin_x: mx,
                origin_y: my,
                origin_z: mz,
            },
        );

        events.push(ShotEventPayload {
            player_id: identity.to_string(),
            weapon: "shotgun".to_string(),
            projectile_type: proj.projectile_type,
            position: [mx, my, mz],
            velocity: [vx, vy, vz],
        });
    }

    if let Some(p) = state.players.get_mut(identity) {
        p.last_shot_at = now;
    }

    let rigid_body_id = player.rigid_body_id;
    if rigid_body_id > 0 {
        physics.apply_impulse(
            rigid_body_id,
            -aim_x * proj.recoil_impulse,
            0.0,
            -aim_z * proj.recoil_impulse,
        );
    }

    events
}

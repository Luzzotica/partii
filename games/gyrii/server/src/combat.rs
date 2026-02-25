//! Combat logic: shooting, projectiles, grenades, damage

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use rapier3d::prelude::*;

use crate::collision_groups::{GROUP_BULLET, GROUP_FLOOR, GROUP_GRENADE, GROUP_PLAYER, GROUP_WALL};
use crate::constants::{BEAM_DURATION_TICKS, HEALTH_SCALE, PHOTON_RAY_MAX_DISTANCE, PLAYER_MASS};
use crate::protocol::{KillEventPayload, ShotEventPayload};
use crate::state::{GameMode, PhotonBeamData, ProjectileData, ServerState, WeaponType};
use crate::stats;
use crate::weapon_config;

/// World-space muzzle position from player position, aim direction, and per-weapon offset.
fn muzzle_world_position(px: f32, py: f32, pz: f32, aim_x: f32, aim_z: f32, weapon: WeaponType) -> (f32, f32, f32) {
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
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_micros() as u64
}

/// S-curve damage falloff by distance. t=0 -> 1.0, t=1 -> 0.0. range=0 means no falloff.
fn bullet_falloff_multiplier(distance: f32, range: f32, k: f32) -> f32 {
    if range <= 0.0 {
        return 1.0;
    }
    let t = (distance / range).min(1.0);
    let x = k * (t - 0.5);
    let sigmoid = 1.0 / (1.0 + (-x).exp());
    1.0 - sigmoid
}

pub fn try_fire_player(
    state: &mut ServerState,
    lobby_id: u64,
    identity: &str,
    tick_seed: u64,
) -> Vec<ShotEventPayload> {
    let player = match state.players.get(identity) {
        Some(p) => p,
        None => return Vec::new(),
    };
    if !player.is_alive || !player.is_shooting || player.rigid_body_id == 0 {
        return Vec::new();
    }

    if player.weapon == WeaponType::PhotonRifle {
        try_fire_photon_rifle(state, lobby_id, identity);
        return Vec::new();
    }

    if player.weapon == WeaponType::Shotgun {
        return try_fire_shotgun(state, lobby_id, identity);
    }

    let cfg = weapon_config::weapon_config(player.weapon);
    let proj = cfg
        .projectile
        .expect("bullet weapons must have projectile config");
    let fire_rate = weapon_config::weapon_fire_rate_micros(player.weapon);
    let now = now_micros() as i64;
    if now - player.last_shot_at < fire_rate {
        return Vec::new();
    }

    let rigid_body_id = player.rigid_body_id;
    let physics = match state.physics_worlds.get_mut(&lobby_id) {
        Some(p) => p,
        None => return Vec::new(),
    };
    let (px, py, pz) = match physics.get_position(rigid_body_id) {
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

    // Spray
    let angle = (tick_seed ^ (now as u64)).wrapping_mul(1103515245).wrapping_add(12345);
    let rand1 = ((angle % 10000) as f32 / 10000.0) * 2.0 - 1.0;
    let rand2 = (((angle >> 16) % 10000) as f32 / 10000.0) * 2.0 - 1.0;
    let perp_x = -aim_z;
    let perp_z = aim_x;
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

    let (mx, my, mz) = muzzle_world_position(px, py, pz, aim_x, aim_z, player.weapon);

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
            weapon_type: player.weapon,
            damage: weapon_config::weapon_damage(player.weapon) as f32,
            velocity_x: vx,
            velocity_y: vy,
            velocity_z: vz,
            expires_at_micros: now_micros() + proj.ttl_micros,
            origin_x: mx,
            origin_y: my,
            origin_z: mz,
        },
    );

    let weapon_str_val = cfg.name.to_string();
    if let Some(p) = state.players.get_mut(identity) {
        p.last_shot_at = now;
    }

    // Recoil: push shooter backward
    if rigid_body_id > 0 {
        physics.apply_impulse(
            rigid_body_id,
            -aim_x * proj.recoil_impulse,
            0.0,
            -aim_z * proj.recoil_impulse,
        );
    }

    vec![ShotEventPayload {
        player_id: identity.to_string(),
        weapon: weapon_str_val,
        projectile_type: proj.projectile_type,
        position: [mx, my, mz],
        velocity: [vx, vy, vz],
    }]
}

fn try_fire_shotgun(
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

fn try_fire_photon_rifle(state: &mut ServerState, lobby_id: u64, identity: &str) {
    let player = match state.players.get(identity) {
        Some(p) => p.clone(),
        None => return,
    };
    let charge_started = match player.photon_rifle_charge_started_at {
        Some(t) => t,
        None => return,
    };
    let now = now_micros() as i64;
    let beam = weapon_config::weapon_config(WeaponType::PhotonRifle)
        .photon
        .expect("PhotonRifle has photon config");
    let charge_micros = beam.charge_micros;
    if now - charge_started < charge_micros {
        return;
    }
    let fire_rate = weapon_config::weapon_fire_rate_micros(WeaponType::PhotonRifle);
    if now - player.last_shot_at < fire_rate {
        return;
    }

    let physics = match state.physics_worlds.get_mut(&lobby_id) {
        Some(p) => p,
        None => return,
    };
    let (mx, my, mz) = muzzle_world_position(
        player.position_x,
        player.position_y,
        player.position_z,
        player.aim_x,
        player.aim_z,
        WeaponType::PhotonRifle,
    );
    let (mut ax, mut az) = (player.aim_x, player.aim_z);
    let len_sq = ax * ax + az * az;
    if len_sq < 0.001 {
        ax = 0.0;
        az = -1.0;
    } else {
        let len = len_sq.sqrt();
        ax /= len;
        az /= len;
    }
    let dx = ax;
    let dy = 0.0;
    let dz = az;

    // Raycast walls_only: beam stops at walls/floor, passes through players
    let hit = physics.cast_ray(
        mx, my, mz, dx, dy, dz, PHOTON_RAY_MAX_DISTANCE,
        Some(player.rigid_body_id),
        true, // walls_only
    );
    let beam_length = hit.map(|(_, d)| d).unwrap_or(PHOTON_RAY_MAX_DISTANCE);
    let end_x = mx + dx * beam_length;
    let end_y = my + dy * beam_length;
    let end_z = mz + dz * beam_length;

    // Damage is applied per-tick in process_photon_beam_damage (damage over time with falloff)

    let beam_id = state.next_photon_beam_id;
    state.next_photon_beam_id += 1;
    state.photon_beams.insert(
        beam_id,
        PhotonBeamData {
            id: beam_id,
            owner_id: identity.to_string(),
            lobby_id,
            origin_x: mx,
            origin_y: my,
            origin_z: mz,
            end_x,
            end_y,
            end_z,
            remaining_ticks: BEAM_DURATION_TICKS,
        },
    );

    if let Some(p) = state.players.get_mut(identity) {
        p.last_shot_at = now;
        p.photon_rifle_charge_started_at = None;
    }

    // Recoil: push shooter backward
    if player.rigid_body_id > 0 {
        let recoil = beam.recoil_impulse;
        physics.apply_impulse(
            player.rigid_body_id,
            -dx * recoil,
            0.0,
            -dz * recoil,
        );
    }
}

/// Apply per-tick photon beam damage to players in beam path. Called from game loop each tick.
/// Damage falls off along the beam (muzzle = full, end = reduced).
pub fn process_photon_beam_damage(state: &mut ServerState) -> Vec<KillEventPayload> {
    let mut kills = Vec::new();
    let beams: Vec<_> = state.photon_beams.values().cloned().collect();
    for beam in beams {
        let lobby_id = beam.lobby_id;
        let owner_id = beam.owner_id.clone();
        let ox = beam.origin_x;
        let oy = beam.origin_y;
        let oz = beam.origin_z;
        let ex = beam.end_x;
        let ey = beam.end_y;
        let ez = beam.end_z;
        let dx = ex - ox;
        let dy = ey - oy;
        let dz = ez - oz;
        let beam_length_sq = dx * dx + dy * dy + dz * dz;
        let beam_length = if beam_length_sq < 1e-10 {
            continue;
        } else {
            beam_length_sq.sqrt()
        };
        let dx = dx / beam_length;
        let dy = dy / beam_length;
        let dz = dz / beam_length;

        let beam = weapon_config::weapon_config(WeaponType::PhotonRifle)
            .photon
            .expect("PhotonRifle has photon config");
        let total_damage = beam.total_damage;
        let base_damage_per_tick =
            total_damage * HEALTH_SCALE as f32 / BEAM_DURATION_TICKS as f32;

        let mut to_hit: Vec<(String, i32)> = Vec::new();
        for (id, p) in state.players.iter() {
            if id == &owner_id || !p.is_alive || p.lobby_id != lobby_id {
                continue;
            }
            let px = p.position_x;
            let py = p.position_y;
            let pz = p.position_z;
            let t = (px - ox) * dx + (py - oy) * dy + (pz - oz) * dz;
            if t < 0.0 || t > beam_length {
                continue;
            }
            let proj_x = ox + dx * t;
            let proj_y = oy + dy * t;
            let proj_z = oz + dz * t;
            let dist_sq = (px - proj_x).powi(2) + (py - proj_y).powi(2) + (pz - proj_z).powi(2);
            let beam_radius = beam.beam_radius;
            if dist_sq > beam_radius * beam_radius {
                continue;
            }
            let frac = t / beam_length;
            let falloff = beam.damage_falloff;
            let mult = 1.0 - falloff * frac;
            let damage_tenths = (base_damage_per_tick * mult).round() as i32;
            if damage_tenths > 0 {
                to_hit.push((id.clone(), damage_tenths));
            }
        }
        for (id, damage_tenths) in to_hit {
            if let Some(ev) = apply_damage(state, &id, damage_tenths, &owner_id) {
                kills.push(ev);
            }
        }
    }
    kills
}

pub fn apply_damage(
    state: &mut ServerState,
    target_id: &str,
    damage: i32,
    source_id: &str,
) -> Option<KillEventPayload> {
    let (lobby_id, team, is_team_mode) = {
        let player = state.players.get(target_id)?;
        if !player.is_alive {
            return None;
        }
        let lobby = state.lobbies.get(&player.lobby_id)?;
        (
            player.lobby_id,
            player.team,
            lobby.game_mode != GameMode::FreeForAll,
        )
    };

    let damage = damage;
    if source_id != target_id && is_team_mode {
        if let Some(source) = state.players.get(source_id) {
            if source.team == team {
                return None; // No friendly fire
            }
        }
    }
    stats::record_damage(state, lobby_id, source_id, target_id, damage);

    let (should_kill, victim_name, rigid_body_id) = {
        let player = state.players.get_mut(target_id)?;
        player.health -= damage;
        if player.health < 0 {
            player.health = 0;
        }
        let should_kill = player.health <= 0;
        if should_kill {
            player.health = 0;
            player.is_alive = false;
            player.deaths += 1;
        }
        (
            should_kill,
            player.name.clone(),
            player.rigid_body_id,
        )
    };

    if !should_kill {
        return None;
    }

    let mut kill_event = None;
    if source_id != target_id {
        if let Some(killer) = state.players.get_mut(source_id) {
            killer.kills += 1;
            kill_event = Some(KillEventPayload {
                killer_id: source_id.to_string(),
                killer_name: killer.name.clone(),
                victim_id: target_id.to_string(),
                victim_name,
                weapon: "bullet".to_string(),
                timestamp: now_micros(),
            });
        }
    }
    stats::record_kill(state, lobby_id, source_id, target_id);

    if rigid_body_id > 0 {
        if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
            physics.set_body_enabled(rigid_body_id, false);
        }
    }

    kill_event
}

pub fn remove_projectile(state: &mut ServerState, body_id: u64, lobby_id: u64) {
    state.projectiles.remove(&body_id);
    if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
        physics.remove_body(body_id);
    }
}

/// Explode a grenade: apply damage in radius, remove body, return kill events.
pub fn explode_grenade(
    state: &mut ServerState,
    body_id: u64,
    lobby_id: u64,
    exp_x: f32,
    exp_y: f32,
    exp_z: f32,
    damage: f32,
    radius: f32,
    owner_id: &str,
) -> Vec<KillEventPayload> {
    let mut kill_events = Vec::new();
    let radius_sq = radius * radius;
    if !state.lobbies.contains_key(&lobby_id) {
        return kill_events;
    }

    let damage_tenths = (damage * HEALTH_SCALE as f32).round() as i32;
    let candidates: Vec<(String, f32, f32, f32, f32)> = state
        .players
        .iter()
        .filter(|(_, p)| p.is_alive && p.lobby_id == lobby_id)
        .filter_map(|(id, p)| {
            let dx = p.position_x - exp_x;
            let dy = p.position_y - exp_y;
            let dz = p.position_z - exp_z;
            let dist_sq = dx * dx + dy * dy + dz * dz;
            if dist_sq > radius_sq {
                return None;
            }
            Some((id.clone(), dist_sq, dx, dy, dz))
        })
        .collect();

    // LOS check: only damage players with a clear path from blast center.
    // We raycast walls/floor only; if anything blocks before target, skip damage.
    let mut to_damage: Vec<(String, f32, f32, f32, f32)> = Vec::new();
    if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
        const LOS_EPS: f32 = 0.05;
        for (id, dist_sq, dx, dy, dz) in candidates {
            if dist_sq < 0.01 {
                to_damage.push((id, dist_sq, dx, dy, dz));
                continue;
            }
            let dist = dist_sq.sqrt();
            let inv = 1.0 / dist;
            let ray_max_dist = (dist - LOS_EPS).max(0.0);
            let blocked = ray_max_dist > 0.0
                && physics
                    .cast_ray(
                        exp_x,
                        exp_y,
                        exp_z,
                        dx * inv,
                        dy * inv,
                        dz * inv,
                        ray_max_dist,
                        None,
                        true, // walls/floor only
                    )
                    .is_some();
            if !blocked {
                to_damage.push((id, dist_sq, dx, dy, dz));
            }
        }
    }

    for (id, dist_sq, dx, dy, dz) in to_damage {
        if let Some(ke) = apply_damage(state, &id, damage_tenths, owner_id) {
            kill_events.push(ke);
        }
        if let Some(player) = state.players.get(&id) {
            let rb_id = player.rigid_body_id;
            if rb_id > 0 {
                if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
                    let norm = (dist_sq + 0.01).sqrt();
                    let knockback = crate::constants::GRENADE_KNOCKBACK_BASE / norm;
                    physics.apply_impulse(
                        rb_id,
                        dx * knockback,
                        dy * knockback,
                        dz * knockback,
                    );
                }
            }
        }
    }

    state.grenades.remove(&body_id);
    state.grenade_inserts_sent.remove(&body_id);
    state.grenade_deletes_this_tick.push((body_id, lobby_id));
    if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
        physics.remove_body(body_id);
    }
    kill_events
}

pub fn process_projectile_collisions(
    state: &mut ServerState,
    collisions: &[(u64, u64)],
) -> (Vec<u64>, Vec<KillEventPayload>) {
    let mut to_remove = Vec::new();
    let mut kill_events = Vec::new();

    let rb_to_player: HashMap<u64, String> = state
        .players
        .iter()
        .filter(|(_, p)| p.rigid_body_id > 0 && p.is_alive)
        .map(|(id, p)| (p.rigid_body_id, id.clone()))
        .collect();

    for &(sensor_body_id, other_body_id) in collisions {
        let proj = match state.projectiles.get(&sensor_body_id) {
            Some(p) => p.clone(),
            None => continue,
        };

        // Bullet hit grenade -> explode grenade
        if let Some(grenade) = state.grenades.get(&other_body_id).cloned() {
            let pos_opt = state
                .physics_worlds
                .get(&grenade.lobby_id)
                .and_then(|p| p.get_position(other_body_id));
            if let Some((px, py, pz)) = pos_opt {
                kill_events.extend(explode_grenade(
                    state,
                    other_body_id,
                    grenade.lobby_id,
                    px, py, pz,
                    grenade.damage,
                    grenade.radius,
                    &grenade.owner_id,
                ));
            }
            to_remove.push(sensor_body_id);
            continue;
        }

        if let Some(hit_id) = rb_to_player.get(&other_body_id) {
            if hit_id == &proj.owner_id {
                continue;
            }
            let proj_cfg = weapon_config::weapon_config(proj.weapon_type)
                .projectile
                .expect("projectile must have config");
            let mut damage = proj.damage;
            if proj_cfg.falloff_range > 0.0 {
                let (proj_x, proj_y, proj_z) = state
                    .physics_worlds
                    .get(&proj.lobby_id)
                    .and_then(|p| p.get_position(sensor_body_id))
                    .unwrap_or((proj.origin_x, proj.origin_y, proj.origin_z));
                let dx = proj_x - proj.origin_x;
                let dy = proj_y - proj.origin_y;
                let dz = proj_z - proj.origin_z;
                let dist = (dx * dx + dy * dy + dz * dz).sqrt();
                let mult = bullet_falloff_multiplier(
                    dist,
                    proj_cfg.falloff_range,
                    proj_cfg.falloff_k,
                );
                damage *= mult;
            }
            let damage_tenths = (damage * HEALTH_SCALE as f32).round() as i32;
            if let Some(ke) = apply_damage(state, hit_id, damage_tenths.max(0), &proj.owner_id) {
                kill_events.push(ke);
            }

            if let Some(physics) = state.physics_worlds.get_mut(&proj.lobby_id) {
                if let Some((vx, vy, vz)) = physics.get_linvel(sensor_body_id) {
                    let speed = (vx * vx + vy * vy + vz * vz).sqrt();
                    if speed > 1e-6 {
                        let dv = proj_cfg.mass * speed / PLAYER_MASS;
                        let ix = vx / speed * dv;
                        let iy = vy / speed * dv;
                        let iz = vz / speed * dv;
                        physics.apply_impulse(other_body_id, ix, iy, iz);
                        if let Some(hit) = state.players.get_mut(hit_id) {
                            hit.last_impulse_x = ix;
                            hit.last_impulse_y = iy;
                            hit.last_impulse_z = iz;
                            hit.last_impulse_time = now_micros() as i64;
                        }
                    }
                }
            }
        }

        to_remove.push(sensor_body_id);
    }

    (to_remove, kill_events)
}

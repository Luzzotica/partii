//! Combat logic: shooting, projectiles, grenades, damage

mod weapons;

pub use weapons::try_fire as try_fire_player;

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::collision_groups::{GROUP_BULLET, GROUP_FLOOR, GROUP_GRENADE, GROUP_PLAYER, GROUP_WALL};
use crate::constants::{BEAM_DURATION_TICKS, HEALTH_SCALE, PLAYER_MASS};
use crate::ctf;
use crate::protocol::KillEventPayload;
use crate::state::{GameMode, ServerState, WeaponType};
use crate::stats;
use crate::weapon_config;

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
            if let Some(ev) = apply_damage(state, &id, damage_tenths, &owner_id, "photon") {
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
    weapon: &str,
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

    let (should_kill, victim_name, rigid_body_id, death_pos) = {
        let player = state.players.get_mut(target_id)?;
        player.health -= damage;
        if player.health < 0 {
            player.health = 0;
        }
        let should_kill = player.health <= 0;
        let death_pos = if should_kill && player.rigid_body_id > 0 {
            state
                .physics_worlds
                .get(&lobby_id)
                .and_then(|p| p.get_position(player.rigid_body_id))
        } else {
            None
        };
        let death_pos = death_pos.unwrap_or((
            player.position_x,
            player.position_y,
            player.position_z,
        ));
        if should_kill {
            player.health = 0;
            player.is_alive = false;
            player.deaths += 1;
        }
        (
            should_kill,
            player.name.clone(),
            player.rigid_body_id,
            death_pos,
        )
    };

    if !should_kill {
        return None;
    }

    if state
        .players
        .get(target_id)
        .and_then(|p| p.held_flag_team)
        .is_some()
    {
        ctf::drop_flag_on_carrier_death(
            state,
            target_id,
            death_pos.0,
            death_pos.1,
            death_pos.2,
        );
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
                weapon: weapon.to_string(),
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

/// Apply damage in radius at a point (e.g. Popup Hammers). No knockback, no body removal.
pub fn apply_damage_in_radius(
    state: &mut ServerState,
    lobby_id: u64,
    center_x: f32,
    center_y: f32,
    center_z: f32,
    damage: f32,
    radius: f32,
    owner_id: &str,
    weapon: &str,
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
        .filter(|(id, p)| id.as_str() != owner_id && p.is_alive && p.lobby_id == lobby_id)
        .filter_map(|(id, p)| {
            let dx = p.position_x - center_x;
            let dy = p.position_y - center_y;
            let dz = p.position_z - center_z;
            let dist_sq = dx * dx + dy * dy + dz * dz;
            if dist_sq > radius_sq {
                return None;
            }
            Some((id.clone(), dist_sq, dx, dy, dz))
        })
        .collect();

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
                        center_x,
                        center_y,
                        center_z,
                        dx * inv,
                        dy * inv,
                        dz * inv,
                        ray_max_dist,
                        None,
                        true,
                    )
                    .is_some();
            if !blocked {
                to_damage.push((id, dist_sq, dx, dy, dz));
            }
        }
    }

    for (id, _, _, _, _) in to_damage {
        if let Some(ke) = apply_damage(state, &id, damage_tenths, owner_id, weapon) {
            kill_events.push(ke);
        }
    }
    kill_events
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
        if let Some(ke) = apply_damage(state, &id, damage_tenths, owner_id, "grenade") {
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
            if let Some(ke) = apply_damage(state, hit_id, damage_tenths.max(0), &proj.owner_id, "bullet") {
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

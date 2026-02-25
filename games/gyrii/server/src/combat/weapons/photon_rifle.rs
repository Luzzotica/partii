//! Photon rifle: charge-to-fire beam weapon

use crate::constants::{BEAM_DURATION_TICKS, PHOTON_RAY_MAX_DISTANCE};
use crate::state::{PhotonBeamData, ServerState, WeaponType};
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
) -> Vec<crate::protocol::ShotEventPayload> {
    let player = match state.players.get(identity) {
        Some(p) => p.clone(),
        None => return Vec::new(),
    };
    let charge_started = match player.photon_rifle_charge_started_at {
        Some(t) => t,
        None => return Vec::new(),
    };
    let now = now_micros() as i64;
    let beam = weapon_config::weapon_config(WeaponType::PhotonRifle)
        .photon
        .expect("PhotonRifle has photon config");
    let charge_micros = beam.charge_micros;
    if now - charge_started < charge_micros {
        return Vec::new();
    }
    let fire_rate = weapon_config::weapon_fire_rate_micros(WeaponType::PhotonRifle);
    if now - player.last_shot_at < fire_rate {
        return Vec::new();
    }

    let physics = match state.physics_worlds.get_mut(&lobby_id) {
        Some(p) => p,
        None => return Vec::new(),
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

    let hit = physics.cast_ray(
        mx, my, mz, dx, dy, dz, PHOTON_RAY_MAX_DISTANCE,
        Some(player.rigid_body_id),
        true, // walls_only
    );
    let beam_length = hit.map(|(_, d)| d).unwrap_or(PHOTON_RAY_MAX_DISTANCE);
    let end_x = mx + dx * beam_length;
    let end_y = my + dy * beam_length;
    let end_z = mz + dz * beam_length;

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

    if player.rigid_body_id > 0 {
        let recoil = beam.recoil_impulse;
        physics.apply_impulse(
            player.rigid_body_id,
            -dx * recoil,
            0.0,
            -dz * recoil,
        );
    }

    Vec::new()
}

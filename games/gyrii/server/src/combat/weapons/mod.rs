//! Per-weapon fire handlers. Add a new weapon by creating a handler and registering it here.

mod bullet;
mod photon_rifle;
mod shotgun;

use crate::protocol::ShotEventPayload;
use crate::constants::GRENADE_SHOOT_LOCKOUT_MICROS;
use crate::state::{ServerState, WeaponType};

fn now_micros() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_micros() as i64)
        .unwrap_or(0)
}

/// Try to fire the player's weapon. Returns shot events to broadcast (empty for hitscan/beam).
pub fn try_fire(
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
    if now_micros() < player.secondary_forced_cooldown_until_micros {
        return Vec::new();
    }
    if now_micros() - player.last_grenade_thrown_at < GRENADE_SHOOT_LOCKOUT_MICROS {
        return Vec::new();
    }
    let weapon = player.weapon;

    match weapon {
        WeaponType::PhotonRifle => photon_rifle::try_fire(state, lobby_id, identity),
        WeaponType::Shotgun => shotgun::try_fire(state, lobby_id, identity),
        _ => bullet::try_fire(state, lobby_id, identity, tick_seed),
    }
}

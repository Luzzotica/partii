//! Weapon actions

use rapier3d::prelude::*;

use crate::actions::ActionResult;
use crate::collision_groups::{GROUP_BULLET, GROUP_FLOOR, GROUP_GRENADE, GROUP_PLAYER, GROUP_WALL};
use crate::constants::{
    DASH_ABILITY_COOLDOWN_MICROS, GRENADE_COOLDOWN_MICROS, GRENADE_FUSE_SEC, GRENADE_RESTITUTION,
    GRENADE_THROW_SPEED, GRENADE_THROWER_IMPULSE, POPUP_HAMMERS_ABILITY_COOLDOWN_MICROS,
};
use crate::protocol::Identity;
use crate::state::{GrenadeData, SecondaryType, ServerState, Vec3};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;

fn now_micros() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_micros() as i64)
        .unwrap_or(0)
}

pub async fn shoot(_state: Arc<RwLock<ServerState>>, _identity: &Identity) -> ActionResult {
    Ok(None) // Stub
}

pub async fn detonate_rocket(
    _state: Arc<RwLock<ServerState>>,
    _identity: &Identity,
) -> ActionResult {
    Ok(None) // Stub
}

#[derive(Debug, Deserialize)]
struct ThrowGrenadeParams {
    #[serde(rename = "aimX")]
    aim_x: Option<f32>,
    #[serde(rename = "aimZ")]
    aim_z: Option<f32>,
}

pub async fn throw_grenade(
    state: Arc<RwLock<ServerState>>,
    identity: &Identity,
    params: Value,
) -> ActionResult {
    let p: ThrowGrenadeParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
    let aim_x = p.aim_x.unwrap_or(0.0);
    let aim_z = p.aim_z.unwrap_or(-1.0);

    let mut state = state.write().await;

    let (lobby_id, start_pos, ax, az, rigid_body_id) = {
        let player = state.players.get(identity).ok_or("Player not found")?;
        if !player.is_alive {
            return Err("Player is dead".to_string());
        }
        if player.grenades <= 0 {
            return Err("No grenades".to_string());
        }
        let now = now_micros();
        if now < player.secondary_forced_cooldown_until_micros {
            return Err("In secondary cooldown".to_string());
        }
        if now - player.last_grenade_thrown_at < GRENADE_COOLDOWN_MICROS {
            return Err("Grenade on cooldown".to_string());
        }
        let lobby_id = player.lobby_id;
        let len_sq = aim_x * aim_x + aim_z * aim_z;
        let (ax, az) = if len_sq < 0.001 {
            let player_len_sq = player.aim_x * player.aim_x + player.aim_z * player.aim_z;
            if player_len_sq < 0.001 {
                (0.0, -1.0)
            } else {
                let len = player_len_sq.sqrt();
                (player.aim_x / len, player.aim_z / len)
            }
        } else {
            let len = len_sq.sqrt();
            (aim_x / len, aim_z / len)
        };
        let start_pos = Vec3::new(
            player.position_x - ax * 0.5,
            player.position_y + 0.5,
            player.position_z - az * 0.5,
        );
        (lobby_id, start_pos, ax, az, player.rigid_body_id)
    };

    let physics = state
        .physics_worlds
        .get_mut(&lobby_id)
        .ok_or("Physics world not found")?;
    let now_micros = now_micros();
    let s = GRENADE_THROW_SPEED;
    let vx = ax * s;
    let vy = s;
    let vz = az * s;

    let body_id = physics.next_body_id();
    let rb = RigidBodyBuilder::dynamic()
        .translation(vector![start_pos.x, start_pos.y, start_pos.z])
        .linvel(vector![vx, vy, vz])
        .linear_damping(0.5)
        .ccd_enabled(true);
    let collider = ColliderBuilder::ball(0.15)
        .restitution(GRENADE_RESTITUTION)
        .collision_groups(InteractionGroups::new(
            Group::from_bits_truncate(GROUP_GRENADE),
            Group::from_bits_truncate(GROUP_WALL | GROUP_FLOOR | GROUP_PLAYER | GROUP_BULLET),
        ));
    physics.insert_body(body_id, rb, collider);

    let expires_at_micros = now_micros as u64 + GRENADE_FUSE_SEC * 1_000_000;

    state.grenades.insert(
        body_id,
        GrenadeData {
            rigid_body_id: body_id,
            lobby_id,
            owner_id: identity.clone(),
            expires_at_micros,
            damage: 110.0,
            radius: 5.0,
        },
    );

    {
        let player = state.players.get_mut(identity).unwrap();
        player.grenades -= 1;
        player.last_grenade_thrown_at = now_micros;
        // Throwing a grenade always interrupts current primary fire.
        player.is_shooting = false;
        player.photon_rifle_charge_started_at = None;
    }

    if rigid_body_id > 0 {
        if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
            let imp = GRENADE_THROWER_IMPULSE;
            physics.apply_impulse(rigid_body_id, ax * imp, 0.0, az * imp);
        }
    }

    Ok(None)
}

pub async fn throw_molotov(
    _state: Arc<RwLock<ServerState>>,
    _identity: &Identity,
    _params: Value,
) -> ActionResult {
    Ok(None) // Stub
}

pub async fn use_secondary(
    state: Arc<RwLock<ServerState>>,
    identity: &Identity,
) -> ActionResult {
    let secondary = {
        let state = state.read().await;
        let player = state.players.get(identity).ok_or("Player not found")?;
        if !player.is_alive {
            return Err("Player is dead".to_string());
        }
        let now = now_micros();
        if now < player.secondary_forced_cooldown_until_micros {
            return Err("In secondary cooldown".to_string());
        }
        let cooldown_micros = match player.secondary {
            SecondaryType::PopupHammers => POPUP_HAMMERS_ABILITY_COOLDOWN_MICROS,
            SecondaryType::Dash => DASH_ABILITY_COOLDOWN_MICROS,
            _ => return Err("Secondary not implemented".to_string()),
        };
        if now - player.last_secondary_used_at < cooldown_micros {
            return Err("Secondary on cooldown".to_string());
        }
        player.secondary
    };
    state.write().await.pending_secondary_actions.push((identity.clone(), secondary));
    Ok(None)
}

//! Player actions

use rapier3d::prelude::*;

use crate::actions::{ActionResult, BroadcastPlayerJoined};
use crate::constants::{MAX_HEALTH, PLAYER_ACCEL, PLAYER_DAMPING, PLAYER_INPUT_TICK_DT};
use crate::protocol::Identity;
use crate::state::{
    get_best_spawn_position, GameMode, LobbyPlayer, Player, ServerState, Vec3, WeaponType,
    SecondaryType,
};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

#[derive(Deserialize)]
struct RequestSpawnParams {
    weapon: Option<TaggedParam>,
    secondary: Option<TaggedParam>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum TaggedParam {
    Tag { tag: String },
    Plain(String),
}

impl TaggedParam {
    fn as_str(&self) -> &str {
        match self {
            TaggedParam::Tag { tag } => tag.as_str(),
            TaggedParam::Plain(s) => s.as_str(),
        }
    }
}

#[derive(Deserialize)]
struct UpdateInputParams {
    #[serde(rename = "inputX")]
    input_x: Option<f32>,
    #[serde(rename = "inputZ")]
    input_z: Option<f32>,
    #[serde(rename = "aimX")]
    aim_x: Option<f32>,
    #[serde(rename = "aimZ")]
    aim_z: Option<f32>,
}

#[derive(Deserialize)]
struct SetShootingParams {
    #[serde(rename = "isShooting")]
    is_shooting: bool,
    #[serde(rename = "aimX")]
    aim_x: Option<f32>,
    #[serde(rename = "aimZ")]
    aim_z: Option<f32>,
}

#[derive(Deserialize)]
struct SetLoadoutParams {
    weapon: Option<String>,
    secondary: Option<String>,
}

#[derive(Deserialize)]
struct SetMarbleConfigParams {
    #[serde(rename = "designId")]
    design_id: Option<u8>,
    #[serde(rename = "mainR")]
    main_r: Option<f32>,
    #[serde(rename = "mainG")]
    main_g: Option<f32>,
    #[serde(rename = "mainB")]
    main_b: Option<f32>,
    #[serde(rename = "secR")]
    sec_r: Option<f32>,
    #[serde(rename = "secG")]
    sec_g: Option<f32>,
    #[serde(rename = "secB")]
    sec_b: Option<f32>,
}

fn parse_weapon(s: &str) -> WeaponType {
    match s {
        "DualMachineGun" => WeaponType::DualMachineGun,
        "ChainGun" => WeaponType::ChainGun,
        "PhotonRifle" => WeaponType::PhotonRifle,
        "Bazooka" => WeaponType::Bazooka,
        "Flamethrower" => WeaponType::Flamethrower,
        _ => WeaponType::Smg,
    }
}

fn parse_secondary(s: &str) -> SecondaryType {
    match s {
        "BubbleShield" => SecondaryType::BubbleShield,
        "SelfDestructNuke" => SecondaryType::SelfDestructNuke,
        _ => SecondaryType::PopupKnives,
    }
}

pub async fn request_spawn(
    state: Arc<RwLock<ServerState>>,
    identity: &Identity,
    params: Value,
) -> ActionResult {
    let now_micros = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0);
    let p: RequestSpawnParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
    let weapon = p
        .weapon
        .as_ref()
        .map(|w| parse_weapon(w.as_str()))
        .unwrap_or(WeaponType::Smg);
    let secondary = p
        .secondary
        .as_ref()
        .map(|s| parse_secondary(s.as_str()))
        .unwrap_or(SecondaryType::PopupKnives);

    let mut state = state.write().await;

    if let Some(player) = state.players.get(identity) {
        if player.is_alive {
            return Err("Already spawned".to_string());
        }

        let lobby_id = player.lobby_id;
        let team = player.team;
        let rigid_body_id = player.rigid_body_id;

        let lobby = state.lobbies.get(&lobby_id).ok_or("Lobby not found")?.clone();

        let existing: Vec<(Vec3, i32)> = state
            .players
            .values()
            .filter(|p| p.lobby_id == lobby_id && p.is_alive && p.identity != *identity)
            .map(|p| (p.position(), p.team))
            .collect();

        let is_team_mode = lobby.game_mode != GameMode::FreeForAll;
        let spawn_pos = get_best_spawn_position(
            &state.spawn_points,
            lobby_id,
            team,
            is_team_mode,
            &existing,
        );

        let mut rigid_body_id = rigid_body_id;
        if rigid_body_id > 0 {
            if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
                physics.set_body_enabled(rigid_body_id, true);
                if let Some(handle) = physics.body_id_to_handle.get(&rigid_body_id) {
                    if let Some(rb) = physics.rigid_body_set.get_mut(*handle) {
                        rb.set_translation(vector![spawn_pos.x, spawn_pos.y, spawn_pos.z], true);
                        rb.set_linvel(vector![0.0, 0.0, 0.0], true);
                    }
                }
            }
        } else if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
            let body_id = physics.next_body_id();
            let rb = RigidBodyBuilder::dynamic()
                .translation(vector![spawn_pos.x, spawn_pos.y, spawn_pos.z])
                .linear_damping(3.5)
                .ccd_enabled(true);
            let collider = ColliderBuilder::ball(0.5)
                .collision_groups(InteractionGroups::new(
                    rapier3d::geometry::Group::from_bits_truncate(
                        crate::collision_groups::GROUP_PLAYER,
                    ),
                    rapier3d::geometry::Group::from_bits_truncate(
                        crate::collision_groups::GROUP_BULLET
                            | crate::collision_groups::GROUP_WALL
                            | crate::collision_groups::GROUP_FLOOR
                            | crate::collision_groups::GROUP_GRENADE,
                    ),
                ))
                .restitution(0.3);
            physics.insert_body(body_id, rb, collider);
            rigid_body_id = body_id;
        }

        let player = state.players.get_mut(identity).unwrap();
        player.health = MAX_HEALTH;
        player.max_health = MAX_HEALTH;
        player.is_alive = true;
        player.rigid_body_id = rigid_body_id;
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
        player.server_snapshot_id = now_micros;
        player.input_x = 0.0;
        player.input_z = 0.0;
        player.aim_x = 0.0;
        player.aim_z = -1.0;
        player.is_shooting = false;
        player.last_impulse_x = 0.0;
        player.last_impulse_y = 0.0;
        player.last_impulse_z = 0.0;
        player.last_impulse_time = 0;
        player.grenades = 2;
        player.molotovs = 1;

        return Ok(None);
    }

    let lp = state
        .lobby_players
        .iter()
        .find(|lp| lp.player_identity == *identity)
        .ok_or("Not in a lobby")?
        .clone();

    let lobby = state
        .lobbies
        .get(&lp.lobby_id)
        .ok_or("Lobby not found")?
        .clone();

    let existing: Vec<(Vec3, i32)> = state
        .players
        .values()
        .filter(|p| p.lobby_id == lobby.id && p.is_alive)
        .map(|p| (p.position(), p.team))
        .collect();

    let is_team_mode = lobby.game_mode != GameMode::FreeForAll;
    let spawn_pos = get_best_spawn_position(
        &state.spawn_points,
        lobby.id,
        lp.team,
        is_team_mode,
        &existing,
    );

    let rigid_body_id = if let Some(physics) = state.physics_worlds.get_mut(&lobby.id) {
        let body_id = physics.next_body_id();
        let rb = RigidBodyBuilder::dynamic()
            .translation(vector![spawn_pos.x, spawn_pos.y, spawn_pos.z])
            .linear_damping(3.5)
            .ccd_enabled(true);
        let collider = ColliderBuilder::ball(0.5)
            .collision_groups(InteractionGroups::new(
                rapier3d::geometry::Group::from_bits_truncate(crate::collision_groups::GROUP_PLAYER),
                rapier3d::geometry::Group::from_bits_truncate(
                    crate::collision_groups::GROUP_BULLET
                        | crate::collision_groups::GROUP_WALL
                        | crate::collision_groups::GROUP_FLOOR
                        | crate::collision_groups::GROUP_GRENADE,
                ),
            ))
            .restitution(0.3);
        physics.insert_body(body_id, rb, collider);
        body_id
    } else {
        0
    };

    let player = Player {
        identity: identity.clone(),
        name: lp.name,
        lobby_id: lobby.id,
        rigid_body_id,
        position_x: spawn_pos.x,
        position_y: spawn_pos.y,
        position_z: spawn_pos.z,
        spawn_x: spawn_pos.x,
        spawn_y: spawn_pos.y,
        spawn_z: spawn_pos.z,
        health: MAX_HEALTH,
        max_health: MAX_HEALTH,
        is_alive: true,
        team: lp.team,
        kills: 0,
        deaths: 0,
        flag_captures: 0,
        weapon,
        secondary,
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
        velocity_y: 0.0,
        velocity_z: 0.0,
        server_snapshot_id: now_micros,
        input_x: 0.0,
        input_z: 0.0,
        aim_x: 0.0,
        aim_z: -1.0,
        is_shooting: false,
        last_shot_at: 0,
        last_grenade_thrown_at: 0,
        last_impulse_x: 0.0,
        last_impulse_y: 0.0,
        last_impulse_z: 0.0,
        last_impulse_time: 0,
        photon_rifle_charge_started_at: None,
    };

    let lobby_id = player.lobby_id;
    state.players.insert(identity.clone(), player.clone());
    Ok(Some(BroadcastPlayerJoined {
        lobby_id,
        player,
    }))
}

pub async fn update_input(
    state: Arc<RwLock<ServerState>>,
    identity: &Identity,
    params: Value,
) -> ActionResult {
    let p: UpdateInputParams = serde_json::from_value(params).map_err(|e| e.to_string())?;

    let input_x = p.input_x.unwrap_or(0.0);
    let input_z = p.input_z.unwrap_or(0.0);
    let aim_x = p.aim_x.unwrap_or(0.0);
    let aim_z = p.aim_z.unwrap_or(-1.0);

    let mut state = state.write().await;

    let player = state.players.get_mut(identity).ok_or("Player not found")?;

    let mut ix = input_x.clamp(-1.0, 1.0);
    let mut iz = input_z.clamp(-1.0, 1.0);
    let len_sq = ix * ix + iz * iz;
    if len_sq > 1.0 {
        let len = len_sq.sqrt();
        ix /= len;
        iz /= len;
    }

    player.input_x = ix;
    player.input_z = iz;
    player.aim_x = aim_x;
    player.aim_z = aim_z;

    if player.is_alive {
        player.velocity_x += ix * PLAYER_ACCEL * PLAYER_INPUT_TICK_DT;
        player.velocity_z += iz * PLAYER_ACCEL * PLAYER_INPUT_TICK_DT;
        player.velocity_x *= PLAYER_DAMPING;
        player.velocity_z *= PLAYER_DAMPING;

        let rigid_body_id = player.rigid_body_id;
        let lobby_id = player.lobby_id;
        let (vx, vy, vz) = (player.velocity_x, player.velocity_y, player.velocity_z);

        if rigid_body_id > 0 {
            if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
                physics.set_linvel(rigid_body_id, vx, vy, vz);
            }
        } else {
            player.position_x += player.velocity_x * PLAYER_INPUT_TICK_DT;
            player.position_z += player.velocity_z * PLAYER_INPUT_TICK_DT;
        }
    }

    Ok(None)
}

pub async fn set_shooting(
    state: Arc<RwLock<ServerState>>,
    identity: &Identity,
    params: Value,
) -> ActionResult {
    let p: SetShootingParams = serde_json::from_value(params).map_err(|e| e.to_string())?;

    let mut state = state.write().await;

    if let Some(player) = state.players.get_mut(identity) {
        player.is_shooting = p.is_shooting;
        if let Some(ax) = p.aim_x {
            player.aim_x = ax;
        }
        if let Some(az) = p.aim_z {
            player.aim_z = az;
        }
        if player.weapon == crate::state::WeaponType::PhotonRifle {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_micros() as i64)
                .unwrap_or(0);
            if p.is_shooting {
                if player.photon_rifle_charge_started_at.is_none() {
                    player.photon_rifle_charge_started_at = Some(now);
                }
            } else {
                player.photon_rifle_charge_started_at = None;
            }
        }
    }
    Ok(None)
}

pub async fn set_loadout(
    state: Arc<RwLock<ServerState>>,
    identity: &Identity,
    params: Value,
) -> ActionResult {
    let p: SetLoadoutParams = serde_json::from_value(params).map_err(|e| e.to_string())?;

    let mut state = state.write().await;

    let player = state.players.get_mut(identity).ok_or("Player not found")?;

    if let Some(ref w) = p.weapon {
        player.weapon = parse_weapon(w);
    }
    if let Some(ref s) = p.secondary {
        player.secondary = parse_secondary(s);
    }
    Ok(None)
}

pub async fn set_marble_config(
    state: Arc<RwLock<ServerState>>,
    identity: &Identity,
    params: Value,
) -> ActionResult {
    let p: SetMarbleConfigParams = serde_json::from_value(params).map_err(|e| e.to_string())?;

    let mut state = state.write().await;

    let player = state.players.get_mut(identity).ok_or("Player not found")?;

    if let Some(d) = p.design_id {
        player.design_id = d.min(4);
    }
    if let Some(v) = p.main_r {
        player.color_r = v.clamp(0.0, 1.0);
    }
    if let Some(v) = p.main_g {
        player.color_g = v.clamp(0.0, 1.0);
    }
    if let Some(v) = p.main_b {
        player.color_b = v.clamp(0.0, 1.0);
    }
    if let Some(v) = p.sec_r {
        player.secondary_color_r = v.clamp(0.0, 1.0);
    }
    if let Some(v) = p.sec_g {
        player.secondary_color_g = v.clamp(0.0, 1.0);
    }
    if let Some(v) = p.sec_b {
        player.secondary_color_b = v.clamp(0.0, 1.0);
    }
    let broadcast = BroadcastPlayerJoined {
        lobby_id: player.lobby_id,
        player: player.clone(),
    };
    Ok(Some(broadcast))
}

//! Build protobuf payloads for client sync

use crate::pb::gyrii::{
    server_message, Delta, FlagState as FlagStateProto, GameEnded, GrenadeDelete,
    GrenadeInsert, GrenadeUpdate, KillEvent, Lobby, LobbyList, LobbyState, LobbySummary, PhotonBeam,
    Player, PlayerJoined, PlayerLeft, PlayerProfile, PlayerRealtime, SecondaryEffectEvent,
    ServerMessage, ShotEvent,
};
use crate::protocol::{KillEventPayload, SecondaryEffectPayload, ShotEventPayload};
use crate::state::{
    FlagData, GameMode, GameState, GrenadeData, Lobby as StateLobby, PhotonBeamData,
    Player as StatePlayer,
};
use crate::state::{MapId, SecondaryType, WeaponType};
use uuid::Uuid;

fn identity_to_bytes(s: &str) -> Vec<u8> {
    Uuid::parse_str(s)
        .map(|u| u.as_bytes().to_vec())
        .unwrap_or_default()
}

fn weapon_to_proto(w: WeaponType) -> i32 {
    use crate::pb::gyrii::WeaponType as P;
    let v = match w {
        WeaponType::Smg => P::WeaponSmg,
        WeaponType::DualMachineGun => P::WeaponDualMachineGun,
        WeaponType::ChainGun => P::WeaponChainGun,
        WeaponType::PhotonRifle => P::WeaponPhotonRifle,
        WeaponType::Bazooka => P::WeaponBazooka,
        WeaponType::Flamethrower => P::WeaponFlamethrower,
        WeaponType::Shotgun => P::WeaponShotgun,
    };
    v as i32
}

fn secondary_to_proto(s: SecondaryType) -> i32 {
    use crate::pb::gyrii::SecondaryType as P;
    let v = match s {
        SecondaryType::PopupKnives => P::SecondaryPopupKnives,
        SecondaryType::BubbleShield => P::SecondaryBubbleShield,
        SecondaryType::SelfDestructNuke => P::SecondarySelfDestructNuke,
        SecondaryType::PopupHammers => P::SecondaryPopupHammers,
        SecondaryType::Dash => P::SecondaryDash,
    };
    v as i32
}

fn game_mode_to_proto(m: GameMode) -> i32 {
    use crate::pb::gyrii::GameMode as P;
    let v = match m {
        GameMode::FreeForAll => P::FreeForAll,
        GameMode::TeamDeathmatch => P::TeamDeathmatch,
        GameMode::CaptureTheFlag => P::CaptureTheFlag,
    };
    v as i32
}

fn game_state_to_proto(s: GameState) -> i32 {
    use crate::pb::gyrii::GameState as P;
    let v = match s {
        GameState::Waiting => P::Waiting,
        GameState::Starting => P::Starting,
        GameState::InProgress => P::InProgress,
        GameState::Ended => P::Ended,
    };
    v as i32
}

fn map_id_to_proto(id: MapId) -> i32 {
    use crate::pb::gyrii::MapId as P;
    let v = match id {
        MapId::Arena => P::MapArena,
        MapId::Maze => P::MapMaze,
        MapId::Warehouse => P::MapWarehouse,
        MapId::Custom => P::MapCustom,
    };
    v as i32
}

fn player_to_proto(p: &StatePlayer) -> Player {
    Player {
        id: identity_to_bytes(&p.identity),
        name: p.name.clone(),
        position_x: p.position_x,
        position_y: p.position_y,
        position_z: p.position_z,
        health: p.health,
        kills: p.kills,
        deaths: p.deaths,
        team: p.team,
        color_r: p.color_r,
        color_g: p.color_g,
        color_b: p.color_b,
        design_id: p.design_id as u32,
        secondary_color_r: p.secondary_color_r,
        secondary_color_g: p.secondary_color_g,
        secondary_color_b: p.secondary_color_b,
        weapon: weapon_to_proto(p.weapon),
        secondary: secondary_to_proto(p.secondary),
        velocity_x: p.velocity_x,
        velocity_y: p.velocity_y,
        velocity_z: p.velocity_z,
        server_snapshot_id: p.server_snapshot_id,
        is_alive: p.is_alive,
        grenade_count: p.grenades,
        molotov_count: p.molotovs,
        last_shot_at: if p.last_shot_at > 0 {
            Some(p.last_shot_at)
        } else {
            None
        },
        last_grenade_thrown_at: if p.last_grenade_thrown_at > 0 {
            Some(p.last_grenade_thrown_at)
        } else {
            None
        },
        aim_x: p.aim_x,
        aim_z: p.aim_z,
        held_flag_team: p.held_flag_team,
        secondary_forced_cooldown_until_micros: if p.secondary_forced_cooldown_until_micros > 0 {
            Some(p.secondary_forced_cooldown_until_micros)
        } else {
            None
        },
    }
}

fn player_to_profile_proto(p: &StatePlayer) -> PlayerProfile {
    PlayerProfile {
        id: identity_to_bytes(&p.identity),
        name: p.name.clone(),
        team: p.team,
        color_r: p.color_r,
        color_g: p.color_g,
        color_b: p.color_b,
        design_id: p.design_id as u32,
        secondary_color_r: p.secondary_color_r,
        secondary_color_g: p.secondary_color_g,
        secondary_color_b: p.secondary_color_b,
        weapon: weapon_to_proto(p.weapon),
        secondary: secondary_to_proto(p.secondary),
    }
}

fn player_to_realtime_proto(p: &StatePlayer) -> PlayerRealtime {
    PlayerRealtime {
        id: identity_to_bytes(&p.identity),
        team: p.team,
        weapon: weapon_to_proto(p.weapon),
        secondary: secondary_to_proto(p.secondary),
        position_x: p.position_x,
        position_y: p.position_y,
        position_z: p.position_z,
        health: p.health,
        kills: p.kills,
        deaths: p.deaths,
        velocity_x: p.velocity_x,
        velocity_y: p.velocity_y,
        velocity_z: p.velocity_z,
        server_snapshot_id: p.server_snapshot_id,
        is_alive: p.is_alive,
        grenade_count: p.grenades,
        molotov_count: p.molotovs,
        last_shot_at: if p.last_shot_at > 0 {
            Some(p.last_shot_at)
        } else {
            None
        },
        last_grenade_thrown_at: if p.last_grenade_thrown_at > 0 {
            Some(p.last_grenade_thrown_at)
        } else {
            None
        },
        aim_x: p.aim_x,
        aim_z: p.aim_z,
        held_flag_team: p.held_flag_team,
        secondary_forced_cooldown_until_micros: if p.secondary_forced_cooldown_until_micros > 0 {
            Some(p.secondary_forced_cooldown_until_micros)
        } else {
            None
        },
    }
}

fn flag_to_proto(f: &FlagData) -> FlagStateProto {
    let (state_enum, position_x, position_y, position_z, carrier_id, rigid_body_id) =
        match &f.state {
            crate::state::FlagState::AtBase {
                position_x,
                position_y,
                position_z,
            } => (0, *position_x, *position_y, *position_z, None, None),
            crate::state::FlagState::Carried { carrier_id } => (
                1,
                0.0,
                0.0,
                0.0,
                Some(identity_to_bytes(carrier_id)),
                None,
            ),
            crate::state::FlagState::Dropped {
                rigid_body_id,
                position_x,
                position_y,
                position_z,
            } => (
                2,
                *position_x,
                *position_y,
                *position_z,
                None,
                Some(*rigid_body_id),
            ),
        };
    FlagStateProto {
        team: f.team,
        state: state_enum,
        position_x,
        position_y,
        position_z,
        carrier_id,
        rigid_body_id,
    }
}

pub fn encode_server_message(msg: ServerMessage) -> Vec<u8> {
    use prost::Message;
    let mut buf = Vec::with_capacity(msg.encoded_len());
    msg.encode(&mut buf).expect("encode");
    buf
}

pub fn build_init(identity: &str) -> Vec<u8> {
    let msg = ServerMessage {
        message: Some(server_message::Message::Init(crate::pb::gyrii::Init {
            identity: identity_to_bytes(identity),
        })),
    };
    encode_server_message(msg)
}

pub fn build_ok() -> Vec<u8> {
    let msg = ServerMessage {
        message: Some(server_message::Message::Ok(crate::pb::gyrii::Ok { ok: true })),
    };
    encode_server_message(msg)
}

pub fn build_error(error: &str) -> Vec<u8> {
    let msg = ServerMessage {
        message: Some(server_message::Message::Error(crate::pb::gyrii::Error {
            error: error.to_string(),
        })),
    };
    encode_server_message(msg)
}

pub fn build_player_joined(player: &StatePlayer) -> Vec<u8> {
    let msg = ServerMessage {
        message: Some(server_message::Message::PlayerJoined(PlayerJoined {
            player: Some(player_to_profile_proto(player)),
        })),
    };
    encode_server_message(msg)
}

pub fn build_player_left(player_id: &str) -> Vec<u8> {
    let msg = ServerMessage {
        message: Some(server_message::Message::PlayerLeft(PlayerLeft {
            player_id: identity_to_bytes(player_id),
        })),
    };
    encode_server_message(msg)
}

pub fn build_lobby_state(
    lobby: &StateLobby,
    players: &[StatePlayer],
    flags: &[FlagData],
    snapshot_id: u64,
    last_delta_id: u64,
) -> Vec<u8> {
    let lobby_proto = Lobby {
        id: lobby.id,
        name: lobby.name.clone(),
        host_id: identity_to_bytes(&lobby.host_id),
        map_id: map_id_to_proto(lobby.map_id),
        map_pool: lobby.map_pool.iter().map(|m| map_id_to_proto(*m)).collect(),
        max_players: lobby.max_players as u32,
        game_mode: game_mode_to_proto(lobby.game_mode),
        game_state: game_state_to_proto(lobby.game_state),
        score_limit: lobby.score_limit,
        flag_limit: lobby.flag_limit,
        next_round_starts_at_ms: lobby.next_round_starts_at_ms,
        is_custom_map: lobby.custom_map_json.is_some(),
        map_json: lobby.custom_map_json.clone(),
        team_count: lobby.num_teams,
    };
    let msg = ServerMessage {
        message: Some(server_message::Message::LobbyState(LobbyState {
            snapshot_id,
            last_delta_id,
            lobby: Some(lobby_proto),
            players: players.iter().map(player_to_proto).collect(),
            flags: flags.iter().map(flag_to_proto).collect(),
        })),
    };
    encode_server_message(msg)
}

pub fn build_lobby_list(lobbies: &[(StateLobby, u32)]) -> Vec<u8> {
    let summaries: Vec<LobbySummary> = lobbies
        .iter()
        .map(|(lobby, player_count)| LobbySummary {
            id: lobby.id,
            name: lobby.name.clone(),
            host_id: identity_to_bytes(&lobby.host_id),
            map_id: map_id_to_proto(lobby.map_id),
            map_pool: lobby.map_pool.iter().map(|m| map_id_to_proto(*m)).collect(),
            max_players: lobby.max_players as u32,
            player_count: *player_count,
            game_mode: game_mode_to_proto(lobby.game_mode),
            game_state: game_state_to_proto(lobby.game_state),
            has_password: lobby.has_password,
            score_limit: lobby.score_limit,
            flag_limit: lobby.flag_limit,
            next_round_starts_at_ms: lobby.next_round_starts_at_ms,
            is_custom_map: lobby.custom_map_json.is_some(),
            team_count: lobby.num_teams,
        })
        .collect();
    let msg = ServerMessage {
        message: Some(server_message::Message::LobbyList(LobbyList {
            lobbies: summaries,
        })),
    };
    encode_server_message(msg)
}

pub fn build_game_ended(
    lobby_id: u64,
    winner_team: Option<i32>,
    winner_player_identity: Option<String>,
    winner_player_name: Option<String>,
    next_map_id: MapId,
    countdown_ms: u64,
) -> Vec<u8> {
    let msg = ServerMessage {
        message: Some(server_message::Message::GameEnded(GameEnded {
            lobby_id,
            winner_team,
            winner_player_identity: winner_player_identity.map(|s| identity_to_bytes(&s)),
            winner_player_name,
            next_map_id: map_id_to_proto(next_map_id),
            countdown_ms,
        })),
    };
    encode_server_message(msg)
}

pub fn grenade_to_insert_proto(
    g: &GrenadeData,
    position: (f32, f32, f32),
    velocity: (f32, f32, f32),
    owner_color: [f32; 3],
) -> GrenadeInsert {
    GrenadeInsert {
        rigid_body_id: g.rigid_body_id,
        position_x: position.0,
        position_y: position.1,
        position_z: position.2,
        velocity_x: velocity.0,
        velocity_y: velocity.1,
        velocity_z: velocity.2,
        owner_id: identity_to_bytes(&g.owner_id),
        owner_color_r: owner_color[0],
        owner_color_g: owner_color[1],
        owner_color_b: owner_color[2],
    }
}

pub fn grenade_to_update_proto(
    rigid_body_id: u64,
    position: (f32, f32, f32),
    velocity: (f32, f32, f32),
) -> GrenadeUpdate {
    GrenadeUpdate {
        rigid_body_id,
        position_x: position.0,
        position_y: position.1,
        position_z: position.2,
        velocity_x: velocity.0,
        velocity_y: velocity.1,
        velocity_z: velocity.2,
    }
}

pub fn photon_beam_to_proto(b: &PhotonBeamData) -> PhotonBeam {
    PhotonBeam {
        id: b.id,
        owner_id: identity_to_bytes(&b.owner_id),
        origin_x: b.origin_x,
        origin_y: b.origin_y,
        origin_z: b.origin_z,
        end_x: b.end_x,
        end_y: b.end_y,
        end_z: b.end_z,
        remaining_ticks: b.remaining_ticks,
    }
}

fn weapon_str_to_proto(s: &str) -> i32 {
    use crate::pb::gyrii::WeaponType as P;
    let v = match s {
        "smg" => P::WeaponSmg,
        "dualMachineGun" => P::WeaponDualMachineGun,
        "chainGun" => P::WeaponChainGun,
        "photonRifle" => P::WeaponPhotonRifle,
        "bazooka" => P::WeaponBazooka,
        "flamethrower" => P::WeaponFlamethrower,
        "shotgun" => P::WeaponShotgun,
        _ => P::WeaponSmg,
    };
    v as i32
}

fn secondary_effect_to_proto(p: &SecondaryEffectPayload) -> SecondaryEffectEvent {
    SecondaryEffectEvent {
        player_id: identity_to_bytes(&p.player_id),
        secondary_type: secondary_to_proto(p.secondary_type) as i32,
        position_x: p.position[0],
        position_y: p.position[1],
        position_z: p.position[2],
        direction_x: p.direction[0],
        direction_z: p.direction[1],
    }
}

pub fn build_delta(
    tick: u64,
    delta_id: u64,
    base_snapshot_id: u64,
    players: &[StatePlayer],
    shot_events: &[ShotEventPayload],
    grenade_inserts: &[GrenadeInsert],
    grenade_deletes: &[GrenadeDelete],
    grenade_updates: &[GrenadeUpdate],
    kill_events: &[KillEventPayload],
    photon_beams: &[PhotonBeam],
    flags: &[FlagData],
    secondary_effect_events: &[SecondaryEffectPayload],
) -> Vec<u8> {
    let delta = Delta {
        tick,
        delta_id,
        base_snapshot_id,
        players: players.iter().map(player_to_realtime_proto).collect(),
        shot_events: shot_events
            .iter()
            .map(|e| ShotEvent {
                player_id: identity_to_bytes(&e.player_id),
                weapon: weapon_str_to_proto(&e.weapon),
                projectile_type: e.projectile_type as u32,
                position_x: e.position[0],
                position_y: e.position[1],
                position_z: e.position[2],
                velocity_x: e.velocity[0],
                velocity_y: e.velocity[1],
                velocity_z: e.velocity[2],
            })
            .collect(),
        grenade_inserts: grenade_inserts.to_vec(),
        grenade_deletes: grenade_deletes.to_vec(),
        grenade_updates: grenade_updates.to_vec(),
        kill_events: kill_events
            .iter()
            .map(|e| KillEvent {
                killer_id: identity_to_bytes(&e.killer_id),
                killer_name: e.killer_name.clone(),
                victim_id: identity_to_bytes(&e.victim_id),
                victim_name: e.victim_name.clone(),
                weapon: e.weapon.clone(),
                timestamp: e.timestamp,
            })
            .collect(),
        photon_beams: photon_beams.to_vec(),
        flags: flags.iter().map(flag_to_proto).collect(),
        secondary_effect_events: secondary_effect_events
            .iter()
            .map(secondary_effect_to_proto)
            .collect(),
    };
    let msg = ServerMessage {
        message: Some(server_message::Message::Delta(delta)),
    };
    encode_server_message(msg)
}

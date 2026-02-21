//! Build serializable payloads for client sync

use crate::protocol::{
    DeltaMessage, GrenadeDeletePayload, GrenadeInsertPayload, GrenadeUpdatePayload,
    GameEndedMessage, KillEventPayload, LobbyListMessage, LobbyPayload, LobbyStateMessage,
    LobbySummaryPayload, PhotonBeamPayload, PlayerJoinedMessage, PlayerLeftMessage, PlayerPayload,
    PlayerProfilePayload, PlayerRealtimePayload, ShotEventPayload,
};
use crate::state::{GameMode, GameState, GrenadeData, Lobby, PhotonBeamData, Player};

fn game_state_str(s: GameState) -> &'static str {
    match s {
        GameState::Waiting => "waiting",
        GameState::Starting => "starting",
        GameState::InProgress => "inProgress",
        GameState::Ended => "ended",
    }
}

fn game_mode_str(m: GameMode) -> &'static str {
    match m {
        GameMode::FreeForAll => "freeForAll",
        GameMode::TeamDeathmatch => "teamDeathmatch",
        GameMode::CaptureTheFlag => "captureTheFlag",
    }
}

fn map_id_str(id: crate::state::MapId) -> &'static str {
    id.as_lower()
}

fn weapon_str(w: crate::state::WeaponType) -> &'static str {
    match w {
        crate::state::WeaponType::Smg => "smg",
        crate::state::WeaponType::DualMachineGun => "dualMachineGun",
        crate::state::WeaponType::ChainGun => "chainGun",
        crate::state::WeaponType::PhotonRifle => "photonRifle",
        crate::state::WeaponType::Bazooka => "bazooka",
        crate::state::WeaponType::Flamethrower => "flamethrower",
    }
}

fn secondary_str(s: crate::state::SecondaryType) -> &'static str {
    match s {
        crate::state::SecondaryType::PopupKnives => "popupKnives",
        crate::state::SecondaryType::BubbleShield => "bubbleShield",
        crate::state::SecondaryType::SelfDestructNuke => "selfDestructNuke",
    }
}

fn player_to_payload(p: &Player) -> PlayerPayload {
    PlayerPayload {
        id: p.identity.clone(),
        name: p.name.clone(),
        position: [p.position_x, p.position_y, p.position_z],
        health: p.health,
        kills: p.kills,
        deaths: p.deaths,
        team: p.team,
        color: [p.color_r, p.color_g, p.color_b],
        design_id: p.design_id,
        secondary_color: [
            p.secondary_color_r,
            p.secondary_color_g,
            p.secondary_color_b,
        ],
        weapon: weapon_str(p.weapon).to_string(),
        secondary: secondary_str(p.secondary).to_string(),
        velocity: [p.velocity_x, p.velocity_y, p.velocity_z],
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
    }
}

pub fn player_to_profile_payload(p: &Player) -> PlayerProfilePayload {
    PlayerProfilePayload {
        id: p.identity.clone(),
        name: p.name.clone(),
        team: p.team,
        color: [p.color_r, p.color_g, p.color_b],
        design_id: p.design_id,
        secondary_color: [
            p.secondary_color_r,
            p.secondary_color_g,
            p.secondary_color_b,
        ],
        weapon: weapon_str(p.weapon).to_string(),
        secondary: secondary_str(p.secondary).to_string(),
    }
}

fn player_to_realtime_payload(p: &Player) -> PlayerRealtimePayload {
    PlayerRealtimePayload {
        id: p.identity.clone(),
        team: p.team,
        weapon: weapon_str(p.weapon).to_string(),
        secondary: secondary_str(p.secondary).to_string(),
        position: [p.position_x, p.position_y, p.position_z],
        health: p.health,
        kills: p.kills,
        deaths: p.deaths,
        velocity: [p.velocity_x, p.velocity_y, p.velocity_z],
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
    }
}

pub fn build_player_joined(player: &Player) -> PlayerJoinedMessage {
    PlayerJoinedMessage {
        r#type: "player_joined",
        player: player_to_profile_payload(player),
    }
}

pub fn build_player_left(player_id: &str) -> PlayerLeftMessage {
    PlayerLeftMessage {
        r#type: "player_left",
        player_id: player_id.to_string(),
    }
}

pub fn build_lobby_state(
    lobby: &Lobby,
    players: &[Player],
) -> LobbyStateMessage {
    LobbyStateMessage {
        r#type: "lobby_state",
        lobby: LobbyPayload {
            id: lobby.id.to_string(),
            name: lobby.name.clone(),
            host_id: lobby.host_id.clone(),
            map_id: map_id_str(lobby.map_id).to_string(),
            map_pool: lobby.map_pool.iter().map(|m| m.as_lower().to_string()).collect(),
            max_players: lobby.max_players,
            game_mode: game_mode_str(lobby.game_mode).to_string(),
            game_state: game_state_str(lobby.game_state).to_string(),
            score_limit: lobby.score_limit,
            flag_limit: lobby.flag_limit,
            next_round_starts_at_ms: lobby.next_round_starts_at_ms,
        },
        players: players.iter().map(player_to_payload).collect(),
    }
}

pub fn build_lobby_list(lobbies: &[(Lobby, u32)]) -> LobbyListMessage {
    LobbyListMessage {
        r#type: "lobby_list",
        lobbies: lobbies
            .iter()
            .map(|(lobby, player_count)| LobbySummaryPayload {
                id: lobby.id.to_string(),
                name: lobby.name.clone(),
                host_id: lobby.host_id.clone(),
                map_id: map_id_str(lobby.map_id).to_string(),
                map_pool: lobby.map_pool.iter().map(|m| m.as_lower().to_string()).collect(),
                max_players: lobby.max_players,
                player_count: *player_count,
                game_mode: game_mode_str(lobby.game_mode).to_string(),
                game_state: game_state_str(lobby.game_state).to_string(),
                has_password: lobby.has_password,
                score_limit: lobby.score_limit,
                flag_limit: lobby.flag_limit,
                next_round_starts_at_ms: lobby.next_round_starts_at_ms,
            })
            .collect(),
    }
}

pub fn build_game_ended(
    lobby_id: u64,
    winner_team: Option<i32>,
    winner_player_identity: Option<String>,
    winner_player_name: Option<String>,
    next_map_id: crate::state::MapId,
    countdown_ms: u64,
) -> GameEndedMessage {
    GameEndedMessage {
        r#type: "game_ended",
        lobby_id: lobby_id.to_string(),
        winner_team,
        winner_player_identity,
        winner_player_name,
        next_map_id: next_map_id.as_lower().to_string(),
        countdown_ms,
    }
}

pub fn grenade_to_insert_payload(
    g: &GrenadeData,
    position: (f32, f32, f32),
    velocity: (f32, f32, f32),
    owner_color: [f32; 3],
) -> crate::protocol::GrenadeInsertPayload {
    crate::protocol::GrenadeInsertPayload {
        rigid_body_id: g.rigid_body_id,
        position: [position.0, position.1, position.2],
        velocity: [velocity.0, velocity.1, velocity.2],
        owner_id: g.owner_id.clone(),
        owner_color,
    }
}

pub fn grenade_to_update_payload(
    rigid_body_id: u64,
    position: (f32, f32, f32),
    velocity: (f32, f32, f32),
) -> crate::protocol::GrenadeUpdatePayload {
    crate::protocol::GrenadeUpdatePayload {
        rigid_body_id,
        position: [position.0, position.1, position.2],
        velocity: [velocity.0, velocity.1, velocity.2],
    }
}

pub fn photon_beam_to_payload(b: &PhotonBeamData) -> PhotonBeamPayload {
    PhotonBeamPayload {
        id: b.id,
        owner_id: b.owner_id.clone(),
        origin_x: b.origin_x,
        origin_y: b.origin_y,
        origin_z: b.origin_z,
        end_x: b.end_x,
        end_y: b.end_y,
        end_z: b.end_z,
        remaining_ticks: b.remaining_ticks,
    }
}

pub fn build_delta(
    tick: u64,
    players: &[Player],
    shot_events: &[ShotEventPayload],
    grenade_inserts: &[GrenadeInsertPayload],
    grenade_deletes: &[GrenadeDeletePayload],
    grenade_updates: &[GrenadeUpdatePayload],
    kill_events: &[KillEventPayload],
    photon_beams: &[PhotonBeamPayload],
) -> DeltaMessage {
    DeltaMessage {
        r#type: "delta",
        tick,
        players: players.iter().map(player_to_realtime_payload).collect(),
        shot_events: shot_events.to_vec(),
        grenade_inserts: grenade_inserts.to_vec(),
        grenade_deletes: grenade_deletes.to_vec(),
        grenade_updates: grenade_updates.to_vec(),
        kill_events: kill_events.to_vec(),
        photon_beams: photon_beams.to_vec(),
    }
}

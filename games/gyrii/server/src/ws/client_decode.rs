//! Decode ClientMessage (protobuf) to (action, params) for actions::handle_action

use crate::pb::gyrii::client_message::Message as ClientMsg;
use crate::pb::gyrii::{ClientMessage, CreateLobby, JoinLobby, RequestSpawn, SetMarbleConfig};
use prost::Message;
use serde_json::{json, Value};

fn map_id_to_pascal(v: i32) -> &'static str {
    use crate::pb::gyrii::MapId;
    match MapId::try_from(v) {
        Ok(MapId::MapArena) => "Arena",
        Ok(MapId::MapMaze) => "Maze",
        Ok(MapId::MapWarehouse) => "Warehouse",
        _ => "Arena",
    }
}

fn game_mode_to_pascal(v: i32) -> &'static str {
    use crate::pb::gyrii::GameMode;
    match GameMode::try_from(v) {
        Ok(GameMode::FreeForAll) => "FreeForAll",
        Ok(GameMode::TeamDeathmatch) => "TeamDeathmatch",
        Ok(GameMode::CaptureTheFlag) => "CaptureTheFlag",
        _ => "FreeForAll",
    }
}

fn weapon_to_pascal(v: i32) -> &'static str {
    use crate::pb::gyrii::WeaponType;
    match WeaponType::try_from(v) {
        Ok(WeaponType::WeaponSmg) => "Smg",
        Ok(WeaponType::WeaponDualMachineGun) => "DualMachineGun",
        Ok(WeaponType::WeaponChainGun) => "ChainGun",
        Ok(WeaponType::WeaponPhotonRifle) => "PhotonRifle",
        Ok(WeaponType::WeaponBazooka) => "Bazooka",
        Ok(WeaponType::WeaponFlamethrower) => "Flamethrower",
        Ok(WeaponType::WeaponShotgun) => "Shotgun",
        _ => "Smg",
    }
}

fn secondary_to_pascal(v: i32) -> &'static str {
    use crate::pb::gyrii::SecondaryType;
    match SecondaryType::try_from(v) {
        Ok(SecondaryType::SecondaryPopupKnives) => "PopupKnives",
        Ok(SecondaryType::SecondaryBubbleShield) => "BubbleShield",
        Ok(SecondaryType::SecondarySelfDestructNuke) => "SelfDestructNuke",
        Ok(SecondaryType::SecondaryPopupHammers) => "PopupHammers",
        Ok(SecondaryType::SecondaryDash) => "Dash",
        _ => "PopupKnives",
    }
}

/// Decode ClientMessage from bytes. Returns None if invalid/empty.
pub fn decode_client_message(data: &[u8]) -> Option<(&'static str, Value)> {
    let msg = ClientMessage::decode(data).ok()?;
    let inner = msg.message?;
    Some(match inner {
        ClientMsg::Authenticate(a) => (
            "authenticate",
            json!({ "accessToken": a.access_token }),
        ),
        ClientMsg::ListLobbies(_) => ("list_lobbies", json!({})),
        ClientMsg::CreateLobby(c) => create_lobby_to_value(c),
        ClientMsg::JoinLobby(j) => join_lobby_to_value(j),
        ClientMsg::RequestLobbyState(_) => ("request_lobby_state", json!({})),
        ClientMsg::LeaveLobby(_) => ("leave_lobby", json!({})),
        ClientMsg::SetReady(s) => ("set_ready", json!({ "ready": s.ready })),
        ClientMsg::StartGame(_) => ("start_game", json!({})),
        ClientMsg::EndGame(e) => ("end_game", json!({ "lobbyId": e.lobby_id })),
        ClientMsg::RequestSpawn(r) => request_spawn_to_value(r),
        ClientMsg::UpdateInput(u) => (
            "update_input",
            json!({
                "inputX": u.input_x,
                "inputZ": u.input_z,
                "aimX": u.aim_x,
                "aimZ": u.aim_z
            }),
        ),
        ClientMsg::SetShooting(s) => (
            "set_shooting",
            json!({
                "isShooting": s.is_shooting,
                "aimX": s.aim_x,
                "aimZ": s.aim_z
            }),
        ),
        ClientMsg::SetLoadout(l) => (
            "set_loadout",
            json!({
                "weapon": weapon_to_pascal(l.weapon),
                "secondary": secondary_to_pascal(l.secondary)
            }),
        ),
        ClientMsg::SetMarbleConfig(m) => set_marble_config_to_value(m),
        ClientMsg::Shoot(_) => ("shoot", json!({})),
        ClientMsg::DetonateRocket(_) => ("detonate_rocket", json!({})),
        ClientMsg::ThrowGrenade(t) => (
            "throw_grenade",
            json!({ "aimX": t.aim_x, "aimZ": t.aim_z }),
        ),
        ClientMsg::ThrowMolotov(t) => (
            "throw_molotov",
            json!({ "aimX": t.aim_x, "aimZ": t.aim_z }),
        ),
        ClientMsg::UseSecondary(_) => ("use_secondary", json!({})),
    })
}

fn create_lobby_to_value(c: CreateLobby) -> (&'static str, Value) {
    let map_pool: Vec<Value> = c
        .map_pool
        .iter()
        .map(|&v| json!(map_id_to_pascal(v)))
        .collect();
    let mut params = json!({
        "name": c.name,
        "hostPlayerName": c.host_player_name,
        "mapId": { "tag": map_id_to_pascal(c.map_id) },
        "mapPool": map_pool,
        "gameMode": { "tag": game_mode_to_pascal(c.game_mode) },
        "maxPlayers": c.max_players,
        "scoreLimit": c.score_limit,
        "flagLimit": c.flag_limit,
        "password": c.password
    });
    if let Some(ref s) = c.custom_map_json.as_ref().filter(|s| !s.is_empty()) {
        params["customMapJson"] = json!(s);
    }
    params["teamCount"] = json!(c.team_count);
    ("create_lobby", params)
}

fn join_lobby_to_value(j: JoinLobby) -> (&'static str, Value) {
    (
        "join_lobby",
        json!({
            "lobbyId": j.lobby_id,
            "playerName": j.player_name,
            "password": j.password
        }),
    )
}

fn request_spawn_to_value(r: RequestSpawn) -> (&'static str, Value) {
    (
        "request_spawn",
        json!({
            "weapon": { "tag": weapon_to_pascal(r.weapon) },
            "secondary": { "tag": secondary_to_pascal(r.secondary) }
        }),
    )
}

fn set_marble_config_to_value(m: SetMarbleConfig) -> (&'static str, Value) {
    (
        "set_marble_config",
        json!({
            "designId": m.design_id,
            "mainR": m.main_r,
            "mainG": m.main_g,
            "mainB": m.main_b,
            "secR": m.sec_r,
            "secG": m.sec_g,
            "secB": m.sec_b
        }),
    )
}
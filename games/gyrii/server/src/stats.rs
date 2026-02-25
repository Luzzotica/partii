//! Gyrii match stats tracking and async Supabase flush.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

use crate::state::{GameMode, MapId, ServerState};

#[derive(Clone, Debug)]
pub struct PlayerMatchRuntimeStats {
    pub identity: String,
    pub user_id: Option<String>,
    pub player_name: String,
    pub team: i32,
    pub kills: i32,
    pub deaths: i32,
    pub damage_dealt: i32,
    pub damage_taken: i32,
    pub assists: i32,
}

#[derive(Clone, Debug)]
pub struct OngoingMatchStats {
    pub lobby_id: u64,
    pub map_id: String,
    pub game_mode: String,
    pub score_limit: i32,
    pub flag_limit: i32,
    pub started_at_ms: u64,
    pub players: HashMap<String, PlayerMatchRuntimeStats>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FinalizedMatchPlayerRow {
    pub user_id: String,
    pub player_identity: String,
    pub player_name: String,
    pub team: i32,
    pub kills: i32,
    pub deaths: i32,
    pub damage_dealt: i32,
    pub damage_taken: i32,
    pub assists: i32,
    pub placement: i32,
}

#[derive(Clone, Debug)]
pub struct FinalizedMatchSnapshot {
    pub lobby_id: u64,
    pub map_id: String,
    pub game_mode: String,
    pub score_limit: i32,
    pub flag_limit: i32,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    pub winner_team: Option<i32>,
    pub winning_player_identity: Option<String>,
    pub player_rows: Vec<FinalizedMatchPlayerRow>,
}

#[derive(Clone, Debug)]
pub struct StatsFlushJob {
    pub snapshot: FinalizedMatchSnapshot,
}

#[derive(Clone, Debug)]
struct SupabaseConfig {
    url: String,
    service_role_key: String,
}

#[derive(Debug, Deserialize)]
struct AuthUserResponse {
    id: String,
}

#[derive(Debug, Deserialize)]
struct InsertedMatch {
    id: String,
}

#[derive(Debug, Serialize)]
struct MatchInsertPayload<'a> {
    game_type_id: &'a str,
    lobby_id: i64,
    map_id: &'a str,
    game_mode: &'a str,
    score_limit: i32,
    flag_limit: i32,
    started_at_ms: i64,
    ended_at_ms: i64,
    winner_team: Option<i32>,
    winning_player_identity: Option<&'a str>,
}

#[derive(Debug, Serialize)]
struct MatchPlayerInsertPayload<'a> {
    match_id: &'a str,
    user_id: &'a str,
    player_identity: &'a str,
    player_name: &'a str,
    team: i32,
    kills: i32,
    deaths: i32,
    damage_dealt: i32,
    damage_taken: i32,
    assists: i32,
    placement: i32,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn map_id_to_str(map_id: MapId) -> &'static str {
    match map_id {
        MapId::Arena => "Arena",
        MapId::Maze => "Maze",
        MapId::Warehouse => "Warehouse",
        MapId::Custom => "Custom",
    }
}

fn game_mode_to_str(mode: GameMode) -> &'static str {
    match mode {
        GameMode::FreeForAll => "FreeForAll",
        GameMode::TeamDeathmatch => "TeamDeathmatch",
        GameMode::CaptureTheFlag => "CaptureTheFlag",
    }
}

fn supabase_config_from_env() -> Option<SupabaseConfig> {
    let url = std::env::var("SUPABASE_URL")
        .ok()
        .or_else(|| std::env::var("NEXT_PUBLIC_SUPABASE_URL").ok())?;
    let service_role_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY").ok()?;
    Some(SupabaseConfig {
        url,
        service_role_key,
    })
}

pub fn spawn_stats_flush_worker() -> UnboundedSender<StatsFlushJob> {
    let (tx, mut rx) = unbounded_channel::<StatsFlushJob>();
    let client = Client::new();
    let cfg = supabase_config_from_env();

    tokio::spawn(async move {
        if cfg.is_none() {
            tracing::warn!("Supabase stats flush disabled: missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
        }

        while let Some(job) = rx.recv().await {
            let Some(cfg) = cfg.as_ref() else {
                continue;
            };
            if let Err(err) = flush_snapshot(&client, cfg, &job.snapshot).await {
                tracing::error!("Failed to flush Gyrii stats snapshot: {}", err);
            }
        }
    });

    tx
}

pub fn attach_flush_sender(state: &mut ServerState, tx: UnboundedSender<StatsFlushJob>) {
    state.stats_flush_tx = Some(tx);
}

pub async fn verify_access_token(access_token: &str) -> Result<String, String> {
    let cfg = supabase_config_from_env()
        .ok_or_else(|| "Supabase auth verification is not configured on server".to_string())?;
    let client = Client::new();
    let url = format!("{}/auth/v1/user", cfg.url.trim_end_matches('/'));
    let response = client
        .get(url)
        .header("apikey", &cfg.service_role_key)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Auth verification request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Auth verification failed with status {}",
            response.status()
        ));
    }

    let payload: AuthUserResponse = response
        .json()
        .await
        .map_err(|e| format!("Invalid auth verification response: {}", e))?;
    Ok(payload.id)
}

pub fn set_identity_user_id(state: &mut ServerState, identity: &str, user_id: String) {
    state
        .identity_user_ids
        .insert(identity.to_string(), user_id.clone());

    for tracker in state.ongoing_matches.values_mut() {
        if let Some(player) = tracker.players.get_mut(identity) {
            player.user_id = Some(user_id.clone());
        }
    }
}

pub fn clear_identity_user_id(state: &mut ServerState, identity: &str) {
    state.identity_user_ids.remove(identity);
}

pub fn start_match_tracking(state: &mut ServerState, lobby_id: u64) {
    if state.ongoing_matches.contains_key(&lobby_id) {
        return;
    }

    let Some(lobby) = state.lobbies.get(&lobby_id).cloned() else {
        return;
    };

    let mut players = HashMap::new();
    for lp in state.lobby_players.iter().filter(|lp| lp.lobby_id == lobby_id) {
        let user_id = state.identity_user_ids.get(&lp.player_identity).cloned();
        players.insert(
            lp.player_identity.clone(),
            PlayerMatchRuntimeStats {
                identity: lp.player_identity.clone(),
                user_id,
                player_name: lp.name.clone(),
                team: lp.team,
                kills: 0,
                deaths: 0,
                damage_dealt: 0,
                damage_taken: 0,
                assists: 0,
            },
        );
    }

    state.ongoing_matches.insert(
        lobby_id,
        OngoingMatchStats {
            lobby_id,
            map_id: map_id_to_str(lobby.map_id).to_string(),
            game_mode: game_mode_to_str(lobby.game_mode).to_string(),
            score_limit: lobby.score_limit,
            flag_limit: lobby.flag_limit,
            started_at_ms: now_millis(),
            players,
        },
    );
}

pub fn record_damage(state: &mut ServerState, lobby_id: u64, source_id: &str, target_id: &str, damage: i32) {
    let Some(tracker) = state.ongoing_matches.get_mut(&lobby_id) else {
        return;
    };
    if damage <= 0 {
        return;
    }

    if source_id != target_id {
        if let Some(source) = tracker.players.get_mut(source_id) {
            source.damage_dealt += damage;
        }
    }
    if let Some(target) = tracker.players.get_mut(target_id) {
        target.damage_taken += damage;
    }
}

pub fn record_kill(state: &mut ServerState, lobby_id: u64, killer_id: &str, victim_id: &str) {
    let Some(tracker) = state.ongoing_matches.get_mut(&lobby_id) else {
        return;
    };

    if killer_id != victim_id {
        if let Some(killer) = tracker.players.get_mut(killer_id) {
            killer.kills += 1;
        }
    }
    if let Some(victim) = tracker.players.get_mut(victim_id) {
        victim.deaths += 1;
    }
}

pub fn finalize_match_tracking(state: &mut ServerState, lobby_id: u64) {
    let Some(mut tracker) = state.ongoing_matches.remove(&lobby_id) else {
        return;
    };

    // Keep names/teams aligned with the latest lobby snapshot if available.
    for lp in state.lobby_players.iter().filter(|lp| lp.lobby_id == lobby_id) {
        if let Some(p) = tracker.players.get_mut(&lp.player_identity) {
            p.player_name = lp.name.clone();
            p.team = lp.team;
        }
    }

    let mut players: Vec<_> = tracker.players.values().cloned().collect();
    players.sort_by(|a, b| b.kills.cmp(&a.kills).then(a.deaths.cmp(&b.deaths)));

    let mut player_rows = Vec::new();
    for (idx, p) in players.iter().enumerate() {
        let Some(user_id) = p.user_id.clone() else {
            continue;
        };
        player_rows.push(FinalizedMatchPlayerRow {
            user_id,
            player_identity: p.identity.clone(),
            player_name: p.player_name.clone(),
            team: p.team,
            kills: p.kills.max(0),
            deaths: p.deaths.max(0),
            damage_dealt: p.damage_dealt.max(0),
            damage_taken: p.damage_taken.max(0),
            assists: p.assists.max(0),
            placement: (idx as i32) + 1,
        });
    }

    if player_rows.is_empty() {
        return;
    }

    let winning_player_identity = players.first().map(|p| p.identity.clone());
    let winner_team = if tracker.game_mode == "FreeForAll" {
        None
    } else {
        let mut kills_by_team: HashMap<i32, i32> = HashMap::new();
        for p in &players {
            *kills_by_team.entry(p.team).or_insert(0) += p.kills;
        }
        kills_by_team
            .into_iter()
            .max_by_key(|(_, kills)| *kills)
            .map(|(team, _)| team)
    };

    let snapshot = FinalizedMatchSnapshot {
        lobby_id: tracker.lobby_id,
        map_id: tracker.map_id,
        game_mode: tracker.game_mode,
        score_limit: tracker.score_limit,
        flag_limit: tracker.flag_limit,
        started_at_ms: tracker.started_at_ms,
        ended_at_ms: now_millis(),
        winner_team,
        winning_player_identity,
        player_rows,
    };

    if let Some(tx) = state.stats_flush_tx.as_ref() {
        if tx.send(StatsFlushJob { snapshot }).is_err() {
            tracing::warn!("Stats flush queue is unavailable; dropping match snapshot");
        }
    }
}

async fn flush_snapshot(client: &Client, cfg: &SupabaseConfig, snapshot: &FinalizedMatchSnapshot) -> Result<(), String> {
    let matches_url = format!(
        "{}/rest/v1/gyrii_matches?select=id",
        cfg.url.trim_end_matches('/')
    );
    let match_payload = MatchInsertPayload {
        game_type_id: "gyrii",
        lobby_id: snapshot.lobby_id as i64,
        map_id: &snapshot.map_id,
        game_mode: &snapshot.game_mode,
        score_limit: snapshot.score_limit,
        flag_limit: snapshot.flag_limit,
        started_at_ms: snapshot.started_at_ms as i64,
        ended_at_ms: snapshot.ended_at_ms as i64,
        winner_team: snapshot.winner_team,
        winning_player_identity: snapshot.winning_player_identity.as_deref(),
    };

    let response = client
        .post(&matches_url)
        .header("apikey", &cfg.service_role_key)
        .bearer_auth(&cfg.service_role_key)
        .header("Content-Type", "application/json")
        .header("Prefer", "return=representation")
        .json(&match_payload)
        .send()
        .await
        .map_err(|e| format!("Match insert request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| "".to_string());
        return Err(format!("Match insert failed ({}): {}", status, body));
    }

    let inserted: Vec<InsertedMatch> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse inserted match response: {}", e))?;
    let Some(inserted_match) = inserted.first() else {
        return Err("Inserted match response was empty".to_string());
    };

    let players_url = format!("{}/rest/v1/gyrii_match_players", cfg.url.trim_end_matches('/'));
    let player_payloads: Vec<_> = snapshot
        .player_rows
        .iter()
        .map(|p| MatchPlayerInsertPayload {
            match_id: &inserted_match.id,
            user_id: &p.user_id,
            player_identity: &p.player_identity,
            player_name: &p.player_name,
            team: p.team,
            kills: p.kills,
            deaths: p.deaths,
            damage_dealt: p.damage_dealt,
            damage_taken: p.damage_taken,
            assists: p.assists,
            placement: p.placement,
        })
        .collect();

    let response = client
        .post(&players_url)
        .header("apikey", &cfg.service_role_key)
        .bearer_auth(&cfg.service_role_key)
        .header("Content-Type", "application/json")
        .json(&player_payloads)
        .send()
        .await
        .map_err(|e| format!("Player rows insert request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| "".to_string());
        return Err(format!("Player rows insert failed ({}): {}", status, body));
    }

    Ok(())
}

//! Capture the Flag game logic

use crate::state::{FlagState, GameMode, MapFlagLocation, ServerState};

const PICKUP_RADIUS: f32 = 3.0;
const CAPTURE_RADIUS: f32 = 3.0;

fn dist_sq(ax: f32, ay: f32, az: f32, bx: f32, by: f32, bz: f32) -> f32 {
    let dx = ax - bx;
    let dy = ay - by;
    let dz = az - bz;
    dx * dx + dy * dy + dz * dz
}

/// Drop the flag when the carrier dies. Call from apply_damage.
pub fn drop_flag_on_carrier_death(
    state: &mut ServerState,
    victim_id: &str,
    death_x: f32,
    death_y: f32,
    death_z: f32,
) {
    let (lobby_id, flag_team) = {
        let player = match state.players.get(victim_id) {
            Some(p) => p,
            None => return,
        };
        let team = match player.held_flag_team {
            Some(t) => t,
            None => return,
        };
        (player.lobby_id, team)
    };

    if let Some(player) = state.players.get_mut(victim_id) {
        player.held_flag_team = None;
    }

    let key = (lobby_id, flag_team);
    if let Some(flag) = state.flags.get_mut(&key) {
        tracing::info!("[CTF] Flag dropped on carrier death victim={} flag_team={} lobby={}", victim_id, flag_team, lobby_id);
        if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
            let body_id = physics.next_body_id();
            physics.insert_flag_body(body_id, death_x, death_y, death_z);
            flag.state = FlagState::Dropped {
                rigid_body_id: body_id,
                position_x: death_x,
                position_y: death_y,
                position_z: death_z,
            };
        }
    }
}

/// Process CTF logic each tick: pickup, return, capture, win. Returns winner_team if game should end.
pub fn process_ctf_tick(state: &mut ServerState, lobby_id: u64) -> Option<i32> {
    let lobby = state.lobbies.get(&lobby_id)?.clone();
    if lobby.game_mode != GameMode::CaptureTheFlag {
        return None;
    }

    use std::sync::atomic::{AtomicU64, Ordering};
    static CTF_TICK: AtomicU64 = AtomicU64::new(0);
    let t = CTF_TICK.fetch_add(1, Ordering::Relaxed);
    if t % 120 == 0 {
        let flag_count = state.flags.iter().filter(|((lid, _), _)| *lid == lobby_id).count();
        let player_count = state.players.values().filter(|p| p.lobby_id == lobby_id && p.is_alive).count();
        tracing::info!("[CTF] heartbeat lobby={} num_teams={} flag_count={} alive_players={}", lobby_id, lobby.num_teams, flag_count, player_count);
    }

    let flag_locations: Vec<MapFlagLocation> = state
        .flag_locations
        .iter()
        .filter(|f| f.lobby_id == lobby_id)
        .cloned()
        .collect();

    let dropped_positions: std::collections::HashMap<(u64, i32), (f32, f32, f32)> = {
        let physics = state.physics_worlds.get(&lobby_id)?;
        let mut m = std::collections::HashMap::new();
        for ((lid, team), flag) in state.flags.iter().filter(|((lid, _), _)| *lid == lobby_id) {
            if let FlagState::Dropped { rigid_body_id, .. } = &flag.state {
                if let Some((px, py, pz)) = physics.get_position(*rigid_body_id) {
                    m.insert((*lid, *team), (px, py, pz));
                }
            }
        }
        m
    };

    let mut bodies_to_remove = Vec::new();
    let mut flag_updates: std::collections::HashMap<(u64, i32), FlagState> =
        std::collections::HashMap::new();
    let mut player_held_updates: std::collections::HashMap<String, Option<i32>> =
        std::collections::HashMap::new();
    let mut captures: Vec<(String, i32)> = Vec::new();
    let mut winner_team = None;

    let players: Vec<_> = state
        .players
        .values()
        .filter(|p| p.lobby_id == lobby_id && p.is_alive && p.rigid_body_id > 0)
        .cloned()
        .collect();

    for ((_, team), flag) in state.flags.iter().filter(|((lid, _), _)| *lid == lobby_id) {
        let flag_team = *team;
        let key = (lobby_id, flag_team);

        let (flag_x, flag_y, flag_z) = match &flag.state {
            FlagState::AtBase {
                position_x,
                position_y,
                position_z,
            } => (*position_x, *position_y, *position_z),
            FlagState::Carried { .. } => continue,
            FlagState::Dropped {
                rigid_body_id, ..
            } => {
                if let Some(pos) = dropped_positions.get(&key) {
                    *pos
                } else {
                    continue;
                }
            }
        };

        let mut return_flag = false;
        let mut pickup_by: Option<String> = None;

        for player in &players {
            let d2 = dist_sq(
                player.position_x,
                player.position_y,
                player.position_z,
                flag_x,
                flag_y,
                flag_z,
            );
            if d2 < PICKUP_RADIUS * PICKUP_RADIUS && player.team != flag_team {
                tracing::info!("[CTF] Player in range of enemy flag player={} player_team={} flag_team={} d2={}", player.identity, player.team, flag_team, d2);
            }
            if d2 >= PICKUP_RADIUS * PICKUP_RADIUS {
                continue;
            }
            let current_held = player_held_updates
                .get(&player.identity)
                .and_then(|o| *o)
                .or(player.held_flag_team);
            if player.team == flag_team {
                return_flag = true;
                break;
            } else if current_held.is_none() {
                pickup_by = Some(player.identity.clone());
                break;
            }
        }

        if return_flag {
            let base = flag_locations.iter().find(|f| f.team == flag_team);
            if let Some(base) = base {
                tracing::info!("[CTF] Flag returned to base flag_team={} lobby={}", flag_team, lobby_id);
                if let FlagState::Dropped { rigid_body_id, .. } = &flag.state {
                    bodies_to_remove.push(*rigid_body_id);
                }
                flag_updates.insert(
                    key,
                    FlagState::AtBase {
                        position_x: base.position_x,
                        position_y: 0.5,
                        position_z: base.position_z,
                    },
                );
            }
        } else if let Some(carrier_id) = pickup_by {
            tracing::info!("[CTF] Flag picked up carrier={} flag_team={} lobby={}", carrier_id, flag_team, lobby_id);
            if let FlagState::Dropped { rigid_body_id, .. } = &flag.state {
                bodies_to_remove.push(*rigid_body_id);
            }
            flag_updates.insert(
                key,
                FlagState::Carried {
                    carrier_id: carrier_id.clone(),
                },
            );
            player_held_updates.insert(carrier_id, Some(flag_team));
        }
    }

    for player in &players {
        let carried = player_held_updates
            .get(&player.identity)
            .and_then(|o| *o)
            .or(player.held_flag_team);
        let Some(carried_flag_team) = carried else { continue };
        let own_base = flag_locations.iter().find(|f| f.team == player.team);
        let Some(base) = own_base else { continue };
        let d2 = dist_sq(
            player.position_x,
            player.position_y,
            player.position_z,
            base.position_x,
            0.5,
            base.position_z,
        );
        if d2 < CAPTURE_RADIUS * CAPTURE_RADIUS {
            let key = (lobby_id, carried_flag_team);
            if let Some(FlagState::Carried { carrier_id }) = state.flags.get(&key).map(|f| &f.state)
            {
                if carrier_id == &player.identity {
                    if let Some(return_base) = flag_locations.iter().find(|f| f.team == carried_flag_team) {
                        flag_updates.insert(
                            key,
                            FlagState::AtBase {
                                position_x: return_base.position_x,
                                position_y: 0.5,
                                position_z: return_base.position_z,
                            },
                        );
                    }
                    tracing::info!("[CTF] Flag captured carrier={} capturing_team={} captured_flag_team={} lobby={}", player.identity, player.team, carried_flag_team, lobby_id);
                    player_held_updates.insert(player.identity.clone(), None);
                    captures.push((player.identity.clone(), player.team));
                }
            }
        }
    }

    for body_id in bodies_to_remove {
        if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
            physics.remove_body(body_id);
        }
    }
    for (key, new_state) in flag_updates {
        if let Some(flag) = state.flags.get_mut(&key) {
            flag.state = new_state;
        }
    }
    for (player_id, held) in player_held_updates {
        if let Some(p) = state.players.get_mut(&player_id) {
            p.held_flag_team = held;
        }
    }
    for (player_id, team) in captures {
        if let Some(p) = state.players.get_mut(&player_id) {
            p.flag_captures += 1;
        }
        if let Some(lobby) = state.lobbies.get_mut(&lobby_id) {
            *lobby.team_flag_captures.entry(team).or_insert(0) += 1;
            let cap = lobby.team_flag_captures.get(&team).copied().unwrap_or(0);
            if cap >= lobby.flag_limit {
                winner_team = Some(team);
            }
        }
    }

    winner_team
}

//! 60 Hz game loop: step physics, sync player positions, combat, broadcast deltas

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::actions::lobby::{end_round_and_schedule, process_scheduled_round_restarts, ROUND_RESTART_COUNTDOWN_MS};
use crate::combat::{explode_grenade, process_photon_beam_damage, process_projectile_collisions, remove_projectile, try_fire_player};
use crate::registry::Registry;
use crate::state::{GameMode, GameState, ServerState};
use crate::sync;

const TICK_INTERVAL: Duration = Duration::from_micros(1_000_000 / 60);

/// Spawn the game loop task. Runs at 60 Hz, stepping all lobby physics and syncing player positions.
pub fn spawn_game_loop(state: Arc<RwLock<ServerState>>, registry: Registry) {
    tokio::spawn(async move {
        let mut next_tick = Instant::now();
        let mut tick: u64 = 0;
        loop {
            next_tick += TICK_INTERVAL;
            tokio::time::sleep_until(next_tick.into()).await;

            let mut state = match state.try_write() {
                Ok(s) => s,
                Err(_) => continue,
            };

            let mut all_collisions: Vec<(u64, Vec<(u64, u64)>)> = Vec::new();
            for (lobby_id, physics) in state.physics_worlds.iter_mut() {
                let collisions = physics.step();
                all_collisions.push((*lobby_id, collisions));
            }

            let mut all_shot_events: Vec<(u64, crate::protocol::ShotEventPayload)> = Vec::new();
            let mut all_kill_events: Vec<crate::protocol::KillEventPayload> = Vec::new();

            for (lobby_id, collisions) in all_collisions {
                let (to_remove, kill_events) = process_projectile_collisions(&mut state, &collisions);
                all_kill_events.extend(kill_events);
                for body_id in to_remove {
                    remove_projectile(&mut state, body_id, lobby_id);
                }
            }

            let now_micros = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_micros() as u64)
                .unwrap_or(0);
            let expired: Vec<_> = state
                .projectiles
                .iter()
                .filter(|(_, proj)| proj.expires_at_micros > 0 && now_micros >= proj.expires_at_micros)
                .map(|(id, _)| *id)
                .collect();
            for body_id in expired {
                if let Some(proj) = state.projectiles.get(&body_id) {
                    let lobby_id = proj.lobby_id;
                    remove_projectile(&mut state, body_id, lobby_id);
                }
            }

            // Grenade fuse expiration
            let grenades_to_explode: Vec<_> = state
                .grenades
                .iter()
                .filter(|(_, g)| g.expires_at_micros > 0 && now_micros >= g.expires_at_micros)
                .map(|(id, g)| (*id, g.clone()))
                .collect();
            for (body_id, grenade) in grenades_to_explode {
                if let Some((px, py, pz)) = state
                    .physics_worlds
                    .get(&grenade.lobby_id)
                    .and_then(|p| p.get_position(body_id))
                {
                    all_kill_events.extend(explode_grenade(
                        &mut state,
                        body_id,
                        grenade.lobby_id,
                        px, py, pz,
                        grenade.damage,
                        grenade.radius,
                        &grenade.owner_id,
                    ));
                }
            }

            all_kill_events.extend(process_photon_beam_damage(&mut state));
            for (_, beam) in state.photon_beams.iter_mut() {
                beam.remaining_ticks -= 1;
            }
            let beams_to_remove: Vec<u64> = state
                .photon_beams
                .iter()
                .filter(|(_, b)| b.remaining_ticks <= 0)
                .map(|(id, _)| *id)
                .collect();
            for id in beams_to_remove {
                state.photon_beams.remove(&id);
            }

            let mut game_ended_messages = Vec::new();
            let lobby_ids = state.lobbies.keys().copied().collect::<Vec<_>>();
            for lobby_id in lobby_ids {
                let Some(lobby) = state.lobbies.get(&lobby_id).cloned() else {
                    continue;
                };
                if lobby.game_state == GameState::Ended {
                    continue;
                }
                let winner_hint = if lobby.game_mode == GameMode::FreeForAll {
                    state
                        .players
                        .values()
                        .filter(|p| p.lobby_id == lobby_id)
                        .max_by(|a, b| a.kills.cmp(&b.kills).then(b.deaths.cmp(&a.deaths)))
                        .and_then(|p| {
                            if p.kills >= lobby.score_limit {
                                Some((None, Some(p.identity.clone()), Some(p.name.clone())))
                            } else {
                                None
                            }
                        })
                } else {
                    let mut team_kills = std::collections::HashMap::<i32, i32>::new();
                    for p in state.players.values().filter(|p| p.lobby_id == lobby_id) {
                        *team_kills.entry(p.team).or_insert(0) += p.kills;
                    }
                    let winner_team = team_kills
                        .iter()
                        .find(|(_, kills)| **kills >= lobby.score_limit)
                        .map(|(team, _)| *team);
                    winner_team.map(|team| {
                        let winner_player = state
                            .players
                            .values()
                            .filter(|p| p.lobby_id == lobby_id && p.team == team)
                            .max_by(|a, b| a.kills.cmp(&b.kills).then(b.deaths.cmp(&a.deaths)));
                        (
                            Some(team),
                            winner_player.map(|p| p.identity.clone()),
                            winner_player.map(|p| p.name.clone()),
                        )
                    })
                };
                if let Some(hint) = winner_hint {
                    if let Some(msg) = end_round_and_schedule(
                        &mut state,
                        lobby_id,
                        Some(hint),
                        ROUND_RESTART_COUNTDOWN_MS,
                    ) {
                        game_ended_messages.push((lobby_id, msg));
                    }
                }
            }

            for identity in state.players.keys().cloned().collect::<Vec<_>>() {
                if let Some(player) = state.players.get(&identity) {
                    if let Some(lobby) = state.lobbies.get(&player.lobby_id) {
                        if lobby.game_state == GameState::Ended {
                            continue;
                        }
                    }
                    let lobby_id = player.lobby_id;
                    if let Some(ev) = try_fire_player(&mut state, lobby_id, &identity, tick) {
                        all_shot_events.push((lobby_id, ev));
                    }
                }
            }

            let mut updates: Vec<(String, f32, f32, f32, f32, f32, f32)> = Vec::new();
            for (identity, player) in state.players.iter() {
                if !player.is_alive || player.rigid_body_id == 0 {
                    continue;
                }
                if let Some(physics) = state.physics_worlds.get(&player.lobby_id) {
                    if let (Some((px, py, pz)), Some((vx, vy, vz))) = (
                        physics.get_position(player.rigid_body_id),
                        physics.get_linvel(player.rigid_body_id),
                    ) {
                        updates.push((identity.clone(), px, py, pz, vx, vy, vz));
                    }
                }
            }

            for (identity, px, py, pz, vx, vy, vz) in updates {
                if let Some(player) = state.players.get_mut(&identity) {
                    player.position_x = px;
                    player.position_y = py;
                    player.position_z = pz;
                    player.velocity_x = vx;
                    player.velocity_y = vy;
                    player.velocity_z = vz;
                    player.server_snapshot_id = tick;
                }
            }

            tick += 1;

            let mut all_grenade_inserts_to_mark = Vec::new();

            for (lobby_id, _lobby) in state.lobbies.iter() {
                let players: Vec<_> = state
                    .players
                    .values()
                    .filter(|p| p.lobby_id == *lobby_id)
                    .cloned()
                    .collect();
                if !players.is_empty() {
                    let shot_events: Vec<_> = all_shot_events
                        .iter()
                        .filter(|(lid, _)| *lid == *lobby_id)
                        .map(|(_, e)| e.clone())
                        .collect();
                    let lobby_id_ref = *lobby_id;
                    let kill_events: Vec<_> = all_kill_events
                        .iter()
                        .filter(|k| {
                            state
                                .players
                                .get(&k.victim_id)
                                .map(|p| p.lobby_id == lobby_id_ref)
                                .unwrap_or(false)
                        })
                        .cloned()
                        .collect();
                    let photon_beams: Vec<_> = state
                        .photon_beams
                        .values()
                        .filter(|b| b.lobby_id == lobby_id_ref)
                        .map(sync::photon_beam_to_payload)
                        .collect();

                    let mut grenade_inserts = Vec::new();
                    let mut grenade_updates = Vec::new();
                    let grenade_deletes: Vec<_> = state
                        .grenade_deletes_this_tick
                        .iter()
                        .filter(|(_, lid)| *lid == lobby_id_ref)
                        .map(|(bid, _)| crate::protocol::GrenadeDeletePayload {
                            rigid_body_id: *bid,
                        })
                        .collect();

                    for (body_id, g) in state.grenades.iter() {
                        if g.lobby_id != lobby_id_ref {
                            continue;
                        }
                        let physics = match state.physics_worlds.get(&lobby_id_ref) {
                            Some(p) => p,
                            None => continue,
                        };
                        let (pos, vel) = match (
                            physics.get_position(*body_id),
                            physics.get_linvel(*body_id),
                        ) {
                            (Some(p), Some(v)) => (p, v),
                            _ => continue,
                        };

                        if !state.grenade_inserts_sent.contains(body_id) {
                            let owner_color = state
                                .players
                                .get(&g.owner_id)
                                .map(|p| [p.color_r, p.color_g, p.color_b])
                                .unwrap_or([0.5, 0.5, 0.5]);
                            grenade_inserts.push(sync::grenade_to_insert_payload(
                                g, pos, vel, owner_color,
                            ));
                            all_grenade_inserts_to_mark.push(*body_id);
                        } else {
                            grenade_updates.push(sync::grenade_to_update_payload(*body_id, pos, vel));
                        }
                    }

                    let delta = sync::build_delta(
                        tick,
                        &players,
                        &shot_events,
                        &grenade_inserts,
                        &grenade_deletes,
                        &grenade_updates,
                        &kill_events,
                        &photon_beams,
                    );
                    if let Ok(json) = serde_json::to_string(&delta) {
                        registry.read().await.broadcast_to_lobby(*lobby_id, &json);
                    }
                }
            }

            for (lobby_id, msg) in game_ended_messages {
                if let Ok(json) = serde_json::to_string(&msg) {
                    registry.read().await.broadcast_to_lobby(lobby_id, &json);
                }
            }

            let restarted_lobbies = process_scheduled_round_restarts(&mut state);
            for lobby_id in restarted_lobbies {
                if let Some(lobby) = state.lobbies.get(&lobby_id) {
                    let players: Vec<_> = state
                        .players
                        .values()
                        .filter(|p| p.lobby_id == lobby_id)
                        .cloned()
                        .collect();
                    let lobby_state = sync::build_lobby_state(lobby, &players);
                    if let Ok(json) = serde_json::to_string(&lobby_state) {
                        registry.read().await.broadcast_to_lobby(lobby_id, &json);
                    }
                }
            }

            for bid in all_grenade_inserts_to_mark {
                state.grenade_inserts_sent.insert(bid);
            }
            state.grenade_deletes_this_tick.clear();
        }
    });
}

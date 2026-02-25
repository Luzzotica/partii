//! Game loop phases. Each phase is a focused unit of work; add new features by extending phases.

use std::time::{SystemTime, UNIX_EPOCH};

use crate::actions::lobby::{end_round_and_schedule, process_scheduled_round_restarts, ROUND_RESTART_COUNTDOWN_MS};
use crate::sync;
use crate::combat::{
    apply_damage, apply_damage_in_radius, explode_grenade, process_photon_beam_damage,
    process_projectile_collisions, remove_projectile, try_fire_player,
};
use crate::constants::{
    DASH_IMPULSE, DASH_COOLDOWN_MICROS, FALL_DEATH_Y_THRESHOLD, PHYSICS_TICK_DT, PLAYER_ACCEL,
    PLAYER_DAMPING, POPUP_HAMMERS_COOLDOWN_MICROS, POPUP_HAMMERS_DAMAGE, POPUP_HAMMERS_RADIUS,
};
use crate::ctf;
use crate::protocol::{KillEventPayload, SecondaryEffectPayload, ShotEventPayload};
use crate::registry::Registry;
use crate::state::{GameMode, GameState, SecondaryType, ServerState};

fn now_micros() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0)
}

/// Process pending secondary actions (PopupHammers, Dash). Returns kill events.
pub fn process_secondary_actions(state: &mut ServerState) -> Vec<KillEventPayload> {
    let now = now_micros() as i64;
    let pending = std::mem::take(&mut state.pending_secondary_actions);
    let mut kill_events = Vec::new();
    for (identity, secondary_type) in pending {
        let Some(player) = state.players.get(&identity) else {
            continue;
        };
        if !player.is_alive || player.rigid_body_id == 0 {
            continue;
        }
        let lobby_id = player.lobby_id;
        let (px, py, pz) = (player.position_x, player.position_y, player.position_z);
        let (dx, dz) = (player.input_x, player.input_z);

        match secondary_type {
            SecondaryType::PopupHammers => {
                let mut ks = apply_damage_in_radius(
                    state,
                    lobby_id,
                    px,
                    py,
                    pz,
                    POPUP_HAMMERS_DAMAGE,
                    POPUP_HAMMERS_RADIUS,
                    &identity,
                    "hammers",
                );
                kill_events.append(&mut ks);
                if let Some(p) = state.players.get_mut(&identity) {
                    p.secondary_forced_cooldown_until_micros = now + POPUP_HAMMERS_COOLDOWN_MICROS;
                    p.last_secondary_used_at = now;
                }
                state.secondary_effect_events_this_tick.push((
                    lobby_id,
                    SecondaryEffectPayload {
                        player_id: identity.clone(),
                        secondary_type: SecondaryType::PopupHammers,
                        position: [px, py, pz],
                        direction: [0.0, 0.0],
                    },
                ));
            }
            SecondaryType::Dash => {
                let (ax, az) = {
                    let len_sq = dx * dx + dz * dz;
                    if len_sq < 0.0001 {
                        (0.0, -1.0)
                    } else {
                        let len = len_sq.sqrt();
                        (dx / len, dz / len)
                    }
                };
                if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
                    physics.apply_impulse(
                        state.players.get(&identity).unwrap().rigid_body_id,
                        ax * DASH_IMPULSE,
                        0.0,
                        az * DASH_IMPULSE,
                    );
                }
                if let Some(p) = state.players.get_mut(&identity) {
                    p.secondary_forced_cooldown_until_micros = now + DASH_COOLDOWN_MICROS;
                    p.last_secondary_used_at = now;
                }
                state.secondary_effect_events_this_tick.push((
                    lobby_id,
                    SecondaryEffectPayload {
                        player_id: identity.clone(),
                        secondary_type: SecondaryType::Dash,
                        position: [px, py, pz],
                        direction: [ax, az],
                    },
                ));
            }
            _ => {}
        }
    }
    kill_events
}

/// Apply player input to velocity.
pub fn apply_input(state: &mut ServerState) {
    let to_apply: Vec<_> = state
        .players
        .values()
        .filter(|p| p.is_alive && p.rigid_body_id > 0)
        .map(|p| (p.lobby_id, p.rigid_body_id, p.input_x, p.input_z))
        .collect();
    for (lobby_id, body_id, ix, iz) in to_apply {
        if let Some(physics) = state.physics_worlds.get_mut(&lobby_id) {
            if let Some((vx, vy, vz)) = physics.get_linvel(body_id) {
                let mut vx = vx + ix * PLAYER_ACCEL * PHYSICS_TICK_DT;
                let mut vz = vz + iz * PLAYER_ACCEL * PHYSICS_TICK_DT;
                vx *= PLAYER_DAMPING;
                vz *= PLAYER_DAMPING;
                physics.set_linvel(body_id, vx, vy, vz);
            }
        }
    }
}

/// Step physics and return collisions per lobby.
pub fn physics_step(
    state: &mut ServerState,
) -> Vec<(u64, Vec<(u64, u64)>)> {
    let mut all_collisions = Vec::new();
    for (lobby_id, physics) in state.physics_worlds.iter_mut() {
        let collisions = physics.step();
        all_collisions.push((*lobby_id, collisions));
    }
    all_collisions
}

/// Process projectile collisions, launcher impulses, projectile expiry, grenade fuse, photon beams.
pub fn process_collisions(
    state: &mut ServerState,
    all_collisions: &[(u64, Vec<(u64, u64)>)],
) -> Vec<KillEventPayload> {
    let mut all_kill_events: Vec<KillEventPayload> = Vec::new();

    for (lobby_id, collisions) in all_collisions {
        let (to_remove, kill_events) = process_projectile_collisions(state, collisions);
        all_kill_events.extend(kill_events);
        for body_id in to_remove {
            remove_projectile(state, body_id, *lobby_id);
        }
        let launcher_impulses = state
            .physics_worlds
            .get(lobby_id)
            .map(|p| p.launcher_impulses.clone())
            .unwrap_or_default();
        let to_apply: Vec<_> = collisions
            .iter()
            .filter_map(|(sensor_id, other_id)| {
                launcher_impulses.get(sensor_id).and_then(|&(force, dx, dy, dz)| {
                    let is_player = state.players.values().any(|p| {
                        p.lobby_id == *lobby_id && p.rigid_body_id == *other_id && p.is_alive
                    });
                    if is_player {
                        Some((*other_id, dx * force, dy * force, dz * force))
                    } else {
                        None
                    }
                })
            })
            .collect();
        if let Some(physics) = state.physics_worlds.get_mut(lobby_id) {
            for (other_id, ix, iy, iz) in to_apply {
                physics.apply_impulse(other_id, ix, iy, iz);
            }
        }
    }

    let now = now_micros();
    let expired: Vec<_> = state
        .projectiles
        .iter()
        .filter(|(_, proj)| proj.expires_at_micros > 0 && now >= proj.expires_at_micros)
        .map(|(id, _)| *id)
        .collect();
    for body_id in expired {
        if let Some(proj) = state.projectiles.get(&body_id) {
            let lobby_id = proj.lobby_id;
            remove_projectile(state, body_id, lobby_id);
        }
    }

    let grenades_to_explode: Vec<_> = state
        .grenades
        .iter()
        .filter(|(_, g)| g.expires_at_micros > 0 && now >= g.expires_at_micros)
        .map(|(id, g)| (*id, g.clone()))
        .collect();
    for (body_id, grenade) in grenades_to_explode {
        if let Some((px, py, pz)) = state
            .physics_worlds
            .get(&grenade.lobby_id)
            .and_then(|p| p.get_position(body_id))
        {
            all_kill_events.extend(explode_grenade(
                state,
                body_id,
                grenade.lobby_id,
                px, py, pz,
                grenade.damage,
                grenade.radius,
                &grenade.owner_id,
            ));
        }
    }

    all_kill_events.extend(process_photon_beam_damage(state));
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

    all_kill_events
}

/// Combat phase: try to fire each shooting player.
pub fn combat_phase(
    state: &mut ServerState,
    tick: u64,
) -> Vec<(u64, ShotEventPayload)> {
    let mut all_shot_events = Vec::new();
    for identity in state.players.keys().cloned().collect::<Vec<_>>() {
        if let Some(player) = state.players.get(&identity) {
            if let Some(lobby) = state.lobbies.get(&player.lobby_id) {
                if lobby.game_state == GameState::Ended {
                    continue;
                }
            }
            let lobby_id = player.lobby_id;
            for ev in try_fire_player(state, lobby_id, &identity, tick) {
                all_shot_events.push((lobby_id, ev));
            }
        }
    }
    all_shot_events
}

/// Sync player positions/velocities from physics.
pub fn sync_positions(state: &mut ServerState) {
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
        }
    }
}

/// Apply fall death to players below threshold.
pub fn fall_death(state: &mut ServerState, all_kill_events: &mut Vec<KillEventPayload>) {
    let fall_death_victims: Vec<_> = state
        .players
        .iter()
        .filter(|(_, p)| p.is_alive && p.position_y < FALL_DEATH_Y_THRESHOLD)
        .map(|(id, _)| id.clone())
        .collect();
    for identity in &fall_death_victims {
        if let Some(ke) = apply_damage(state, identity, crate::constants::MAX_HEALTH, identity, "fall") {
            all_kill_events.push(ke);
        }
    }
}

/// Check FFA/TDM win conditions.
pub fn check_win_conditions(state: &mut ServerState) -> Vec<(u64, Vec<u8>)> {
    let mut game_ended_messages = Vec::new();
    let lobby_ids: Vec<_> = state.lobbies.keys().copied().collect();
    for lobby_id in lobby_ids {
        let Some(lobby) = state.lobbies.get(&lobby_id).cloned() else {
            continue;
        };
        if lobby.game_state == GameState::Ended {
            continue;
        }
        let winner_hint = if lobby.game_mode == GameMode::CaptureTheFlag {
            None
        } else if lobby.game_mode == GameMode::FreeForAll {
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
                .map(|(_, team)| *team);
            winner_team.and_then(|team| {
                let winner_player = state
                    .players
                    .values()
                    .filter(|p| p.lobby_id == lobby_id && p.team == team)
                    .max_by(|a, b| a.kills.cmp(&b.kills).then(b.deaths.cmp(&a.deaths)));
                Some((
                    Some(team),
                    winner_player.map(|p| p.identity.clone()),
                    winner_player.map(|p| p.name.clone()),
                ))
            })
        };
        if let Some(hint) = winner_hint {
            if let Some(msg) =
                end_round_and_schedule(&mut *state, lobby_id, Some(hint), ROUND_RESTART_COUNTDOWN_MS)
            {
                game_ended_messages.push((lobby_id, msg));
            }
        }
    }
    game_ended_messages
}

/// Check CTF win condition.
pub fn check_ctf_win(
    state: &mut ServerState,
    game_ended_messages: &mut Vec<(u64, Vec<u8>)>,
) {
    for lobby_id in state.lobbies.keys().copied().collect::<Vec<_>>() {
        if let Some(lobby) = state.lobbies.get(&lobby_id) {
            if lobby.game_state != GameState::InProgress
                || lobby.game_mode != GameMode::CaptureTheFlag
            {
                continue;
            }
        }
        if let Some(winner_team) = ctf::process_ctf_tick(state, lobby_id) {
            let winner_player = state
                .players
                .values()
                .filter(|p| p.lobby_id == lobby_id && p.team == winner_team)
                .max_by(|a, b| a.flag_captures.cmp(&b.flag_captures));
            let hint = (
                Some(winner_team),
                winner_player.map(|p| p.identity.clone()),
                winner_player.map(|p| p.name.clone()),
            );
            if let Some(msg) =
                end_round_and_schedule(&mut *state, lobby_id, Some(hint), ROUND_RESTART_COUNTDOWN_MS)
            {
                game_ended_messages.push((lobby_id, msg));
            }
        }
    }
}

/// Build deltas, broadcast, handle round restarts.
pub async fn sync_broadcast(
    state: &mut ServerState,
    registry: &Registry,
    tick: u64,
    all_shot_events: &[(u64, ShotEventPayload)],
    all_kill_events: &[KillEventPayload],
    game_ended_messages: &[(u64, Vec<u8>)],
) {
    let mut all_grenade_inserts_to_mark = Vec::new();

    for lobby_id in state.lobbies.keys().copied().collect::<Vec<_>>() {
        let mut players: Vec<_> = state
            .players
            .values()
            .filter(|p| p.lobby_id == lobby_id)
            .cloned()
            .collect();
        if players.is_empty() {
            continue;
        }
        let (delta_id, base_snapshot_id) = if let Some(lobby) = state.lobbies.get_mut(&lobby_id) {
            (lobby.allocate_delta_id(), lobby.current_snapshot_id)
        } else {
            continue;
        };
        for p in &mut players {
            p.server_snapshot_id = base_snapshot_id;
        }
        let shot_events: Vec<_> = all_shot_events
            .iter()
            .filter(|(lid, _)| *lid == lobby_id)
            .map(|(_, e)| e.clone())
            .collect();
        let kill_events: Vec<_> = all_kill_events
            .iter()
            .filter(|k| {
                state
                    .players
                    .get(&k.victim_id)
                    .map(|p| p.lobby_id == lobby_id)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        let photon_beams: Vec<_> = state
            .photon_beams
            .values()
            .filter(|b| b.lobby_id == lobby_id)
            .map(sync::photon_beam_to_proto)
            .collect();

        let mut grenade_inserts = Vec::new();
        let mut grenade_updates = Vec::new();
        let grenade_deletes: Vec<_> = state
            .grenade_deletes_this_tick
            .iter()
            .filter(|(_, lid)| *lid == lobby_id)
            .map(|(bid, _)| crate::pb::gyrii::GrenadeDelete {
                rigid_body_id: *bid,
            })
            .collect();

        for (body_id, g) in state.grenades.iter() {
            if g.lobby_id != lobby_id {
                continue;
            }
            let physics = match state.physics_worlds.get(&lobby_id) {
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
                grenade_inserts.push(sync::grenade_to_insert_proto(g, pos, vel, owner_color));
                all_grenade_inserts_to_mark.push(*body_id);
            } else {
                grenade_updates.push(sync::grenade_to_update_proto(*body_id, pos, vel));
            }
        }

        let flags: Vec<_> = state
            .flags
            .values()
            .filter(|f| f.lobby_id == lobby_id)
            .cloned()
            .collect();
        let secondary_effect_events: Vec<_> = state
            .secondary_effect_events_this_tick
            .iter()
            .filter(|(lid, _)| *lid == lobby_id)
            .map(|(_, payload)| payload.clone())
            .collect();
        let delta = sync::build_delta(
            tick,
            delta_id,
            base_snapshot_id,
            &players,
            &shot_events,
            &grenade_inserts,
            &grenade_deletes,
            &grenade_updates,
            &kill_events,
            &photon_beams,
            &flags,
            &secondary_effect_events,
        );
        registry.read().await.broadcast_to_lobby(lobby_id, &delta);
    }

    for (lobby_id, msg) in game_ended_messages {
        registry.read().await.broadcast_to_lobby(*lobby_id, msg);
    }

    let restarted_lobbies = process_scheduled_round_restarts(state);
    for lobby_id in restarted_lobbies {
        if let Some(lobby) = state.lobbies.get_mut(&lobby_id) {
            let snapshot_id = lobby.allocate_snapshot_id();
            let last_delta_id = lobby.current_delta_id;
            let lobby_payload = lobby.clone();
            let players: Vec<_> = state
                .players
                .values()
                .filter(|p| p.lobby_id == lobby_id)
                .cloned()
                .collect();
            let flags: Vec<_> = state
                .flags
                .values()
                .filter(|f| f.lobby_id == lobby_id)
                .cloned()
                .collect();
            let lobby_state = sync::build_lobby_state(
                &lobby_payload,
                &players,
                &flags,
                snapshot_id,
                last_delta_id,
            );
            registry.read().await.broadcast_to_lobby(lobby_id, &lobby_state);
        }
    }

    for bid in all_grenade_inserts_to_mark {
        state.grenade_inserts_sent.insert(bid);
    }
    state.grenade_deletes_this_tick.clear();
    state.secondary_effect_events_this_tick.clear();
}

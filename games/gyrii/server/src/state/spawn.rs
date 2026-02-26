//! Spawn position helpers

use crate::state::{MapSpawnPoint, Vec3};

pub fn get_spawn_points(spawn_points: &[MapSpawnPoint], lobby_id: u64) -> Vec<Vec3> {
    spawn_points
        .iter()
        .filter(|s| s.lobby_id == lobby_id)
        .map(|s| Vec3::new(s.position_x, 0.5, s.position_z))
        .collect()
}

fn dist_sq(a: Vec3, b: Vec3) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    let dz = a.z - b.z;
    dx * dx + dy * dy + dz * dz
}

/// CTF spawn preference: when no enemies, spawn near own flag; else near allies, then away from enemies.
#[derive(Clone, Copy)]
pub struct CtfSpawnParams {
    pub own_flag_pos: Vec3,
}

/// Picks the best spawn: furthest from enemies, and in team modes closest to allies.
/// For CTF: when no enemies exist, prioritizes spawns nearest to own flag.
pub fn get_best_spawn_position(
    spawn_points: &[MapSpawnPoint],
    lobby_id: u64,
    spawner_team: i32,
    is_team_mode: bool,
    existing: &[(Vec3, i32)],
    ctf_params: Option<CtfSpawnParams>,
) -> Vec3 {
    let spawns = get_spawn_points(spawn_points, lobby_id);
    if spawns.is_empty() {
        return Vec3::new(0.0, 0.5, 0.0);
    }

    let enemies: Vec<Vec3> = existing
        .iter()
        .filter(|(_, t)| !is_team_mode || *t != spawner_team)
        .map(|(pos, _)| *pos)
        .collect();

    // CTF: no enemies on map -> spawn as close to own flag as possible
    if let Some(ctf) = ctf_params {
        if enemies.is_empty() {
            let flag = ctf.own_flag_pos;
            let best_idx = spawns
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| {
                    dist_sq(**a, flag)
                        .partial_cmp(&dist_sq(**b, flag))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|(i, _)| i)
                .unwrap_or(0);
            return spawns[best_idx];
        }
    }

    let mut best_idx = 0usize;
    let mut best_score = f32::NEG_INFINITY;

    for (idx, spawn) in spawns.iter().enumerate() {
        let min_dist_enemy_sq = enemies
            .iter()
            .map(|pos| dist_sq(*spawn, *pos))
            .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap_or(f32::INFINITY);

        let min_dist_ally_sq = if is_team_mode {
            existing
                .iter()
                .filter(|(_, t)| *t == spawner_team)
                .map(|(pos, _)| dist_sq(*spawn, *pos))
                .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                .unwrap_or(f32::INFINITY)
        } else {
            f32::INFINITY
        };

        let min_dist_enemy = min_dist_enemy_sq.sqrt();
        let min_dist_ally = min_dist_ally_sq.sqrt();
        // Near allies bonus (stronger), then distance from enemies
        let ally_bonus = if is_team_mode && min_dist_ally < f32::INFINITY {
            -0.3 * min_dist_ally
        } else {
            0.0
        };
        let score = min_dist_enemy + ally_bonus;

        if score > best_score {
            best_score = score;
            best_idx = idx;
        }
    }

    spawns[best_idx]
}

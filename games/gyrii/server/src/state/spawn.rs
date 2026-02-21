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

/// Picks the best spawn: furthest from enemies, and in team modes closest to allies.
pub fn get_best_spawn_position(
    spawn_points: &[MapSpawnPoint],
    lobby_id: u64,
    spawner_team: i32,
    is_team_mode: bool,
    existing: &[(Vec3, i32)],
) -> Vec3 {
    let spawns = get_spawn_points(spawn_points, lobby_id);
    if spawns.is_empty() {
        return Vec3::new(0.0, 0.5, 0.0);
    }

    let mut best_idx = 0usize;
    let mut best_score = f32::NEG_INFINITY;

    for (idx, spawn) in spawns.iter().enumerate() {
        let min_dist_enemy_sq = existing
            .iter()
            .filter(|(_, t)| !is_team_mode || *t != spawner_team)
            .map(|(pos, _)| dist_sq(*spawn, *pos))
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
        let ally_bonus = if is_team_mode && min_dist_ally < f32::INFINITY {
            -0.15 * min_dist_ally
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

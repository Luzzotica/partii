// Map definitions: walls from parsed JSON, spawn/flag from DB tables

use spacetimedb::{table, ReducerContext, SpacetimeType, Table};
use spacetime_rapier::{Collider, RigidBody, RigidBodyProperties, RigidBodyType, Vec3};

use crate::collision_groups::{GROUP_BULLET, GROUP_FLOOR, GROUP_GRENADE, GROUP_PLAYER, GROUP_WALL};

use crate::map_parser::{grid_to_world_x, grid_to_world_z, ParsedMap};

pub use map_flag_location::map_flag_location;
pub use map_spawn_point::map_spawn_point;
pub use map_wall::map_wall;

// ============================================================================
// MAP TYPES
// ============================================================================

#[derive(Clone, Copy, PartialEq, Eq, Debug, SpacetimeType)]
pub enum MapId {
    Arena,
    Maze,
    Warehouse,
}

// ============================================================================
// MAP WALL TABLE
// ============================================================================

#[table(name = map_wall, public)]
#[derive(Clone)]
pub struct MapWall {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub lobby_id: u64,
    pub rigid_body_id: u64,
    pub position_x: f32,
    pub position_y: f32,
    pub position_z: f32,
    pub size_x: f32,
    pub size_y: f32,
    pub size_z: f32,
    pub height: i32, // 1 = grenades can arc over, 2 = blocks grenades
}

// ============================================================================
// MAP SPAWN POINTS (parsed once per lobby)
// ============================================================================

#[table(name = map_spawn_point, public)]
#[derive(Clone)]
pub struct MapSpawnPoint {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub lobby_id: u64,
    pub position_x: f32,
    pub position_z: f32,
    pub team: i32, // -1 or sentinel for FFA "any"
}

// ============================================================================
// MAP FLAG LOCATIONS (CTF, parsed once per lobby)
// ============================================================================

#[table(name = map_flag_location, public)]
#[derive(Clone)]
pub struct MapFlagLocation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub lobby_id: u64,
    pub position_x: f32,
    pub position_z: f32,
    pub team: i32,
}

// ============================================================================
// MAP GENERATION (from parsed JSON)
// ============================================================================

pub fn create_map_geometry(
    ctx: &ReducerContext,
    lobby_id: u64,
    world_id: u64,
    parsed: &ParsedMap,
) {
    create_floor(ctx, world_id, parsed);

    let boundary_height = 2;

    // Boundary walls: one 1×1×2 cuboid per grid cell along each edge (grid-aligned)
    for gx in 0..parsed.width {
        let world_x = grid_to_world_x(gx, parsed.width);
        let world_z_north = grid_to_world_z(0, parsed.height);
        create_wall(
            ctx,
            lobby_id,
            world_id,
            Vec3::new(world_x, 1.0, world_z_north),
            Vec3::new(1.0, 2.0, 1.0),
            boundary_height,
        );
        let world_z_south = grid_to_world_z(parsed.height - 1, parsed.height);
        create_wall(
            ctx,
            lobby_id,
            world_id,
            Vec3::new(world_x, 1.0, world_z_south),
            Vec3::new(1.0, 2.0, 1.0),
            boundary_height,
        );
    }
    for gy in 0..parsed.height {
        let world_x_west = grid_to_world_x(0, parsed.width);
        let world_z = grid_to_world_z(gy, parsed.height);
        create_wall(
            ctx,
            lobby_id,
            world_id,
            Vec3::new(world_x_west, 1.0, world_z),
            Vec3::new(1.0, 2.0, 1.0),
            boundary_height,
        );
        let world_x_east = grid_to_world_x(parsed.width - 1, parsed.width);
        create_wall(
            ctx,
            lobby_id,
            world_id,
            Vec3::new(world_x_east, 1.0, world_z),
            Vec3::new(1.0, 2.0, 1.0),
            boundary_height,
        );
    }

    // Interior walls (grid cells: 1x1 in world)
    for w in &parsed.walls {
        let world_x = grid_to_world_x(w.x, parsed.width);
        let world_z = grid_to_world_z(w.y, parsed.height);
        let wall_height = if w.height == 2 { 2.0 } else { 1.0 };
        let center_y = wall_height / 2.0;
        create_wall(
            ctx,
            lobby_id,
            world_id,
            Vec3::new(world_x, center_y, world_z),
            Vec3::new(1.0, wall_height, 1.0),
            w.height,
        );
    }
}

/// Floor: either one half-space (entire floor solid) or a grid of box colliders (holes where floorGrid is 0).
fn create_floor(ctx: &ReducerContext, world_id: u64, parsed: &ParsedMap) {
    let rb_props = RigidBodyProperties::builder()
        .world_id(world_id)
        .mass(0.0)
        .restitution(0.3)
        .build()
        .insert(ctx);

    match &parsed.floor_grid {
        None => {
            // No grid: one half-space at y=0 (legacy behavior)
            let mut collider = Collider::halfspace(world_id, 0.0, 1.0, 0.0);
            collider.collision_memberships = GROUP_FLOOR;
            collider.collision_filter = GROUP_PLAYER | GROUP_BULLET | GROUP_GRENADE;
            let collider = collider.insert(ctx);
            let _rb = RigidBody::builder()
                .world_id(world_id)
                .position_x(0.0)
                .position_y(0.0)
                .position_z(0.0)
                .collider_id(collider.id)
                .properties_id(rb_props.id)
                .body_type(RigidBodyType::Static)
                .build()
                .insert(ctx);
        }
        Some(grid) => {
            // Grid: merge contiguous solid cells per row into horizontal runs; one thin cuboid per run
            const FLOOR_HALF_Y: f32 = 0.05;
            let height = grid.len() as u32;
            let width = grid.first().map(|r| r.len() as u32).unwrap_or(0);
            for (gy, row) in grid.iter().enumerate() {
                let gyu = gy as u32;
                if gyu >= height {
                    continue;
                }
                let world_z = grid_to_world_z(gyu, parsed.height);
                let mut gx: usize = 0;
                while gx < row.len() && (gx as u32) < width {
                    if row[gx] == 0 {
                        gx += 1;
                        continue;
                    }
                    let gx_start = gx;
                    while gx < row.len() && (gx as u32) < width && row[gx] == 1 {
                        gx += 1;
                    }
                    let run_len = (gx - gx_start) as u32;
                    if run_len == 0 {
                        continue;
                    }
                    let gx_center = gx_start as u32 + (run_len - 1) / 2;
                    let world_x = grid_to_world_x(gx_center, parsed.width);
                    let half_x = (run_len as f32) / 2.0;
                    let half_extents = Vec3::new(half_x, FLOOR_HALF_Y, 0.5);
                    let mut collider = Collider::cuboid(world_id, half_extents);
                    collider.collision_memberships = GROUP_FLOOR;
                    collider.collision_filter = GROUP_PLAYER | GROUP_BULLET | GROUP_GRENADE;
                    let collider = collider.insert(ctx);
                    let _rb = RigidBody::builder()
                        .world_id(world_id)
                        .position_x(world_x)
                        .position_y(-FLOOR_HALF_Y)
                        .position_z(world_z)
                        .collider_id(collider.id)
                        .properties_id(rb_props.id)
                        .body_type(RigidBodyType::Static)
                        .build()
                        .insert(ctx);
                }
            }
        }
    }
}

fn create_wall(
    ctx: &ReducerContext,
    lobby_id: u64,
    world_id: u64,
    pos: Vec3,
    size: Vec3,
    height: i32,
) {
    // Create static rigid body properties
    let rb_props = RigidBodyProperties::builder()
        .world_id(world_id)
        .mass(0.0) // Static objects have 0 mass
        .restitution(0.3)
        .build()
        .insert(ctx);
    
    // Create cuboid collider (size is half-extents)
    let half_extents = Vec3::new(size.x / 2.0, size.y / 2.0, size.z / 2.0);
    let mut collider = Collider::cuboid(world_id, half_extents);
    collider.collision_memberships = GROUP_WALL;
    collider.collision_filter = GROUP_PLAYER | GROUP_BULLET | GROUP_GRENADE;
    let collider = collider.insert(ctx);
    
    // Create static rigid body
    let rb = RigidBody::builder()
        .world_id(world_id)
        .position_x(pos.x)
        .position_y(pos.y)
        .position_z(pos.z)
        .collider_id(collider.id)
        .properties_id(rb_props.id)
        .body_type(RigidBodyType::Static)
        .build()
        .insert(ctx);
    
    // Record wall for rendering/client sync
    ctx.db.map_wall().insert(MapWall {
        id: 0,
        lobby_id,
        rigid_body_id: rb.id,
        position_x: pos.x,
        position_y: pos.y,
        position_z: pos.z,
        size_x: size.x,
        size_y: size.y,
        size_z: size.z,
        height,
    });
}

// ============================================================================
// SPAWN POSITIONS
// ============================================================================

pub fn get_spawn_points(ctx: &ReducerContext, lobby_id: u64) -> Vec<Vec3> {
    ctx.db
        .map_spawn_point()
        .iter()
        .filter(|s| s.lobby_id == lobby_id)
        .map(|s| Vec3::new(s.position_x, 0.5, s.position_z))
        .collect()
}

pub fn get_spawn_position(ctx: &ReducerContext, lobby_id: u64, team: usize) -> Vec3 {
    let spawns = get_spawn_points(ctx, lobby_id);
    if spawns.is_empty() {
        return Vec3::new(0.0, 0.5, 0.0);
    }
    spawns[team % spawns.len()]
}

fn dist_sq(a: Vec3, b: Vec3) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    let dz = a.z - b.z;
    dx * dx + dy * dy + dz * dz
}

/// Picks the best spawn: furthest from enemies, and in team modes closest to allies.
pub fn get_best_spawn_position(
    ctx: &ReducerContext,
    lobby_id: u64,
    spawner_team: i32,
    is_team_mode: bool,
    existing: &[(Vec3, i32)],
    _seed: u64,
) -> Vec3 {
    let spawns = get_spawn_points(ctx, lobby_id);
    if spawns.is_empty() {
        return Vec3::new(0.0, 0.5, 0.0);
    }

    let mut best_idx = 0usize;
    let mut best_score = f32::NEG_INFINITY;

    for (idx, spawn) in spawns.iter().enumerate() {
        // Min distance to any enemy (in FFA everyone is enemy; in team mode different team)
        let min_dist_enemy_sq = existing
            .iter()
            .filter(|(_, t)| !is_team_mode || *t != spawner_team)
            .map(|(pos, _)| dist_sq(*spawn, *pos))
            .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap_or(f32::INFINITY);

        // Min distance to any ally (only in team mode; ignore self as we're not spawned yet)
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

        // Score: higher = better. Prefer far from enemies (+ min_dist_enemy), prefer close to allies (- min_dist_ally)
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

pub fn get_random_spawn_position(ctx: &ReducerContext, lobby_id: u64, seed: u64) -> Vec3 {
    let spawns = get_spawn_points(ctx, lobby_id);
    if spawns.is_empty() {
        return Vec3::new(0.0, 0.5, 0.0);
    }
    let idx = (seed as usize) % spawns.len();
    spawns[idx]
}

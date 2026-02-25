//! Create map geometry (floor, walls) in physics world

use rapier3d::na::Unit;
use rapier3d::prelude::*;

use crate::collision_groups::{GROUP_BULLET, GROUP_FLOOR, GROUP_GRENADE, GROUP_LAUNCHER_SENSOR, GROUP_PLAYER, GROUP_WALL};
use crate::map_parser::{grid_to_world_x, grid_to_world_z, ParsedMap};
use crate::physics::PhysicsWorldState;

const FLOOR_HALF_Y: f32 = 0.05;

/// Build vertices and indices for a single trimesh collider from floor_grid (solid=1, hole=0).
fn build_floor_trimesh(
    parsed: &ParsedMap,
) -> (Vec<Point<Real>>, Vec<[u32; 3]>) {
    let grid = parsed.floor_grid.as_ref().unwrap();
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    let mut vi: u32 = 0;
    for (gy, row) in grid.iter().enumerate() {
        let gyu = gy as u32;
        for (gx, &cell) in row.iter().enumerate() {
            if cell == 0 {
                continue;
            }
            let gxu = gx as u32;
            let cx = grid_to_world_x(gxu, parsed.width);
            let cz = grid_to_world_z(gyu, parsed.height);
            let bl = point![cx - 0.5, 0.0, cz - 0.5];
            let br = point![cx + 0.5, 0.0, cz - 0.5];
            let tl = point![cx - 0.5, 0.0, cz + 0.5];
            let tr = point![cx + 0.5, 0.0, cz + 0.5];
            vertices.push(bl);
            vertices.push(br);
            vertices.push(tl);
            vertices.push(tr);
            indices.push([vi, vi + 2, vi + 3]);
            indices.push([vi, vi + 3, vi + 1]);
            vi += 4;
        }
    }
    (vertices, indices)
}

/// Wall run: horizontal span of connected walls with same height
struct WallRun {
    gx_start: u32,
    gx_end: u32,
    gy: u32,
    height: i32,
}

/// Build merged horizontal runs from walls. Connected cells (same row, adjacent in X, same height) become one run.
fn build_wall_runs(parsed: &ParsedMap) -> Vec<WallRun> {
    let w = parsed.width;
    let h = parsed.height;
    let mut grid: Vec<Vec<i32>> = vec![vec![0; w as usize]; h as usize];
    for wall in &parsed.walls {
        let gy = wall.y.min(h - 1) as usize;
        let gx = wall.x.min(w - 1) as usize;
        grid[gy][gx] = wall.height;
    }
    let mut runs = Vec::new();
    for gy in 0..h as usize {
        let row = &grid[gy];
        let mut gx: usize = 0;
        while gx < w as usize {
            let hgt = row[gx];
            if hgt == 0 {
                gx += 1;
                continue;
            }
            let gx_start = gx;
            while gx < w as usize && row[gx] == hgt {
                gx += 1;
            }
            runs.push(WallRun {
                gx_start: gx_start as u32,
                gx_end: gx as u32,
                gy: gy as u32,
                height: hgt,
            });
        }
    }
    runs
}

pub fn create_map_geometry(world: &mut PhysicsWorldState, _lobby_id: u64, parsed: &ParsedMap) {
    create_floor(world, parsed);

    let boundary_height = 2;
    let world_z_north = grid_to_world_z(0, parsed.height);
    let world_z_south = grid_to_world_z(parsed.height - 1, parsed.height);
    let world_x_west = grid_to_world_x(0, parsed.width);
    let world_x_east = grid_to_world_x(parsed.width - 1, parsed.width);

    create_wall(
        world,
        0.0,
        1.0,
        world_z_north,
        parsed.width as f32,
        2.0,
        1.0,
        boundary_height,
    );
    create_wall(
        world,
        0.0,
        1.0,
        world_z_south,
        parsed.width as f32,
        2.0,
        1.0,
        boundary_height,
    );
    create_wall(
        world,
        world_x_west,
        1.0,
        0.0,
        1.0,
        2.0,
        parsed.height as f32,
        boundary_height,
    );
    create_wall(
        world,
        world_x_east,
        1.0,
        0.0,
        1.0,
        2.0,
        parsed.height as f32,
        boundary_height,
    );

    for run in build_wall_runs(parsed) {
        let run_len = (run.gx_end - run.gx_start) as f32;
        let mid_gx = run.gx_start as f32 + (run_len - 1.0) / 2.0;
        let world_x = mid_gx - (parsed.width as f32) / 2.0 + 0.5;
        let world_z = grid_to_world_z(run.gy, parsed.height);
        let wall_height = if run.height == 2 { 2.0 } else { 1.0 };
        let center_y = wall_height / 2.0;
        create_wall(
            world,
            world_x,
            center_y,
            world_z,
            run_len,
            wall_height,
            1.0,
            run.height,
        );
    }

    for (x, z, radius, dir_x, dir_y, dir_z, force) in &parsed.launchers {
        create_launcher_sensor(world, *x, *z, *radius, *dir_x, *dir_y, *dir_z, *force);
    }
}

fn create_floor(world: &mut PhysicsWorldState, parsed: &ParsedMap) {
    match &parsed.floor_grid {
        None => {
            let halfspace = SharedShape::halfspace(Unit::new_unchecked(vector![0.0, 1.0, 0.0]));
            let collider = ColliderBuilder::new(halfspace).collision_groups(InteractionGroups::new(
                Group::from_bits_truncate(GROUP_FLOOR),
                Group::from_bits_truncate(GROUP_PLAYER | GROUP_BULLET | GROUP_GRENADE),
            ));

            let rb = RigidBodyBuilder::fixed().translation(vector![0.0, 0.0, 0.0]);

            let body_id = world.next_body_id();
            world.insert_body(body_id, rb, collider);
        }
        Some(_grid) => {
            let (vertices, indices) = build_floor_trimesh(parsed);
            if !vertices.is_empty() {
                let collider = ColliderBuilder::trimesh(vertices, indices)
                    .collision_groups(InteractionGroups::new(
                        Group::from_bits_truncate(GROUP_FLOOR),
                        Group::from_bits_truncate(GROUP_PLAYER | GROUP_BULLET | GROUP_GRENADE),
                    ));
                let rb = RigidBodyBuilder::fixed().translation(vector![0.0, 0.0, 0.0]);
                let body_id = world.next_body_id();
                world.insert_body(body_id, rb, collider);
            }
        }
    }
}

fn create_wall(
    world: &mut PhysicsWorldState,
    pos_x: f32,
    pos_y: f32,
    pos_z: f32,
    size_x: f32,
    size_y: f32,
    size_z: f32,
    _height: i32,
) {
    let half_x = size_x / 2.0;
    let half_y = size_y / 2.0;
    let half_z = size_z / 2.0;

    let cuboid = SharedShape::cuboid(half_x, half_y, half_z);
    let collider = ColliderBuilder::new(cuboid)
        .collision_groups(InteractionGroups::new(
            Group::from_bits_truncate(GROUP_WALL),
            Group::from_bits_truncate(GROUP_PLAYER | GROUP_BULLET | GROUP_GRENADE),
        ))
        .restitution(0.3);

    let rb = RigidBodyBuilder::fixed().translation(vector![pos_x, pos_y, pos_z]);

    let body_id = world.next_body_id();
    world.insert_body(body_id, rb, collider);
}

fn create_launcher_sensor(
    world: &mut PhysicsWorldState,
    pos_x: f32,
    pos_z: f32,
    radius: f32,
    dir_x: f32,
    dir_y: f32,
    dir_z: f32,
    force: f32,
) {
    let collider = ColliderBuilder::ball(radius)
        .sensor(true)
        .collision_groups(InteractionGroups::new(
            Group::from_bits_truncate(GROUP_LAUNCHER_SENSOR),
            Group::from_bits_truncate(GROUP_PLAYER),
        ));
    let rb = RigidBodyBuilder::fixed().translation(rapier3d::na::vector![pos_x, 0.5, pos_z]);
    let body_id = world.next_body_id();
    world.insert_body_with_sensor(body_id, rb, collider);
    world.launcher_impulses
        .insert(body_id, (force, dir_x, dir_y, dir_z));
}

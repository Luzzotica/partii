//! Create map geometry (floor, walls) in physics world

use rapier3d::na::Unit;
use rapier3d::prelude::*;

use crate::collision_groups::{GROUP_BULLET, GROUP_FLOOR, GROUP_GRENADE, GROUP_PLAYER, GROUP_WALL};
use crate::map_parser::{grid_to_world_x, grid_to_world_z, ParsedMap};
use crate::physics::PhysicsWorldState;

const FLOOR_HALF_Y: f32 = 0.05;

pub fn create_map_geometry(world: &mut PhysicsWorldState, _lobby_id: u64, parsed: &ParsedMap) {
    create_floor(world, parsed);

    let boundary_height = 2;

    for gx in 0..parsed.width {
        let world_x = grid_to_world_x(gx, parsed.width);
        let world_z_north = grid_to_world_z(0, parsed.height);
        create_wall(
            world,
            world_x,
            1.0,
            world_z_north,
            1.0,
            2.0,
            1.0,
            boundary_height,
        );
        let world_z_south = grid_to_world_z(parsed.height - 1, parsed.height);
        create_wall(
            world,
            world_x,
            1.0,
            world_z_south,
            1.0,
            2.0,
            1.0,
            boundary_height,
        );
    }
    for gy in 0..parsed.height {
        let world_x_west = grid_to_world_x(0, parsed.width);
        let world_z = grid_to_world_z(gy, parsed.height);
        create_wall(
            world,
            world_x_west,
            1.0,
            world_z,
            1.0,
            2.0,
            1.0,
            boundary_height,
        );
        let world_x_east = grid_to_world_x(parsed.width - 1, parsed.width);
        create_wall(
            world,
            world_x_east,
            1.0,
            world_z,
            1.0,
            2.0,
            1.0,
            boundary_height,
        );
    }

    for w in &parsed.walls {
        let world_x = grid_to_world_x(w.x, parsed.width);
        let world_z = grid_to_world_z(w.y, parsed.height);
        let wall_height = if w.height == 2 { 2.0 } else { 1.0 };
        let center_y = wall_height / 2.0;
        create_wall(
            world,
            world_x,
            center_y,
            world_z,
            1.0,
            wall_height,
            1.0,
            w.height,
        );
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
        Some(grid) => {
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
                    let half_extents = vector![half_x, FLOOR_HALF_Y, 0.5];

                    let cuboid = SharedShape::cuboid(half_extents.x, half_extents.y, half_extents.z);
                    let collider = ColliderBuilder::new(cuboid).collision_groups(InteractionGroups::new(
                        Group::from_bits_truncate(GROUP_FLOOR),
                        Group::from_bits_truncate(GROUP_PLAYER | GROUP_BULLET | GROUP_GRENADE),
                    ));

                    let rb = RigidBodyBuilder::fixed()
                        .translation(vector![world_x, -FLOOR_HALF_Y, world_z]);

                    let body_id = world.next_body_id();
                    world.insert_body(body_id, rb, collider);
                }
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

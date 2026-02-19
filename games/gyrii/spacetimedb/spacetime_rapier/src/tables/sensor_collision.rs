//! Sensor collision events - when a sensor collider (e.g. bullet) overlaps another collider.
//! Populated by step_world; cleared and repopulated each tick.

use spacetimedb::{table, ReducerContext, Table};

/// A collision between a sensor rigid body and another rigid body.
/// Written by step_world; read by game logic to apply damage, impulse, etc.
#[table(name = rapier_sensor_collision)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SensorCollision {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    /// Rigid body ID of the sensor (e.g. bullet)
    pub sensor_rigid_body_id: u64,

    /// Rigid body ID of the other entity (e.g. player)
    pub other_rigid_body_id: u64,

    /// Physics world ID
    #[index(btree)]
    pub world_id: u64,
}

impl SensorCollision {
    /// Delete all sensor collisions for a world (called at start of each step)
    pub fn clear_for_world(ctx: &ReducerContext, world_id: u64) {
        let to_delete: Vec<u64> = ctx
            .db
            .rapier_sensor_collision()
            .world_id()
            .filter(world_id)
            .map(|c| c.id)
            .collect();
        for id in to_delete {
            ctx.db.rapier_sensor_collision().id().delete(id);
        }
    }

    /// Insert a sensor collision event
    pub fn insert_event(
        ctx: &ReducerContext,
        sensor_rigid_body_id: u64,
        other_rigid_body_id: u64,
        world_id: u64,
    ) {
        ctx.db.rapier_sensor_collision().insert(SensorCollision {
            id: 0,
            sensor_rigid_body_id,
            other_rigid_body_id,
            world_id,
        });
    }
}

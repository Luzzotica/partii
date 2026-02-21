//! Persistent physics world - RigidBodySet, ColliderSet, etc.

use std::collections::HashMap;
use std::sync::Mutex;

use rapier3d::pipeline::EventHandler;
use rapier3d::prelude::{CollisionEvent, CollisionEventFlags};
use rapier3d::prelude::*;

use crate::collision_groups::{GROUP_BULLET, GROUP_FLOOR, GROUP_GRENADE, GROUP_PLAYER, GROUP_WALL};

static DUMMY_HOOKS: () = ();

struct SensorCollisionCollector {
    collider_to_body: HashMap<ColliderHandle, u64>,
    body_is_sensor: HashMap<u64, bool>,
    collisions: Mutex<Vec<(u64, u64)>>,
}

impl EventHandler for SensorCollisionCollector {
    fn handle_contact_force_event(
        &self,
        _dt: f32,
        _bodies: &RigidBodySet,
        _colliders: &ColliderSet,
        _contact_pair: &ContactPair,
        _total_force_magnitude: f32,
    ) {
    }

    fn handle_collision_event(
        &self,
        _bodies: &RigidBodySet,
        colliders: &ColliderSet,
        event: CollisionEvent,
        _contact_pair: Option<&ContactPair>,
    ) {
        if let CollisionEvent::Started(h1, h2, flags) = event {
            if !flags.contains(CollisionEventFlags::SENSOR) {
                return;
            }
            let id1 = self.collider_to_body.get(&h1).copied();
            let id2 = self.collider_to_body.get(&h2).copied();
            let (id1, id2) = match (id1, id2) {
                (Some(a), Some(b)) => (a, b),
                _ => return,
            };
            let (sensor, other) = if self.body_is_sensor.get(&id1).copied().unwrap_or(false) {
                (id1, id2)
            } else if self.body_is_sensor.get(&id2).copied().unwrap_or(false) {
                (id2, id1)
            } else {
                return;
            };
            let _ = colliders;
            if let Ok(mut v) = self.collisions.lock() {
                v.push((sensor, other));
            }
        }
    }
}

/// Persistent physics world for one lobby. Stepped every tick, never rebuilt.
pub struct PhysicsWorldState {
    pub rigid_body_set: RigidBodySet,
    pub collider_set: ColliderSet,
    island_manager: IslandManager,
    broad_phase: BroadPhase,
    narrow_phase: NarrowPhase,
    impulse_joint_set: ImpulseJointSet,
    multibody_joint_set: MultibodyJointSet,
    ccd_solver: CCDSolver,
    query_pipeline: QueryPipeline,
    integration_params: IntegrationParameters,
    physics_pipeline: PhysicsPipeline,
    gravity: Vector<Real>,

    /// Our entity ID -> Rapier RigidBodyHandle
    pub body_id_to_handle: HashMap<u64, RigidBodyHandle>,
    /// Rapier RigidBodyHandle -> our entity ID
    pub handle_to_body_id: HashMap<RigidBodyHandle, u64>,
    pub next_body_id: u64,
    event_collector: SensorCollisionCollector,
}

impl PhysicsWorldState {
    pub fn new() -> Self {
        let mut integration_params = IntegrationParameters::default();
        integration_params.dt = 1.0 / 60.0;
        integration_params.num_solver_iterations = std::num::NonZeroUsize::new(4).unwrap();

        Self {
            rigid_body_set: RigidBodySet::new(),
            collider_set: ColliderSet::new(),
            island_manager: IslandManager::new(),
            broad_phase: BroadPhase::new(),
            narrow_phase: NarrowPhase::new(),
            impulse_joint_set: ImpulseJointSet::new(),
            multibody_joint_set: MultibodyJointSet::new(),
            ccd_solver: CCDSolver::new(),
            query_pipeline: QueryPipeline::new(),
            integration_params,
            physics_pipeline: PhysicsPipeline::new(),
            gravity: vector![0.0, -9.81, 0.0],
            body_id_to_handle: HashMap::new(),
            handle_to_body_id: HashMap::new(),
            next_body_id: 1,
            event_collector: SensorCollisionCollector {
                collider_to_body: HashMap::new(),
                body_is_sensor: HashMap::new(),
                collisions: Mutex::new(Vec::new()),
            },
        }
    }

    /// Allocate next body ID
    pub fn next_body_id(&mut self) -> u64 {
        let id = self.next_body_id;
        self.next_body_id += 1;
        id
    }

    /// Insert a rigid body with collider
    pub fn insert_body(
        &mut self,
        body_id: u64,
        rb_builder: RigidBodyBuilder,
        collider_builder: ColliderBuilder,
    ) {
        self.insert_body_internal(body_id, rb_builder, collider_builder, false);
    }

    /// Insert a sensor body (e.g. bullet) - registers for collision events
    pub fn insert_body_with_sensor(
        &mut self,
        body_id: u64,
        rb_builder: RigidBodyBuilder,
        collider_builder: ColliderBuilder,
    ) {
        self.insert_body_internal(body_id, rb_builder, collider_builder, true);
    }

    fn insert_body_internal(
        &mut self,
        body_id: u64,
        rb_builder: RigidBodyBuilder,
        collider_builder: ColliderBuilder,
        is_sensor: bool,
    ) {
        let rb_handle = self.rigid_body_set.insert(rb_builder);
        let collider_handle = self.collider_set.insert_with_parent(
            collider_builder,
            rb_handle,
            &mut self.rigid_body_set,
        );
        self.body_id_to_handle.insert(body_id, rb_handle);
        self.handle_to_body_id.insert(rb_handle, body_id);
        self.event_collector
            .collider_to_body
            .insert(collider_handle, body_id);
        self.event_collector.body_is_sensor.insert(body_id, is_sensor);
    }

    /// Set linear velocity of a body by our ID
    pub fn set_linvel(&mut self, body_id: u64, x: f32, y: f32, z: f32) {
        if let Some(&handle) = self.body_id_to_handle.get(&body_id) {
            if let Some(rb) = self.rigid_body_set.get_mut(handle) {
                rb.set_linvel(vector![x, y, z], true);
            }
        }
    }

    /// Get position of a body by our ID
    pub fn get_position(&self, body_id: u64) -> Option<(f32, f32, f32)> {
        let handle = self.body_id_to_handle.get(&body_id)?;
        let rb = self.rigid_body_set.get(*handle)?;
        let t = rb.translation();
        Some((t.x, t.y, t.z))
    }

    /// Get linear velocity of a body by our ID
    pub fn get_linvel(&self, body_id: u64) -> Option<(f32, f32, f32)> {
        let handle = self.body_id_to_handle.get(&body_id)?;
        let rb = self.rigid_body_set.get(*handle)?;
        let v = rb.linvel();
        Some((v.x, v.y, v.z))
    }

    /// Step the physics simulation. Returns sensor collisions (sensor_body_id, other_body_id).
    pub fn step(&mut self) -> Vec<(u64, u64)> {
        self.physics_pipeline.step(
            &self.gravity,
            &self.integration_params,
            &mut self.island_manager,
            &mut self.broad_phase,
            &mut self.narrow_phase,
            &mut self.rigid_body_set,
            &mut self.collider_set,
            &mut self.impulse_joint_set,
            &mut self.multibody_joint_set,
            &mut self.ccd_solver,
            Some(&mut self.query_pipeline),
            &DUMMY_HOOKS,
            &self.event_collector,
        );
        self.event_collector
            .collisions
            .lock()
            .map(|mut v| std::mem::take(&mut *v))
            .unwrap_or_default()
    }

    /// Remove a body by our ID (e.g. on player leave)
    pub fn remove_body(&mut self, body_id: u64) {
        if let Some(handle) = self.body_id_to_handle.remove(&body_id) {
            self.handle_to_body_id.remove(&handle);
            self.event_collector.body_is_sensor.remove(&body_id);
            self.event_collector
                .collider_to_body
                .retain(|_, bid| *bid != body_id);
            self.rigid_body_set.remove(
                handle,
                &mut self.island_manager,
                &mut self.collider_set,
                &mut self.impulse_joint_set,
                &mut self.multibody_joint_set,
                true,
            );
        }
    }

    /// Enable or disable a body (e.g. hide dead player under floor)
    pub fn set_body_enabled(&mut self, body_id: u64, enabled: bool) {
        if let Some(&handle) = self.body_id_to_handle.get(&body_id) {
            if let Some(rb) = self.rigid_body_set.get_mut(handle) {
                rb.set_enabled(enabled);
            }
        }
    }

    /// Apply impulse to a body (add to velocity)
    pub fn apply_impulse(&mut self, body_id: u64, ix: f32, iy: f32, iz: f32) {
        if let Some(&handle) = self.body_id_to_handle.get(&body_id) {
            if let Some(rb) = self.rigid_body_set.get_mut(handle) {
                let v = rb.linvel();
                rb.set_linvel(vector![v.x + ix, v.y + iy, v.z + iz], true);
            }
        }
    }

    /// Cast a ray and return (hit_body_id, distance) for the first hit.
    /// When walls_only is true, only colliders in GROUP_WALL or GROUP_FLOOR are hit (no players, bullets, grenades).
    pub fn cast_ray(
        &mut self,
        origin_x: f32,
        origin_y: f32,
        origin_z: f32,
        dir_x: f32,
        dir_y: f32,
        dir_z: f32,
        max_dist: f32,
        exclude_body_id: Option<u64>,
        walls_only: bool,
    ) -> Option<(u64, f32)> {
        self.query_pipeline.update(&self.rigid_body_set, &self.collider_set);
        let origin = point![origin_x, origin_y, origin_z];
        let dir = vector![dir_x, dir_y, dir_z];
        let len_sq = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z;
        if len_sq < 1e-12 {
            return None;
        }
        let len = len_sq.sqrt();
        let dir_norm = vector![dir.x / len, dir.y / len, dir.z / len];
        let ray = Ray::new(origin, dir_norm);
        let mut filter = QueryFilter::default();
        if let Some(id) = exclude_body_id {
            if let Some(&h) = self.body_id_to_handle.get(&id) {
                filter = filter.exclude_rigid_body(h);
            }
        }
        if walls_only {
            filter = filter.groups(InteractionGroups::new(
                Group::from_bits_truncate(0xFFFF),
                Group::from_bits_truncate(GROUP_WALL | GROUP_FLOOR),
            ));
        }
        if let Some((collider_handle, toi)) = self.query_pipeline.cast_ray(
            &self.rigid_body_set,
            &self.collider_set,
            &ray,
            max_dist,
            false,
            filter,
        ) {
            let collider = self.collider_set.get(collider_handle)?;
            let rb_handle = collider.parent()?;
            let hit_body_id = *self.handle_to_body_id.get(&rb_handle)?;
            if exclude_body_id == Some(hit_body_id) {
                return None;
            }
            Some((hit_body_id, toi))
        } else {
            None
        }
    }
}

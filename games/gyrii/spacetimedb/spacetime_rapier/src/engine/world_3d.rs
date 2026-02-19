//! 3D Physics engine implementation using Rapier3D

#![cfg(feature = "dim3")]

use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::sync::Mutex;

use spacetimedb::ReducerContext;
use rapier3d::prelude::*;
use rapier3d::pipeline::EventHandler;
use rapier3d::prelude::{CollisionEvent, CollisionEventFlags};
use nalgebra::{Vector3, Point3, UnitQuaternion, Quaternion};

use crate::tables::{
    PhysicsWorld, RigidBody, RigidBodyType, Collider, ColliderType,
    RigidBodyProperties, Trigger, RayCast, RayCastHit, SensorCollision,
};
use crate::math::{Vec3, Quat};
use super::KinematicBody;

/// Collects sensor collision events during PhysicsPipeline::step (Rapier best practice).
/// Only CollisionEvent::Started with SENSOR flag are recorded; we then insert them into DB after the step.
struct SensorCollisionEventCollector {
    collider_to_body: HashMap<ColliderHandle, u64>,
    body_is_sensor: HashMap<u64, bool>,
    sensor_collisions: Mutex<Vec<(u64, u64)>>,
}

impl EventHandler for SensorCollisionEventCollector {
    fn handle_collision_event(
        &self,
        _bodies: &RigidBodySet,
        _colliders: &ColliderSet,
        event: CollisionEvent,
        _contact_pair: Option<&ContactPair>,
    ) {
        if let CollisionEvent::Started(h1, h2, flags) = event {
            if !flags.contains(CollisionEventFlags::SENSOR) {
                return;
            }
            let (id1, id2) = match (self.collider_to_body.get(&h1).copied(), self.collider_to_body.get(&h2).copied()) {
                (Some(a), Some(b)) => (a, b),
                _ => return,
            };
            let (sensor, other) = if self.body_is_sensor.get(&id1).copied().unwrap_or(false) {
                (id1, id2)
            } else {
                (id2, id1)
            };
            if let Ok(mut v) = self.sensor_collisions.lock() {
                v.push((sensor, other));
            }
        }
    }

    fn handle_contact_force_event(
        &self,
        _dt: f32,
        _bodies: &RigidBodySet,
        _colliders: &ColliderSet,
        _contact_pair: &ContactPair,
        _total_force_magnitude: f32,
    ) {
        // We only care about sensor collision events.
    }
}

/// Step the 3D physics world
///
/// This function:
/// 1. Loads all physics entities from SpacetimeDB tables
/// 2. Builds a Rapier3D physics world
/// 3. Applies kinematic body updates
/// 4. Steps the simulation
/// 5. Writes results back to SpacetimeDB tables
/// 6. Updates trigger enter/exit events
/// 7. Updates raycast hit lists
pub fn step_world_3d(
    ctx: &ReducerContext,
    world: &PhysicsWorld,
    kinematic_entities: impl Iterator<Item = KinematicBody>,
) {
    // Collect kinematic updates into a map
    let kinematic_updates: HashMap<u64, (Vec3, Quat)> = kinematic_entities
        .map(|(id, (pos, rot))| (id, (pos, rot)))
        .collect();

    // Initialize Rapier structures
    let gravity = world.gravity_vector();
    let mut integration_parameters = IntegrationParameters::default();
    integration_parameters.dt = world.timestep();
    integration_parameters.num_solver_iterations = NonZeroUsize::new(world.num_solver_iterations as usize)
        .unwrap_or(NonZeroUsize::new(4).unwrap());
    integration_parameters.num_additional_friction_iterations = world.num_additional_friction_iterations as usize;
    integration_parameters.num_internal_pgs_iterations = world.num_internal_pgs_iterations as usize;

    let mut physics_pipeline = PhysicsPipeline::new();
    let mut island_manager = IslandManager::new();
    let mut broad_phase = DefaultBroadPhase::new();
    let mut narrow_phase = NarrowPhase::new();
    let mut impulse_joint_set = ImpulseJointSet::new();
    let mut multibody_joint_set = MultibodyJointSet::new();
    let mut ccd_solver = CCDSolver::new();
    let mut query_pipeline = QueryPipeline::new();
    let physics_hooks = ();

    let mut rigid_body_set = RigidBodySet::new();
    let mut collider_set = ColliderSet::new();

    // Maps from our IDs to Rapier handles (and reverse for event handler)
    let mut id_to_rb_handle: HashMap<u64, RigidBodyHandle> = HashMap::new();
    let mut rb_handle_to_id: HashMap<RigidBodyHandle, u64> = HashMap::new();
    let mut id_to_collider: HashMap<u64, ColliderHandle> = HashMap::new();
    let mut collider_handle_to_body_id: HashMap<ColliderHandle, u64> = HashMap::new();

    // Clear sensor collisions from previous tick
    SensorCollision::clear_for_world(ctx, world.id);

    // Load colliders first (we need them to create rigid bodies)
    let colliders: Vec<_> = Collider::all_in_world(ctx, world.id).collect();
    let collider_is_sensor: HashMap<u64, bool> = colliders
        .iter()
        .map(|c| (c.id, c.is_sensor))
        .collect();
    let collider_groups: HashMap<u64, (u32, u32)> = colliders
        .iter()
        .map(|c| (c.id, (c.collision_memberships, c.collision_filter)))
        .collect();
    let properties: HashMap<u64, RigidBodyProperties> = RigidBodyProperties::all_in_world(ctx, world.id)
        .map(|p| (p.id, p))
        .collect();

    // Build collider shapes
    let collider_shapes: HashMap<u64, SharedShape> = colliders
        .iter()
        .map(|c| {
            let shape = match c.collider_type {
                ColliderType::Ball => SharedShape::ball(c.radius),
                ColliderType::Cuboid => SharedShape::cuboid(
                    c.half_extent_x,
                    c.half_extent_y,
                    c.half_extent_z,
                ),
                ColliderType::Capsule => SharedShape::capsule_y(c.half_height, c.radius),
                ColliderType::Cylinder => SharedShape::cylinder(c.half_height, c.radius),
                ColliderType::Cone => SharedShape::cone(c.half_height, c.radius),
                ColliderType::Triangle => SharedShape::triangle(
                    Point3::new(c.vertex_a_x, c.vertex_a_y, c.vertex_a_z),
                    Point3::new(c.vertex_b_x, c.vertex_b_y, c.vertex_b_z),
                    Point3::new(c.vertex_c_x, c.vertex_c_y, c.vertex_c_z),
                ),
                ColliderType::Heightfield => SharedShape::ball(1.0), // Placeholder
                ColliderType::HalfSpace => {
                    let n = Vector3::new(c.normal_x, c.normal_y, c.normal_z);
                    let len_sq = n.norm_squared();
                    let unit = if len_sq > 1e-10f32 {
                        nalgebra::Unit::new_normalize(n)
                    } else {
                        nalgebra::Unit::new_unchecked(Vector3::new(0.0, 1.0, 0.0))
                    };
                    SharedShape::halfspace(unit)
                }
            };
            (c.id, shape)
        })
        .collect();

    // Load and create rigid bodies
    let bodies: Vec<_> = RigidBody::all_in_world(ctx, world.id).collect();

    for body in &bodies {
        if !body.enabled {
            continue;
        }

        // Get position (use kinematic update if available)
        let (pos, rot) = kinematic_updates
            .get(&body.id)
            .cloned()
            .unwrap_or_else(|| (body.position(), body.rotation()));

        // Create Rapier rigid body
        let rb_type = match body.body_type {
            RigidBodyType::Static => rapier3d::prelude::RigidBodyType::Fixed,
            RigidBodyType::Dynamic => rapier3d::prelude::RigidBodyType::Dynamic,
            RigidBodyType::Kinematic => rapier3d::prelude::RigidBodyType::KinematicPositionBased,
        };

        let mut rb_builder = RigidBodyBuilder::new(rb_type)
            .translation(Vector3::new(pos.x, pos.y, pos.z))
            .rotation(UnitQuaternion::from_quaternion(
                Quaternion::new(rot.w, rot.x, rot.y, rot.z)
            ).scaled_axis())
            .linvel(Vector3::new(
                body.linear_velocity_x,
                body.linear_velocity_y,
                body.linear_velocity_z,
            ))
            .angvel(Vector3::new(
                body.angular_velocity_x,
                body.angular_velocity_y,
                body.angular_velocity_z,
            ))
            .gravity_scale(body.gravity_scale);

        // Apply properties if available
        if let Some(props) = properties.get(&body.properties_id) {
            rb_builder = rb_builder
                .linear_damping(props.linear_damping)
                .angular_damping(props.angular_damping)
                .ccd_enabled(props.ccd_enabled);
        }

        let rb_handle = rigid_body_set.insert(rb_builder.build());
        id_to_rb_handle.insert(body.id, rb_handle);
        rb_handle_to_id.insert(rb_handle, body.id);

        // Attach collider to rigid body
        if let Some(shape) = collider_shapes.get(&body.collider_id) {
            let props = properties.get(&body.properties_id);
            let is_sensor = *collider_is_sensor.get(&body.collider_id).unwrap_or(&false);
            let (mem, filt) = *collider_groups.get(&body.collider_id).unwrap_or(&(0xFFFF, 0xFFFF));

            let groups = if mem == 0xFFFF && filt == 0xFFFF {
                InteractionGroups::all()
            } else {
                // log::info!("[COLLISION_GROUPS] rb={} collider={} memberships={} filter={}", body.id, body.collider_id, mem, filt);
                InteractionGroups::new(
                    Group::from_bits_truncate(mem),
                    Group::from_bits_truncate(filt),
                )
            };
            let mut collider_builder = ColliderBuilder::new(shape.clone())
                .sensor(is_sensor)
                .collision_groups(groups)
                .solver_groups(groups)
                .active_collision_types(ActiveCollisionTypes::default())
                .active_events(ActiveEvents::COLLISION_EVENTS)
                .contact_skin(0.005);

            if let Some(props) = props {
                collider_builder = collider_builder
                    .friction(props.friction)
                    .restitution(props.restitution)
                    .density(props.density);
            }

            let collider_handle = collider_set.insert_with_parent(
                collider_builder.build(),
                rb_handle,
                &mut rigid_body_set,
            );
            id_to_collider.insert(body.id, collider_handle);
            collider_handle_to_body_id.insert(collider_handle, body.id);
        }
    }

    // Event collector for sensor collisions (Rapier emits these during step; we process after)
    let body_is_sensor_map: HashMap<u64, bool> = bodies
        .iter()
        .filter(|b| b.enabled)
        .map(|b| (b.id, collider_is_sensor.get(&b.collider_id).copied().unwrap_or(false)))
        .collect();
    let sensor_collision_collector = SensorCollisionEventCollector {
        collider_to_body: collider_handle_to_body_id,
        body_is_sensor: body_is_sensor_map,
        sensor_collisions: Mutex::new(Vec::new()),
    };

    // Load and create triggers (sensors)
    let triggers: Vec<_> = Trigger::all_in_world(ctx, world.id).collect();
    let mut trigger_collider_handles: HashMap<ColliderHandle, u64> = HashMap::new();

    for trigger in &triggers {
        if !trigger.enabled {
            continue;
        }

        if let Some(shape) = collider_shapes.get(&trigger.collider_id) {
            let collider = ColliderBuilder::new(shape.clone())
                .position(Isometry::from_parts(
                    nalgebra::Translation3::new(
                        trigger.position_x,
                        trigger.position_y,
                        trigger.position_z,
                    ),
                    UnitQuaternion::from_quaternion(
                        Quaternion::new(trigger.rotation_w, trigger.rotation_x, trigger.rotation_y, trigger.rotation_z)
                    ),
                ))
                .sensor(true)
                .build();

            let handle = collider_set.insert(collider);
            trigger_collider_handles.insert(handle, trigger.id);
        }
    }

    // Step the physics simulation
    physics_pipeline.step(
        &gravity,
        &integration_parameters,
        &mut island_manager,
        &mut broad_phase,
        &mut narrow_phase,
        &mut rigid_body_set,
        &mut collider_set,
        &mut impulse_joint_set,
        &mut multibody_joint_set,
        &mut ccd_solver,
        Some(&mut query_pipeline),
        &physics_hooks,
        &sensor_collision_collector,
    );

    // Process sensor collision events collected during the step (Rapier best practice)
    if let Ok(mut events) = sensor_collision_collector.sensor_collisions.lock() {
        for (sensor_body_id, other_body_id) in events.drain(..) {
            SensorCollision::insert_event(ctx, sensor_body_id, other_body_id, world.id);
        }
    }

    // Write results back to SpacetimeDB
    for body in &bodies {
        if !body.enabled {
            continue;
        }

        if let Some(&handle) = id_to_rb_handle.get(&body.id) {
            if let Some(rb) = rigid_body_set.get(handle) {
                let pos = rb.translation();
                let rot = rb.rotation();
                let linvel = rb.linvel();
                let angvel = rb.angvel();

                let mut updated = body.clone();
                updated.position_x = pos.x;
                updated.position_y = pos.y;
                updated.position_z = pos.z;

                // Convert rotation back to quaternion
                let q = rot.into_inner();
                updated.rotation_x = q.i;
                updated.rotation_y = q.j;
                updated.rotation_z = q.k;
                updated.rotation_w = q.w;

                updated.linear_velocity_x = linvel.x;
                updated.linear_velocity_y = linvel.y;
                updated.linear_velocity_z = linvel.z;
                updated.angular_velocity_x = angvel.x;
                updated.angular_velocity_y = angvel.y;
                updated.angular_velocity_z = angvel.z;

                updated.update(ctx);
            }
        }
    }

    // Sensor collisions are now handled by SensorCollisionEventCollector during the step (see above).

    // Update trigger events
    for trigger in triggers {
        if !trigger.enabled {
            continue;
        }

        let mut current_inside: Vec<u64> = Vec::new();

        // Find trigger's collider handle
        let trigger_collider = trigger_collider_handles.iter()
            .find(|(_, &tid)| tid == trigger.id)
            .map(|(&h, _)| h);

        if let Some(trigger_handle) = trigger_collider {
            // Check for intersections with all rigid body colliders
            for (&body_id, &collider_handle) in &id_to_collider {
                if narrow_phase.intersection_pair(trigger_handle, collider_handle) == Some(true) {
                    current_inside.push(body_id);
                }
            }
        }

        let mut updated = trigger.clone();
        updated.update_entities(current_inside);
        updated.update(ctx);
    }

    // Update raycasts
    update_raycasts(ctx, world, &query_pipeline, &rigid_body_set, &collider_set, &rb_handle_to_id, &id_to_collider);

    if world.debug {
        log::debug!(
            "step_world_3d: world={}, bodies={}, colliders={}, triggers={}",
            world.id,
            rigid_body_set.len(),
            collider_set.len(),
            trigger_collider_handles.len()
        );
    }
}

/// Update all raycasts for this world
fn update_raycasts(
    ctx: &ReducerContext,
    world: &PhysicsWorld,
    query_pipeline: &QueryPipeline,
    rigid_body_set: &RigidBodySet,
    collider_set: &ColliderSet,
    _rb_handle_to_id: &HashMap<RigidBodyHandle, u64>,
    id_to_collider: &HashMap<u64, ColliderHandle>,
) {
    // Build a map from collider handle to body id
    let collider_to_body: HashMap<ColliderHandle, u64> = id_to_collider
        .iter()
        .map(|(&body_id, &collider_handle)| (collider_handle, body_id))
        .collect();

    let raycasts: Vec<_> = RayCast::all_in_world(ctx, world.id).collect();

    for raycast in raycasts {
        if !raycast.enabled {
            continue;
        }

        let origin = Point3::new(raycast.origin_x, raycast.origin_y, raycast.origin_z);
        let direction = Vector3::new(raycast.direction_x, raycast.direction_y, raycast.direction_z);

        // Normalize direction
        let direction = if direction.magnitude() > 1e-6 {
            direction.normalize()
        } else {
            Vector3::y() // Default to up if direction is zero
        };

        let ray = Ray::new(origin, direction);
        let filter = QueryFilter::default();

        let mut hits: Vec<RayCastHit> = Vec::new();

        // Cast ray and collect all hits
        query_pipeline.intersections_with_ray(
            rigid_body_set,
            collider_set,
            &ray,
            raycast.max_distance,
            raycast.solid,
            filter,
            |handle, intersection| {
                if let Some(&body_id) = collider_to_body.get(&handle) {
                    let point = ray.point_at(intersection.time_of_impact);
                    hits.push(RayCastHit::new(
                        body_id,
                        intersection.time_of_impact,
                        Vec3::new(point.x, point.y, point.z),
                        Vec3::new(
                            intersection.normal.x,
                            intersection.normal.y,
                            intersection.normal.z,
                        ),
                    ));
                }
                true // Continue searching for more hits
            },
        );

        // Sort hits by distance
        hits.sort_by(|a, b| a.distance.partial_cmp(&b.distance).unwrap_or(std::cmp::Ordering::Equal));

        let mut updated = raycast.clone();
        updated.update_hits(hits);
        updated.update(ctx);
    }
}

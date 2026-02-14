// Game state, physics tick, and damage processing

use std::time::Duration;
use spacetimedb::{reducer, table, Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, Timestamp};
use spacetime_rapier::{
    step_world, Collider, ColliderType, PhysicsWorld, RigidBody, RigidBodyType, Trigger, Vec3, Quat,
};

// Import table traits for database access
use crate::lobby::lobby;
use crate::maps::{map_wall, MapWall};
use crate::player::{player, Player};
use crate::weapons::{grenade, damage_zone, Grenade};

// ============================================================================
// GAME CONFIG
// ============================================================================

#[table(name = game_config, public)]
pub struct GameConfig {
    #[primary_key]
    pub id: u64,
    pub respawn_time_ms: u64,
    pub default_health: i32,
    pub default_max_ammo: i32,
}

// ============================================================================
// PHYSICS TICK TIMER (Scheduled Reducer)
// ============================================================================

#[table(name = physics_tick_timer, scheduled(physics_tick))]
pub struct PhysicsTickTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub world_id: u64,
}

/// Updated every physics tick so clients can verify the tick is running and see world body/collider counts.
#[table(name = physics_tick_heartbeat, public)]
pub struct PhysicsTickHeartbeat {
    #[primary_key]
    pub world_id: u64,
    pub last_tick_timestamp: Timestamp,
    pub rigid_body_count: u32,
    pub collider_count: u32,
}

// ============================================================================
// KILL EVENTS
// ============================================================================

#[table(name = kill_event, public)]
pub struct KillEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub killer_id: Identity,
    pub victim_id: Identity,
    pub weapon_type: String,
    pub timestamp: Timestamp,
}

// ============================================================================
// GAME STATE
// ============================================================================

#[derive(Clone, Copy, PartialEq, Eq, Debug, SpacetimeType)]
pub enum GameState {
    Waiting,
    Starting,
    InProgress,
    Ended,
}

// ============================================================================
// PHYSICS TICK REDUCER
// ============================================================================

#[reducer]
pub fn physics_tick(ctx: &ReducerContext, timer: PhysicsTickTimer) -> Result<(), String> {
    // Get the physics world
    let world = match PhysicsWorld::find(ctx, timer.world_id) {
        Some(w) => w,
        None => return Ok(()), // World was deleted, stop ticking
    };

    // No kinematic overrides: players are Dynamic; velocity is set in update_input, Rapier steps and resolves walls
    let kinematic_entities = std::iter::empty::<(u64, (Vec3, Quat))>();

    // Step the physics simulation (walls are static; players are dynamic and collide)
    step_world(ctx, &world, kinematic_entities);

    // Sync Player position and velocity from RigidBody (only for bodies in this world — we just stepped them)
    for player in ctx.db.player().iter() {
        if player.rigid_body_id == 0 || !player.is_alive {
            continue;
        }
        if let Some(rb) = RigidBody::find(ctx, player.rigid_body_id) {
            if rb.world_id != world.id {
                continue; // body belongs to another world; don't overwrite with stale data
            }
            let mut updated = player.clone();
            updated.position_x = rb.position_x;
            updated.position_y = rb.position_y;
            updated.position_z = rb.position_z;
            updated.velocity_x = rb.linear_velocity_x;
            updated.velocity_z = rb.linear_velocity_z;
            ctx.db.player().identity().update(updated);
        }
    }

    // Process game logic
    process_grenades(ctx);
    process_damage_zones(ctx);
    process_respawns(ctx);

    // Debug heartbeat: so clients can verify tick is running and see body/collider counts
    let body_count = RigidBody::all_in_world(ctx, world.id).count() as u32;
    let collider_count = Collider::all_in_world(ctx, world.id).count() as u32;
    let heartbeat = PhysicsTickHeartbeat {
        world_id: world.id,
        last_tick_timestamp: ctx.timestamp,
        rigid_body_count: body_count,
        collider_count,
    };
    if let Some(mut existing) = ctx.db.physics_tick_heartbeat().world_id().find(&world.id) {
        existing.last_tick_timestamp = heartbeat.last_tick_timestamp;
        existing.rigid_body_count = heartbeat.rigid_body_count;
        existing.collider_count = heartbeat.collider_count;
        ctx.db.physics_tick_heartbeat().world_id().update(existing);
    } else {
        ctx.db.physics_tick_heartbeat().insert(heartbeat);
    }

    Ok(())
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Start the physics tick loop for a world. Inserts a single row with Interval(60 Hz);
/// the scheduler will invoke physics_tick repeatedly without rescheduling each time.
pub fn schedule_physics_tick(ctx: &ReducerContext, world_id: u64) {
    const TICK_INTERVAL_MICROS: u64 = 1_000 / 60; // 60 Hz
    ctx.db.physics_tick_timer().insert(PhysicsTickTimer {
        scheduled_id: 0, // auto_inc
        scheduled_at: ScheduleAt::Interval(Duration::from_millis(TICK_INTERVAL_MICROS).into()),
        world_id,
    });
}

fn process_grenades(ctx: &ReducerContext) {
    let grenades_to_explode: Vec<Grenade> = ctx
        .db
        .grenade()
        .iter()
        .filter(|g| g.fuse_ticks <= 0)
        .collect();

    for grenade in grenades_to_explode {
        // Get grenade position from rigid body
        if let Some(rb) = RigidBody::find(ctx, grenade.rigid_body_id) {
            let position = rb.position();
            // Apply explosion damage to nearby players
            apply_explosion_damage(ctx, position, grenade.damage, grenade.radius, grenade.owner_id);
        }

        // Remove grenade and its physics body
        ctx.db.grenade().rigid_body_id().delete(grenade.rigid_body_id);
        if let Some(rb) = RigidBody::find(ctx, grenade.rigid_body_id) {
            rb.delete(ctx);
        }
    }

    // Decrement fuse on remaining grenades
    for grenade in ctx.db.grenade().iter() {
        if grenade.fuse_ticks > 0 {
            let mut updated = grenade.clone();
            updated.fuse_ticks -= 1;
            ctx.db.grenade().rigid_body_id().update(updated);
        }
    }
}

fn process_damage_zones(ctx: &ReducerContext) {
    let zones_to_remove: Vec<u64> = ctx
        .db
        .damage_zone()
        .iter()
        .filter(|z| z.remaining_ticks <= 0)
        .map(|z| z.trigger_id)
        .collect();

    // Remove expired zones
    for trigger_id in zones_to_remove {
        ctx.db.damage_zone().trigger_id().delete(trigger_id);
        if let Some(trigger) = Trigger::find(ctx, trigger_id) {
            trigger.delete(ctx);
        }
    }

    // Apply damage from active zones and decrement ticks
    for zone in ctx.db.damage_zone().iter() {
        if zone.remaining_ticks > 0 {
            // Get trigger to find entities inside
            if let Some(trigger) = Trigger::find(ctx, zone.trigger_id) {
                // Apply damage to all players inside the trigger
                for entity_id in &trigger.entities_inside {
                    // Find player with this rigid body
                    if let Some(player) = ctx.db.player().iter().find(|p| p.rigid_body_id == *entity_id) {
                        apply_damage(ctx, player.identity, zone.damage_per_tick, zone.owner_id);
                    }
                }
            }

            // Decrement remaining ticks
            let mut updated = zone.clone();
            updated.remaining_ticks -= 1;
            ctx.db.damage_zone().trigger_id().update(updated);
        }
    }
}

fn process_respawns(ctx: &ReducerContext) {
    let current_time = ctx.timestamp.to_micros_since_unix_epoch();
    
    let players_to_respawn: Vec<Player> = ctx
        .db
        .player()
        .iter()
        .filter(|p| p.respawn_at > 0 && current_time >= p.respawn_at)
        .collect();

    for player in players_to_respawn {
        let rigid_body_id = player.rigid_body_id;
        let mut updated = player.clone();
        updated.health = 100;
        updated.is_alive = true;
        updated.respawn_at = 0;
        updated.velocity_x = 0.0;
        updated.velocity_z = 0.0;
        // Reset position to spawn point for this lobby's map
        let map_id = ctx
            .db
            .lobby()
            .id()
            .find(updated.lobby_id)
            .map(|l| l.map_id)
            .unwrap_or(crate::maps::MapId::Arena);
        let spawn_pos = crate::maps::get_spawn_position(map_id, updated.team as usize);
        updated.position_x = spawn_pos.x;
        updated.position_y = spawn_pos.y;
        updated.position_z = spawn_pos.z;
        ctx.db.player().identity().update(updated);
        // Sync RigidBody so physics state matches (position + zero velocity)
        if let Some(mut rb) = RigidBody::find(ctx, rigid_body_id) {
            rb.position_x = spawn_pos.x;
            rb.position_y = spawn_pos.y;
            rb.position_z = spawn_pos.z;
            rb.linear_velocity_x = 0.0;
            rb.linear_velocity_y = 0.0;
            rb.linear_velocity_z = 0.0;
            rb.update(ctx);
        }
    }
}

pub fn apply_explosion_damage(
    ctx: &ReducerContext,
    center: Vec3,
    max_damage: f32,
    radius: f32,
    source_id: Identity,
) {
    for player in ctx.db.player().iter() {
        if !player.is_alive {
            continue;
        }

        let dx = player.position_x - center.x;
        let dy = player.position_y - center.y;
        let dz = player.position_z - center.z;
        let distance = (dx * dx + dy * dy + dz * dz).sqrt();

        if distance < radius {
            // Damage falls off with distance
            let damage_multiplier = 1.0 - (distance / radius);
            let damage = (max_damage * damage_multiplier) as i32;
            apply_damage(ctx, player.identity, damage, source_id);
        }
    }
}

pub fn apply_damage(ctx: &ReducerContext, target_id: Identity, damage: i32, source_id: Identity) {
    if let Some(mut player) = ctx.db.player().identity().find(target_id) {
        if !player.is_alive {
            return;
        }

        player.health -= damage;

        if player.health <= 0 {
            player.health = 0;
            player.is_alive = false;
            player.deaths += 1;
            
            // Set respawn time
            let config = ctx.db.game_config().id().find(0).unwrap_or(GameConfig {
                id: 0,
                respawn_time_ms: 3000,
                default_health: 100,
                default_max_ammo: 30,
            });
            player.respawn_at = ctx.timestamp.to_micros_since_unix_epoch() + (config.respawn_time_ms * 1000) as i64;

            // Record kill
            if source_id != target_id {
                if let Some(mut killer) = ctx.db.player().identity().find(source_id) {
                    killer.kills += 1;
                    ctx.db.player().identity().update(killer);
                }

                ctx.db.kill_event().insert(KillEvent {
                    id: 0,
                    killer_id: source_id,
                    victim_id: target_id,
                    weapon_type: "unknown".to_string(),
                    timestamp: ctx.timestamp,
                });
            }
        }

        ctx.db.player().identity().update(player);
    }
}

// ============================================================================
// DEBUG REDUCER (call from CLI or client to verify physics world state)
// ============================================================================

/// Call from CLI or client to log physics world state (check server console for output).
#[reducer]
pub fn debug_physics_world(ctx: &ReducerContext, world_id: u64) {
    let body_count = RigidBody::all_in_world(ctx, world_id).count();
    let collider_count = Collider::all_in_world(ctx, world_id).count();
    let heartbeat = ctx
        .db
        .physics_tick_heartbeat()
        .world_id()
        .find(&world_id)
        .map(|h| format!(
            "last_tick_micros={}",
            h.last_tick_timestamp.to_micros_since_unix_epoch()
        ))
        .unwrap_or_else(|| "no_heartbeat".to_string());
    spacetimedb::log::info!(
        "debug_physics_world: world_id={} rigid_bodies={} colliders={} {}",
        world_id,
        body_count,
        collider_count,
        heartbeat
    );
}

/// Log each rigid body and collider in the world (check server console). Verifies body_type, shape, and sensor flag.
#[reducer]
pub fn debug_collision_bodies(ctx: &ReducerContext, world_id: u64) {
    spacetimedb::log::info!("debug_collision_bodies: world_id={}", world_id);
    for rb in RigidBody::all_in_world(ctx, world_id) {
        let type_str = match rb.body_type {
            RigidBodyType::Static => "Static",
            RigidBodyType::Dynamic => "Dynamic",
            RigidBodyType::Kinematic => "Kinematic",
        };
        spacetimedb::log::info!(
            "  rb id={} type={} pos=({:.2},{:.2},{:.2}) collider_id={}",
            rb.id,
            type_str,
            rb.position_x,
            rb.position_y,
            rb.position_z,
            rb.collider_id
        );
        if let Some(c) = Collider::find(ctx, rb.collider_id) {
            let shape_str = match c.collider_type {
                ColliderType::Ball => format!("Ball r={:.2}", c.radius),
                ColliderType::Cuboid => format!(
                    "Cuboid hx={:.2} hy={:.2} hz={:.2}",
                    c.half_extent_x, c.half_extent_y, c.half_extent_z
                ),
                ColliderType::Capsule => format!("Capsule h={:.2} r={:.2}", c.half_height, c.radius),
                _ => format!("{:?}", c.collider_type),
            };
            spacetimedb::log::info!(
                "    collider id={} {} sensor={}",
                c.id, shape_str, c.is_sensor
            );
        } else {
            spacetimedb::log::info!("    collider id={} NOT FOUND", rb.collider_id);
        }
    }
}

/// Check if the server thinks this player's position is inside any wall (sphere-AABB overlap).
/// Call when you're on the wrong side of a wall: if inside_wall=true, Rapier didn't resolve.
#[reducer]
pub fn debug_player_in_wall(ctx: &ReducerContext, player_identity: Identity) {
    let Some(p) = ctx.db.player().identity().find(player_identity) else {
        spacetimedb::log::info!("debug_player_in_wall: player not found");
        return;
    };
    if p.lobby_id == 0 {
        spacetimedb::log::info!("debug_player_in_wall: player not in a lobby");
        return;
    }
    let walls: Vec<MapWall> = ctx
        .db
        .map_wall()
        .iter()
        .filter(|w| w.lobby_id == p.lobby_id)
        .collect();
    let (inside, wall_id) = player_overlaps_wall(p.position_x, p.position_z, 0.5, &walls);
    spacetimedb::log::info!(
        "debug_player_in_wall: identity={:?} pos=({}, {}) inside_wall={} wall_rigid_body_id={:?} walls_count={}",
        player_identity,
        p.position_x,
        p.position_z,
        inside,
        wall_id,
        walls.len()
    );
}

fn player_overlaps_wall(px: f32, pz: f32, radius: f32, walls: &[MapWall]) -> (bool, Option<u64>) {
    for w in walls {
        let min_x = w.position_x - w.size_x / 2.0;
        let max_x = w.position_x + w.size_x / 2.0;
        let min_z = w.position_z - w.size_z / 2.0;
        let max_z = w.position_z + w.size_z / 2.0;
        let cx = px.clamp(min_x, max_x);
        let cz = pz.clamp(min_z, max_z);
        let dist_sq = (px - cx).mul_add(px - cx, (pz - cz) * (pz - cz));
        if dist_sq <= radius * radius {
            return (true, Some(w.rigid_body_id));
        }
    }
    (false, None)
}

// ============================================================================
// INIT REDUCER
// ============================================================================

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    // Create default game config
    ctx.db.game_config().insert(GameConfig {
        id: 0,
        respawn_time_ms: 3000,
        default_health: 100,
        default_max_ammo: 30,
    });

    log::info!("Gyrii server initialized!");
}

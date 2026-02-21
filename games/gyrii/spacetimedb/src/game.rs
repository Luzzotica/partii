// Game state, physics tick, and damage processing

use std::time::Duration;

use spacetimedb::{reducer, table, Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, Timestamp};
use spacetime_rapier::{
    rapier_sensor_collision, step_world, Collider, ColliderType, PhysicsWorld,
    RayCast, RigidBody, RigidBodyType, Trigger, Vec3, Quat,
};

// Import table traits for database access
use crate::collision_groups::{GROUP_BULLET, GROUP_FLOOR, GROUP_GRENADE, GROUP_PLAYER, GROUP_WALL};
use crate::constants::{GRENADE_KNOCKBACK_BASE, HEALTH_SCALE, MAX_HEALTH};
use crate::lobby::{lobby, FriendlyFire, GameMode, Lobby};
use crate::maps::{map_wall, MapWall};
use crate::player::{player, Player};
use crate::constants::BEAM_HALF_WIDTH;
use crate::weapons::{grenade, damage_zone, pending_photon_beam, photon_beam, projectile, Grenade, PendingPhotonBeam, PhotonBeam};

// ============================================================================
// GAME CONFIG
// ============================================================================

#[table(name = game_config, public)]
pub struct GameConfig {
    #[primary_key]
    pub id: u64,
    pub respawn_time_ms: u64,
    pub default_health: i32,
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

/// Debug: identities of players currently inside any photon beam trigger (for client highlight).
#[table(name = debug_photon_beam_target, public)]
pub struct DebugPhotonBeamTarget {
    #[primary_key]
    pub identity: Identity,
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
    #[index(btree)]
    pub lobby_id: u64,
    pub killer_id: Identity,
    pub victim_id: Identity,
    pub weapon_type: String,
    pub timestamp: Timestamp,
}

// ============================================================================
// PENDING EXPLOSION (deferred damage, resolved next tick with raycasts)
// ============================================================================

#[table(name = pending_explosion)]
pub struct PendingExplosion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub world_id: u64,
    pub center_x: f32,
    pub center_y: f32,
    pub center_z: f32,
    pub damage: f32,
    pub radius: f32,
    pub source_id: Identity,
}

#[table(name = pending_explosion_raycast)]
pub struct PendingExplosionRaycast {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// RayCast.id from rapier_raycast. 0 = direct hit (player at center), no raycast.
    pub raycast_id: u64,
    pub target_identity: Identity,
    pub target_rigid_body_id: u64,
    pub center_x: f32,
    pub center_y: f32,
    pub center_z: f32,
    pub damage: f32,
    pub radius: f32,
    pub source_id: Identity,
    pub distance: f32,
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

    // Process pending explosions from last tick: create RayCasts for LOS checks (BEFORE step so they get populated)
    process_pending_explosions_create_raycasts(ctx, world.id);

    // Step the physics simulation (walls are static; players are dynamic and collide)
    step_world(ctx, &world, kinematic_entities);

    // Resolve pending explosion raycasts (damage only when first hit is target player)
    process_pending_explosion_raycasts(ctx);

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
            updated.velocity_y = rb.linear_velocity_y;
            updated.velocity_z = rb.linear_velocity_z;
            updated.server_snapshot_id = ctx.timestamp.to_micros_since_unix_epoch() as u64;
            ctx.db.player().identity().update(updated);
        }
    }

    // Process game logic
    process_grenades(ctx);
    process_projectiles(ctx, world.id);
    process_damage_zones(ctx);
    process_photon_beams(ctx);
    process_respawns(ctx);
    update_player_collision_filters(ctx);

    // Check win conditions
    check_win_conditions(ctx, world.id);

    // Tick-driven shooting: for each player holding shoot, try to fire (weapon handler checks fire rate / charge)
    for player in ctx.db.player().iter() {
        if player.rigid_body_id == 0 || !player.is_alive || !player.is_shooting {
            continue;
        }
        if let Some(rb) = RigidBody::find(ctx, player.rigid_body_id) {
            if rb.world_id != world.id {
                continue;
            }
        }
        if let Err(e) = crate::weapons::try_fire_player(ctx, &player) {
            log::warn!("try_fire_player failed: {}", e);
        }
    }

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
// PENDING EXPLOSION PROCESSING
// ============================================================================

/// Run BEFORE step_world. For each PendingExplosion in this world, create RayCasts to each
/// player in radius and insert PendingExplosionRaycast. Direct hits (distance < 0.01) get raycast_id = 0.
fn process_pending_explosions_create_raycasts(ctx: &ReducerContext, world_id: u64) {
    let pending: Vec<PendingExplosion> = ctx
        .db
        .pending_explosion()
        .world_id()
        .filter(world_id)
        .collect();

    for exp in pending {
        let lobby = match ctx
            .db
            .lobby()
            .iter()
            .find(|l: &Lobby| l.physics_world_id == exp.world_id)
        {
            Some(l) => l,
            None => {
                ctx.db.pending_explosion().id().delete(exp.id);
                continue;
            }
        };

        let center = Vec3::new(exp.center_x, exp.center_y, exp.center_z);

        for player in ctx.db.player().iter() {
            if !player.is_alive || player.lobby_id != lobby.id {
                continue;
            }
            let dx = player.position_x - center.x;
            let dy = player.position_y - center.y;
            let dz = player.position_z - center.z;
            let distance = (dx * dx + dy * dy + dz * dz).sqrt();

            if distance >= exp.radius {
                continue;
            }

            if distance < 0.01 {
                // Direct hit: player at center, no raycast
                ctx.db.pending_explosion_raycast().insert(PendingExplosionRaycast {
                    id: 0,
                    raycast_id: 0,
                    target_identity: player.identity,
                    target_rigid_body_id: player.rigid_body_id,
                    center_x: exp.center_x,
                    center_y: exp.center_y,
                    center_z: exp.center_z,
                    damage: exp.damage,
                    radius: exp.radius,
                    source_id: exp.source_id,
                    distance: 0.0,
                });
            } else {
                let dir = Vec3::new(dx, dy, dz).normalize();
                let max_distance = distance + 0.1;
                let raycast = RayCast::new(exp.world_id, center, dir, max_distance, false).insert(ctx);
                ctx.db.pending_explosion_raycast().insert(PendingExplosionRaycast {
                    id: 0,
                    raycast_id: raycast.id,
                    target_identity: player.identity,
                    target_rigid_body_id: player.rigid_body_id,
                    center_x: exp.center_x,
                    center_y: exp.center_y,
                    center_z: exp.center_z,
                    damage: exp.damage,
                    radius: exp.radius,
                    source_id: exp.source_id,
                    distance,
                });
            }
        }

        ctx.db.pending_explosion().id().delete(exp.id);
    }
}

/// Run AFTER step_world. For each PendingExplosionRaycast, check LOS and apply damage if clear.
fn process_pending_explosion_raycasts(ctx: &ReducerContext) {
    let pending: Vec<PendingExplosionRaycast> = ctx.db.pending_explosion_raycast().iter().collect();

    for p in pending {
        let center = Vec3::new(p.center_x, p.center_y, p.center_z);
        let apply = if p.raycast_id == 0 {
            // Direct hit
            true
        } else {
            match RayCast::find(ctx, p.raycast_id) {
                Some(raycast) => {
                    let first_is_target = raycast
                        .first_hit()
                        .map(|h| h.rigid_body_id == p.target_rigid_body_id)
                        .unwrap_or(false);
                    raycast.delete(ctx);
                    first_is_target
                }
                None => false,
            }
        };

        if apply {
            if let Some(player) = ctx.db.player().identity().find(p.target_identity) {
                if player.is_alive {
                    apply_explosion_damage_to_player(
                        ctx,
                        &player,
                        center,
                        p.distance,
                        p.damage,
                        p.radius,
                        p.source_id,
                    );
                }
            }
        }

        ctx.db.pending_explosion_raycast().id().delete(p.id);
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Check if a player or team has reached the win condition and end the game.
fn check_win_conditions(ctx: &ReducerContext, world_id: u64) {
    let lobby = match ctx
        .db
        .lobby()
        .iter()
        .find(|l: &Lobby| l.physics_world_id == world_id)
    {
        Some(l) => l,
        None => return,
    };

    if lobby.game_state != GameState::InProgress {
        return;
    }

    let lobby_id = lobby.id;

    match lobby.game_mode {
        GameMode::FreeForAll => {
            for p in ctx.db.player().iter() {
                if p.lobby_id == lobby_id && p.kills >= lobby.score_limit {
                    let mut updated = lobby.clone();
                    updated.game_state = GameState::Ended;
                    ctx.db.lobby().id().update(updated);
                    log::info!("Game ended: {} reached {} kills (FFA)", p.name, lobby.score_limit);
                    return;
                }
            }
        }
        GameMode::TeamDeathmatch => {
            let mut team_kills: std::collections::HashMap<i32, i32> = std::collections::HashMap::new();
            for p in ctx.db.player().iter() {
                if p.lobby_id == lobby_id {
                    *team_kills.entry(p.team).or_insert(0) += p.kills;
                }
            }
            for (_team, kills) in team_kills {
                if kills >= lobby.score_limit {
                    let mut updated = lobby.clone();
                    updated.game_state = GameState::Ended;
                    ctx.db.lobby().id().update(updated);
                    log::info!("Game ended: team reached {} kills (TDM)", lobby.score_limit);
                    return;
                }
            }
        }
        GameMode::CaptureTheFlag => {
            let mut team_flags: std::collections::HashMap<i32, i32> = std::collections::HashMap::new();
            for p in ctx.db.player().iter() {
                if p.lobby_id == lobby_id {
                    *team_flags.entry(p.team).or_insert(0) += p.flag_captures;
                }
            }
            for (_team, flags) in team_flags {
                if flags >= lobby.flag_limit {
                    let mut updated = lobby.clone();
                    updated.game_state = GameState::Ended;
                    ctx.db.lobby().id().update(updated);
                    log::info!("Game ended: team reached {} flag captures (CTF)", lobby.flag_limit);
                    return;
                }
            }
        }
    }
}

/// Start the physics tick loop for a world. Inserts a single row with Interval(60 Hz);
/// the scheduler will invoke physics_tick repeatedly without rescheduling each time.
pub fn schedule_physics_tick(ctx: &ReducerContext, world_id: u64) {
    // 60 Hz = ~16.67 ms per tick. Use microseconds so the value is unambiguous (not mistaken for seconds).
    const TICK_INTERVAL_MICROS: u64 = 1_000_000 / 60;
    ctx.db.physics_tick_timer().insert(PhysicsTickTimer {
        scheduled_id: 0, // auto_inc
        scheduled_at: ScheduleAt::Interval(Duration::from_micros(TICK_INTERVAL_MICROS).into()),
        world_id,
    });
}

fn process_grenades(ctx: &ReducerContext) {
    let now_micros = ctx.timestamp.to_micros_since_unix_epoch() as u64;
    let grenades_to_explode: Vec<Grenade> = ctx
        .db
        .grenade()
        .iter()
        .filter(|g| g.expires_at_micros > 0 && now_micros >= g.expires_at_micros)
        .collect();

    for grenade in grenades_to_explode {
        // Get grenade position from rigid body
        if let Some(rb) = RigidBody::find(ctx, grenade.rigid_body_id) {
            let position = rb.position();
            insert_pending_explosion(
                ctx,
                grenade.world_id,
                position,
                grenade.damage,
                grenade.radius,
                grenade.owner_id,
            );
        }

        // Remove grenade and its physics body
        ctx.db.grenade().rigid_body_id().delete(grenade.rigid_body_id);
        if let Some(rb) = RigidBody::find(ctx, grenade.rigid_body_id) {
            rb.delete(ctx);
        }
    }

    // Sync position and velocity from RigidBody on remaining grenades
    for grenade in ctx.db.grenade().iter() {
        let mut updated = grenade.clone();
        if let Some(rb) = RigidBody::find(ctx, grenade.rigid_body_id) {
            updated.position_x = rb.position_x;
            updated.position_y = rb.position_y;
            updated.position_z = rb.position_z;
            updated.velocity_x = rb.linear_velocity_x;
            updated.velocity_y = rb.linear_velocity_y;
            updated.velocity_z = rb.linear_velocity_z;
            if updated.position_y < -0.1 {
                log::warn!(
                    "[grenade] BELOW FLOOR! rb={} pos=({:.2},{:.2},{:.2}) vel=({:.2},{:.2},{:.2})",
                    grenade.rigid_body_id,
                    updated.position_x, updated.position_y, updated.position_z,
                    updated.velocity_x, updated.velocity_y, updated.velocity_z,
                );
            }
        }
        ctx.db.grenade().rigid_body_id().update(updated);
    }
}

fn process_projectiles(ctx: &ReducerContext, world_id: u64) {
    use spacetime_rapier::{RigidBody, RigidBodyProperties};

    let mut to_remove: Vec<u64> = Vec::new();

    // Build set of projectile rigid body IDs (bullets only)
    let projectile_rb_ids: std::collections::HashSet<u64> = ctx
        .db
        .projectile()
        .iter()
        .filter(|p| p.radius <= 0.0)
        .map(|p| p.rigid_body_id)
        .collect();

    // Build map: rigid_body_id -> Player (for players)
    let rb_to_player: std::collections::HashMap<u64, Player> = ctx
        .db
        .player()
        .iter()
        .filter(|p| p.rigid_body_id != 0)
        .map(|p| (p.rigid_body_id, p.clone()))
        .collect();

    // Build map: rigid_body_id -> Grenade (for grenades in this world)
    let rb_to_grenade: std::collections::HashMap<u64, Grenade> = ctx
        .db
        .grenade()
        .iter()
        .filter(|g| g.world_id == world_id)
        .map(|g| (g.rigid_body_id, g.clone()))
        .collect();

    // Process physics-based sensor collisions (populated by step_world)
    let collisions: Vec<_> = ctx.db.rapier_sensor_collision().world_id().filter(world_id).collect();
    for collision in collisions {
        let sensor_rb_id = collision.sensor_rigid_body_id;
        let other_rb_id = collision.other_rigid_body_id;

        if !projectile_rb_ids.contains(&sensor_rb_id) {
            continue; // Not a bullet
        }

        let proj = match ctx.db.projectile().rigid_body_id().find(sensor_rb_id) {
            Some(p) => p,
            None => continue,
        };

        // Bullet hit grenade -> explode grenade
        if let Some(grenade) = rb_to_grenade.get(&other_rb_id) {
            if let Some(rb) = RigidBody::find(ctx, grenade.rigid_body_id) {
                insert_pending_explosion(
                    ctx,
                    grenade.world_id,
                    rb.position(),
                    grenade.damage,
                    grenade.radius,
                    grenade.owner_id,
                );
            }
            ctx.db.grenade().rigid_body_id().delete(grenade.rigid_body_id);
            if let Some(rb) = RigidBody::find(ctx, grenade.rigid_body_id) {
                rb.delete(ctx);
            }
            to_remove.push(sensor_rb_id);
            continue;
        }

        if let Some(hit_player) = rb_to_player.get(&other_rb_id) {
            if !hit_player.is_alive || hit_player.identity == proj.owner_id {
                continue;
            }
            let damage_tenths = (proj.damage * HEALTH_SCALE as f32).round() as i32;
            apply_damage(ctx, hit_player.identity, damage_tenths, proj.owner_id);

            // Impulse = bullet mass × bullet speed, applied in bullet travel direction; delta_v = impulse / player_mass
            let bullet_mass = RigidBody::find(ctx, sensor_rb_id)
                .and_then(|brb| RigidBodyProperties::find(ctx, brb.properties_id))
                .map(|p| p.mass)
                .unwrap_or(0.1);
            let vx = proj.velocity_x;
            let vy = proj.velocity_y;
            let vz = proj.velocity_z;
            let speed_sq = vx * vx + vy * vy + vz * vz;
            if speed_sq > 1e-6 {
                let speed = speed_sq.sqrt();
                let ix = vx / speed;
                let iy = vy / speed;
                let iz = vz / speed;
                let player_mass = RigidBody::find(ctx, other_rb_id)
                    .and_then(|brb| RigidBodyProperties::find(ctx, brb.properties_id))
                    .map(|p| p.mass)
                    .unwrap_or(1.0);
                let impulse_mag = bullet_mass * speed;
                let dv = impulse_mag / player_mass;
                if let Some(mut rb) = RigidBody::find(ctx, other_rb_id) {
                    rb.linear_velocity_x += ix * dv;
                    rb.linear_velocity_y += iy * dv;
                    rb.linear_velocity_z += iz * dv;
                    rb.update(ctx);
                }
                let now_micros = ctx.timestamp.to_micros_since_unix_epoch();
                if let Some(mut hit) = ctx.db.player().identity().find(hit_player.identity) {
                    hit.last_impulse_x = ix * dv;
                    hit.last_impulse_y = iy * dv;
                    hit.last_impulse_z = iz * dv;
                    hit.last_impulse_time = now_micros;
                    ctx.db.player().identity().update(hit);
                }
            }
        }

        to_remove.push(sensor_rb_id);
    }

    // Remove projectiles that have expired (TTL)
    let now_micros = ctx.timestamp.to_micros_since_unix_epoch() as u64;
    for proj in ctx.db.projectile().iter() {
        if proj.expires_at_micros > 0 && now_micros >= proj.expires_at_micros {
            to_remove.push(proj.rigid_body_id);
        }
    }

    for rigid_body_id in to_remove {
        ctx.db.projectile().rigid_body_id().delete(rigid_body_id);
        if let Some(rb) = RigidBody::find(ctx, rigid_body_id) {
            rb.delete(ctx);
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
                        let damage_tenths = zone.damage_per_tick * HEALTH_SCALE;
                        apply_damage(ctx, player.identity, damage_tenths, zone.owner_id);
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

/// S-curve falloff: damage multiplier from 1 (at origin, t=0) to 0 (at end, t=1). t = distance along beam.
fn photon_beam_falloff(t: f32) -> f32 {
    const K: f32 = 10.0;
    let t = t.clamp(0.0, 1.0);
    let x = K * (t - 0.5);
    let sigmoid = 1.0 / (1.0 + (-x).exp());
    1.0 - sigmoid
}

/// Quaternion that rotates local +Y to the given direction.
/// Used with capsule_y (axis along Y) so the beam runs along the given direction.
fn quat_from_y_to_direction(dir: Vec3) -> Quat {
    let y = Vec3::Y;
    let axis = y.cross(dir);
    let len = axis.length();
    if len < 1e-6 {
        if dir.y < 0.0 {
            Quat::from_rotation_z(std::f32::consts::PI)
        } else {
            Quat::IDENTITY
        }
    } else {
        let angle = y.dot(dir).clamp(-1.0, 1.0).acos();
        Quat::from_axis_angle(axis / len, angle)
    }
}

fn process_photon_beams(ctx: &ReducerContext) {
    let player_rb_ids: std::collections::HashSet<u64> = ctx
        .db
        .player()
        .iter()
        .map(|p| p.rigid_body_id)
        .collect();

    // Resolve pending beams: raycast ran last tick; create PhotonBeam with correct end, then delete pending + raycast.
    let pending_list: Vec<PendingPhotonBeam> = ctx.db.pending_photon_beam().iter().collect();
    for pending in pending_list {
        let raycast = match RayCast::find(ctx, pending.raycast_id) {
            Some(r) => r,
            None => continue,
        };
        let origin = Vec3::new(raycast.origin_x, raycast.origin_y, raycast.origin_z);
        let dir_vec = Vec3::new(raycast.direction_x, raycast.direction_y, raycast.direction_z);
        let mut end = Vec3::new(
            origin.x + dir_vec.x * raycast.max_distance,
            origin.y + dir_vec.y * raycast.max_distance,
            origin.z + dir_vec.z * raycast.max_distance,
        );
        if let Some(first_non_player) = raycast
            .hits
            .iter()
            .find(|h| !player_rb_ids.contains(&h.rigid_body_id))
        {
            end = Vec3::new(
                first_non_player.point_x,
                first_non_player.point_y,
                first_non_player.point_z,
            );
        }
        raycast.delete(ctx);
        ctx.db.pending_photon_beam().raycast_id().delete(pending.raycast_id);

        let beam_dir = end - origin;
        let length = beam_dir.length();
        if length < 1e-6 {
            continue;
        }

        let half_length = length * 0.5;
        // Use a capsule: axis along Y in local space, radius = beam cross-section.
        // Rotate so local +Y aligns with beam direction; placed at midpoint.
        let collider = Collider::capsule(pending.world_id, half_length, BEAM_HALF_WIDTH).insert(ctx);

        let midpoint = Vec3::new(
            origin.x + beam_dir.x * 0.5,
            origin.y + beam_dir.y * 0.5,
            origin.z + beam_dir.z * 0.5,
        );
        let dir_n = beam_dir / length;
        let rot = quat_from_y_to_direction(dir_n);

        let trigger = Trigger::builder()
            .world_id(pending.world_id)
            .position_x(midpoint.x)
            .position_y(midpoint.y)
            .position_z(midpoint.z)
            .rotation_x(rot.x)
            .rotation_y(rot.y)
            .rotation_z(rot.z)
            .rotation_w(rot.w)
            .collider_id(collider.id)
            .build()
            .insert(ctx);

        ctx.db.photon_beam().insert(PhotonBeam {
            id: 0,
            owner_id: pending.owner_id,
            origin_x: origin.x,
            origin_y: origin.y,
            origin_z: origin.z,
            end_x: end.x,
            end_y: end.y,
            end_z: end.z,
            raycast_id: 0,
            trigger_id: trigger.id,
            damage_per_tick: pending.damage_per_tick,
            remaining_ticks: pending.remaining_ticks,
            world_id: pending.world_id,
        });
    }

    let debug_in_beam: std::collections::HashSet<Identity> = std::collections::HashSet::new();
    let beams_to_process: Vec<PhotonBeam> = ctx.db.photon_beam().iter().collect();
    for beam in beams_to_process {
        if beam.trigger_id != 0 {
            let trigger = match Trigger::find(ctx, beam.trigger_id) {
                Some(t) => t,
                None => continue,
            };

            let origin = Vec3::new(beam.origin_x, beam.origin_y, beam.origin_z);
            let end = Vec3::new(beam.end_x, beam.end_y, beam.end_z);
            let dir = end - origin;
            let length = dir.length();
            let len_sq = length * length;
            if len_sq < 1e-12 {
                let mut updated = beam.clone();
                updated.remaining_ticks -= 1;
                if updated.remaining_ticks <= 0 {
                    if let Some(t) = Trigger::find(ctx, beam.trigger_id) {
                        if let Some(c) = Collider::find(ctx, t.collider_id) {
                            t.delete(ctx);
                            c.delete(ctx);
                        }
                    }
                    ctx.db.photon_beam().id().delete(beam.id);
                } else {
                    ctx.db.photon_beam().id().update(updated);
                }
                continue;
            }

            for entity_id in &trigger.entities_inside {
                if *entity_id == 0 {
                    continue;
                }
                // Beam hits grenade -> explode grenade
                if let Some(grenade) = ctx.db.grenade().rigid_body_id().find(*entity_id) {
                    if let Some(rb) = RigidBody::find(ctx, grenade.rigid_body_id) {
                        insert_pending_explosion(
                            ctx,
                            grenade.world_id,
                            rb.position(),
                            grenade.damage,
                            grenade.radius,
                            grenade.owner_id,
                        );
                    }
                    ctx.db.grenade().rigid_body_id().delete(grenade.rigid_body_id);
                    if let Some(rb) = RigidBody::find(ctx, grenade.rigid_body_id) {
                        rb.delete(ctx);
                    }
                    continue;
                }
                let hit_player = match ctx.db.player().iter().find(|p| p.rigid_body_id == *entity_id) {
                    Some(p) => p,
                    None => continue,
                };
                // debug_in_beam.insert(hit_player.identity);
                if !hit_player.is_alive || hit_player.identity == beam.owner_id {
                    continue;
                }

                let px = hit_player.position_x;
                let py = hit_player.position_y;
                let pz = hit_player.position_z;
                // t = distance along beam from origin (0) to end (1), for falloff
                let dot = (px - origin.x) * dir.x + (py - origin.y) * dir.y + (pz - origin.z) * dir.z;
                let t = if len_sq > 0.0 { (dot / len_sq).clamp(0.0, 1.0) } else { 0.5 };
                let multiplier = photon_beam_falloff(t);
                let damage_f = beam.damage_per_tick as f32 * multiplier;
                let damage = (damage_f * HEALTH_SCALE as f32).round() as i32;
                let damage = damage.max(1); // Minimum 1 (0.1 health) so you always take damage when in beam
                if damage > 0 {
                    apply_damage(ctx, hit_player.identity, damage, beam.owner_id);
                }
            }

            let mut updated = beam.clone();
            updated.remaining_ticks -= 1;
            if updated.remaining_ticks <= 0 {
                if let Some(t) = Trigger::find(ctx, beam.trigger_id) {
                    let collider_id = t.collider_id;
                    t.delete(ctx);
                    if let Some(c) = Collider::find(ctx, collider_id) {
                        c.delete(ctx);
                    }
                }
                ctx.db.photon_beam().id().delete(beam.id);
            } else {
                ctx.db.photon_beam().id().update(updated);
            }
        }
    }

    // Sync debug highlight table for client
    let current: std::collections::HashSet<_> = ctx.db.debug_photon_beam_target().iter().map(|r| r.identity).collect();
    for id in &debug_in_beam {
        if !current.contains(id) {
            ctx.db.debug_photon_beam_target().insert(DebugPhotonBeamTarget { identity: *id });
        }
    }
    for row in ctx.db.debug_photon_beam_target().iter().collect::<Vec<_>>() {
        if !debug_in_beam.contains(&row.identity) {
            ctx.db.debug_photon_beam_target().identity().delete(row.identity);
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
        updated.health = MAX_HEALTH;
        updated.is_alive = true;
        updated.respawn_at = 0;
        updated.velocity_x = 0.0;
        updated.velocity_y = 0.0;
        updated.velocity_z = 0.0;
        updated.server_snapshot_id = ctx.timestamp.to_micros_since_unix_epoch() as u64;
        // Reset position to spawn point for this lobby's map (from parsed map data)
        let spawn_pos = crate::maps::get_spawn_position(ctx, updated.lobby_id, updated.team as usize);
        updated.position_x = spawn_pos.x;
        updated.position_y = spawn_pos.y;
        updated.position_z = spawn_pos.z;
        updated.spawn_x = spawn_pos.x;
        updated.spawn_y = spawn_pos.y;
        updated.spawn_z = spawn_pos.z;
        ctx.db.player().identity().update(updated);
        // Sync RigidBody so physics state matches (position + zero velocity); re-enable body
        if let Some(mut rb) = RigidBody::find(ctx, rigid_body_id) {
            rb.position_x = spawn_pos.x;
            rb.position_y = spawn_pos.y;
            rb.position_z = spawn_pos.z;
            rb.linear_velocity_x = 0.0;
            rb.linear_velocity_y = 0.0;
            rb.linear_velocity_z = 0.0;
            rb.enabled = true;
            rb.update(ctx);
            // Reset collider filter so player does not collide with others until moved 1 unit
            if let Some(mut col) = Collider::find(ctx, rb.collider_id) {
                col.collision_filter = GROUP_BULLET | GROUP_WALL | GROUP_FLOOR | GROUP_GRENADE;
                col.update(ctx);
            }
        }
    }
}

/// Enable player-vs-player collision once a player has moved at least 1 unit from spawn.
fn update_player_collision_filters(ctx: &ReducerContext) {
    let filter_with_player = GROUP_BULLET | GROUP_WALL | GROUP_FLOOR | GROUP_PLAYER | GROUP_GRENADE;
    for player in ctx.db.player().iter() {
        if !player.is_alive || player.rigid_body_id == 0 {
            continue;
        }
        let dx = player.position_x - player.spawn_x;
        let dy = player.position_y - player.spawn_y;
        let dz = player.position_z - player.spawn_z;
        let dist_sq = dx * dx + dy * dy + dz * dz;
        if dist_sq < 1.0 * 1.0 {
            continue;
        }
        let rb = match RigidBody::find(ctx, player.rigid_body_id) {
            Some(r) => r,
            None => continue,
        };
        let mut collider = match Collider::find(ctx, rb.collider_id) {
            Some(c) => c,
            None => continue,
        };
        if (collider.collision_filter & GROUP_PLAYER) == 0 {
            collider.collision_filter = filter_with_player;
            collider.update(ctx);
        }
    }
}

/// Insert a pending explosion; damage is resolved next tick with raycast LOS checks.
pub fn insert_pending_explosion(
    ctx: &ReducerContext,
    world_id: u64,
    center: Vec3,
    damage: f32,
    radius: f32,
    source_id: Identity,
) {
    ctx.db.pending_explosion().insert(PendingExplosion {
        id: 0,
        world_id,
        center_x: center.x,
        center_y: center.y,
        center_z: center.z,
        damage,
        radius,
        source_id,
    });
}

/// Apply explosion damage and knockback to a single player (used by pending explosion resolver).
fn apply_explosion_damage_to_player(
    ctx: &ReducerContext,
    player: &Player,
    center: Vec3,
    distance: f32,
    max_damage: f32,
    radius: f32,
    source_id: Identity,
) {
    let dx = player.position_x - center.x;
    let dy = player.position_y - center.y;
    let dz = player.position_z - center.z;

    let t = if radius > 1e-6 { distance / radius } else { 0.0 };
    let damage_multiplier = photon_beam_falloff(t);
    let damage_tenths = (max_damage * damage_multiplier * HEALTH_SCALE as f32).round() as i32;
    apply_damage(ctx, player.identity, damage_tenths, source_id);

    let impulse_mag = GRENADE_KNOCKBACK_BASE * damage_multiplier;
    if impulse_mag > 1e-6 && distance > 1e-6 {
        let inv_dist = 1.0 / distance;
        let dir_x = dx * inv_dist;
        let dir_y = dy * inv_dist;
        let dir_z = dz * inv_dist;
        let dv_x = dir_x * impulse_mag;
        let dv_y = dir_y * impulse_mag;
        let dv_z = dir_z * impulse_mag;

        if player.rigid_body_id != 0 {
            if let Some(mut rb) = RigidBody::find(ctx, player.rigid_body_id) {
                rb.linear_velocity_x += dv_x;
                rb.linear_velocity_y += dv_y;
                rb.linear_velocity_z += dv_z;
                rb.update(ctx);
            }
        }
        let now_micros = ctx.timestamp.to_micros_since_unix_epoch();
        if let Some(mut hit) = ctx.db.player().identity().find(player.identity) {
            hit.last_impulse_x = dv_x;
            hit.last_impulse_y = dv_y;
            hit.last_impulse_z = dv_z;
            hit.last_impulse_time = now_micros;
            ctx.db.player().identity().update(hit);
        }
    }
}

pub fn apply_damage(ctx: &ReducerContext, target_id: Identity, damage: i32, source_id: Identity) {
    if let Some(mut player) = ctx.db.player().identity().find(target_id) {
        if !player.is_alive {
            return;
        }

        let mut damage = damage;

        if source_id != target_id {
            if let Some(source_player) = ctx.db.player().identity().find(source_id) {
                if let Some(lobby) = ctx.db.lobby().id().find(player.lobby_id) {
                    let is_team_mode = lobby.game_mode != GameMode::FreeForAll;
                    if is_team_mode && source_player.team == player.team {
                        match lobby.friendly_fire {
                            FriendlyFire::Off => return,
                            FriendlyFire::Reduced => damage = damage / 2,
                            FriendlyFire::Full => {}
                        }
                    }
                }
            }
        }

        player.health -= damage;

        if player.health <= 0 {
            player.health = 0;
            player.is_alive = false;
            player.deaths += 1;
            // Manual respawn: no auto-respawn timer; player uses SpawnLoadoutScreen and request_spawn
            player.respawn_at = 0;

            // Record kill
            if source_id != target_id {
                if let Some(mut killer) = ctx.db.player().identity().find(source_id) {
                    killer.kills += 1;
                    ctx.db.player().identity().update(killer);
                }

                ctx.db.kill_event().insert(KillEvent {
                    id: 0,
                    lobby_id: player.lobby_id,
                    killer_id: source_id,
                    victim_id: target_id,
                    weapon_type: "unknown".to_string(),
                    timestamp: ctx.timestamp,
                });
            }
            // Disable victim's rigid body so it no longer participates in physics
            if player.rigid_body_id > 0 {
                if let Some(mut rb) = RigidBody::find(ctx, player.rigid_body_id) {
                    rb.enabled = false;
                    rb.update(ctx);
                }
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
        default_health: MAX_HEALTH,
    });

    log::info!("Gyrii server initialized!");
}

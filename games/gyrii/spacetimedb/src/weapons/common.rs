// Shared tables and shoot logic used by multiple weapon handlers.
//
// Per-weapon muzzle offset in weapon local space (must match client weaponDisplayConstants.ts):
// -Z = barrel forward, Y = up, X = right. We compute world muzzle from position + aim + offset.

use spacetimedb::{table, Identity, ReducerContext, Table};
use spacetime_rapier::{Collider, RigidBody, RigidBodyProperties, RigidBodyType, RayCast, Vec3};

use crate::collision_groups::{GROUP_BULLET, GROUP_FLOOR, GROUP_GRENADE, GROUP_PLAYER, GROUP_WALL};
use crate::constants::{
    BEAM_DURATION_TICKS, HEALTH_SCALE, PHOTON_RAY_MAX_DISTANCE,
};
use crate::game::apply_damage;
use crate::player::{player, get_weapon_damage, Player, WeaponType};

/// Player mass for recoil impulse (dv = impulse_mag / PLAYER_MASS).
const PLAYER_MASS: f32 = 1.0;

// Re-export table traits for other modules (used by game.rs, etc.)
pub use damage_zone::damage_zone;
pub use grenade::grenade;
pub use projectile::projectile;

// TTL per projectile type (seconds)
const PROJECTILE_TTL_BULLET_SEC: u64 = 20;
const PROJECTILE_TTL_ROCKET_SEC: u64 = 6;

// ============================================================================
// PROJECTILE TABLE (bullets + Bazooka rockets)
// ============================================================================

/// Projectile type for client pool and behavior. 0 = bullet, 1 = rocket.
pub const PROJECTILE_TYPE_BULLET: u8 = 0;
pub const PROJECTILE_TYPE_ROCKET: u8 = 1;

#[derive(Clone)]
#[table(name = projectile, public)]
pub struct Projectile {
    #[primary_key]
    pub rigid_body_id: u64,
    pub owner_id: Identity,
    #[index(btree)]
    pub world_id: u64,
    pub damage: f32,
    pub radius: f32,
    pub can_detonate: bool,
    /// When to expire (micros since unix epoch). 0 = legacy, no TTL.
    pub expires_at_micros: u64,
    /// Spawn position (for client display)
    pub position_x: f32,
    pub position_y: f32,
    pub position_z: f32,
    /// Initial velocity (for client display; server controls spray)
    pub velocity_x: f32,
    pub velocity_y: f32,
    pub velocity_z: f32,
    /// 0 = bullet, 1 = rocket (which pool to use on client)
    pub projectile_type: u8,
    /// Gravity scale for the rigid body (0 = bullets ignore gravity, 1 = rockets/grenades).
    pub gravity_scale: f32,
}

// ============================================================================
// GRENADE TABLE
// ============================================================================

#[derive(Clone)]
#[table(name = grenade, public)]
pub struct Grenade {
    #[primary_key]
    pub rigid_body_id: u64,
    #[index(btree)]
    pub world_id: u64,
    pub owner_id: Identity,
    /// When to explode (micros since unix epoch). 0 = legacy, no TTL.
    pub expires_at_micros: u64,
    pub damage: f32,
    pub radius: f32,
    /// Initial position (for client spawn)
    pub position_x: f32,
    pub position_y: f32,
    pub position_z: f32,
    /// Initial velocity (for client spawn)
    pub velocity_x: f32,
    pub velocity_y: f32,
    pub velocity_z: f32,
}

// ============================================================================
// DAMAGE ZONE TABLE (for Molotov fire)
// ============================================================================

#[derive(Clone)]
#[table(name = damage_zone, public)]
pub struct DamageZone {
    #[primary_key]
    pub trigger_id: u64,
    pub owner_id: Identity,
    pub damage_per_tick: i32,
    pub remaining_ticks: i32,
}

// ============================================================================
// PHOTON BEAM TABLE (charge-up beam: raycast then cuboid sensor, DoT with S-curve)
// ============================================================================

/// Pending beam: created on fire; next physics tick we resolve raycast and insert PhotonBeam with correct end.
#[derive(Clone)]
#[table(name = pending_photon_beam)]
pub struct PendingPhotonBeam {
    #[primary_key]
    pub raycast_id: u64,
    pub owner_id: Identity,
    pub damage_per_tick: i32,
    pub remaining_ticks: i32,
    pub world_id: u64,
}

#[derive(Clone)]
#[table(name = photon_beam, public)]
pub struct PhotonBeam {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner_id: Identity,
    pub origin_x: f32,
    pub origin_y: f32,
    pub origin_z: f32,
    pub end_x: f32,
    pub end_y: f32,
    pub end_z: f32,
    pub raycast_id: u64,
    pub trigger_id: u64,
    pub damage_per_tick: i32,
    pub remaining_ticks: i32,
    #[index(btree)]
    pub world_id: u64,
}

// ============================================================================
// PER-WEAPON MUZZLE OFFSET (weapon local: x=right, y=up, z=forward; -z = barrel)
// ============================================================================

fn muzzle_offset_local(weapon: WeaponType) -> (f32, f32, f32) {
    match weapon {
        WeaponType::DualMachineGun => (-0.38, 0.125, -0.7),
        WeaponType::Smg => (1.0, 0.0, 0.0),
        WeaponType::ChainGun => (1.0, 0.0, 0.0),
        WeaponType::PhotonRifle => (0.0, 0.0, -0.5),
        WeaponType::Bazooka => (1.0, 0.0, 0.0),
        WeaponType::Flamethrower => (1.0, 0.0, 0.0),
    }
}

/// World-space muzzle position from player position, aim direction, and per-weapon local offset.
fn muzzle_world_position(player: &Player) -> Vec3 {
    let mut ax = player.aim_x;
    let mut az = player.aim_z;
    let len_sq = ax * ax + az * az;
    if len_sq < 0.001 {
        ax = 0.0;
        az = -1.0;
    } else {
        let len = len_sq.sqrt();
        ax /= len;
        az /= len;
    }
    let (lx, ly, lz) = muzzle_offset_local(player.weapon);
    // Right = (-az, 0, ax), aim = (ax, 0, az). Muzzle = pos + right*lx + (0,ly,0) + aim*(-lz)
    let x = player.position_x - az * lx - ax * lz;
    let y = 0.5 + ly;
    let z = player.position_z + ax * lx - az * lz;
    Vec3::new(x, y, z)
}

// ============================================================================
// RECOIL IMPULSE HELPER
// ============================================================================

/// Applies a recoil impulse to the shooter: adds velocity change (opposite aim direction)
/// to both RigidBody and Player.velocity. Velocity is synced directly so no last_impulse needed.
fn apply_shooter_recoil_impulse(
    ctx: &ReducerContext,
    player: &Player,
    aim_dir: Vec3,
    impulse_mag: f32,
) {
    let dv = impulse_mag / PLAYER_MASS;
    let ix = -aim_dir.x;
    let iy = -aim_dir.y;
    let iz = -aim_dir.z;
    if player.rigid_body_id != 0 {
        if let Some(mut rb) = RigidBody::find(ctx, player.rigid_body_id) {
            rb.linear_velocity_x += ix * dv;
            rb.linear_velocity_y += iy * dv;
            rb.linear_velocity_z += iz * dv;
            rb.update(ctx);
        }
    }
    if let Some(mut shooter) = ctx.db.player().identity().find(player.identity) {
        shooter.velocity_x += ix * dv;
        shooter.velocity_y += iy * dv;
        shooter.velocity_z += iz * dv;
        ctx.db.player().identity().update(shooter);
    }
}

// ============================================================================
// HITSCAN / BAZOOKA IMPLEMENTATIONS (called by handlers)
// ============================================================================

pub fn shoot_hitscan_impl(
    ctx: &ReducerContext,
    player: &Player,
    world_id: u64,
    damage: i32,
    knockback: f32,
) -> Result<(), String> {
    let aim_dir = Vec3::new(player.aim_x, 0.0, player.aim_z).normalize();
    let start_pos = muzzle_world_position(player);

    let raycast = RayCast::new(
        world_id,
        start_pos,
        aim_dir,
        100.0,
        false,
    ).insert(ctx);

    for hit in &raycast.hits {
        if let Some(hit_player) = ctx.db.player().iter().find(|p| p.rigid_body_id == hit.rigid_body_id) {
            if hit_player.identity != player.identity {
                let damage_tenths = damage * HEALTH_SCALE;
                apply_damage(ctx, hit_player.identity, damage_tenths, player.identity);
                if let Some(mut target) = ctx.db.player().identity().find(hit_player.identity) {
                    target.position_x += aim_dir.x * knockback;
                    target.position_z += aim_dir.z * knockback;
                    ctx.db.player().identity().update(target);
                }
            }
        }
    }

    raycast.delete(ctx);

    // Apply recoil impulse to shooter (impulse magnitude based on knockback)
    let impulse_mag = knockback * 0.5;
    apply_shooter_recoil_impulse(ctx, player, aim_dir, impulse_mag);

    Ok(())
}

/// Create a pending photon beam: RayCast only. Next physics tick process_photon_beams resolves the raycast and inserts PhotonBeam with the correct end (wall hit).
pub fn create_photon_beam(
    ctx: &ReducerContext,
    player: &Player,
    world_id: u64,
) -> Result<(), String> {
    let aim_dir = Vec3::new(player.aim_x, 0.0, player.aim_z).normalize_or_zero();
    let aim_dir = if aim_dir.length_squared() < 0.001 {
        Vec3::new(0.0, 0.0, -1.0)
    } else {
        aim_dir.normalize()
    };
    let start_pos = muzzle_world_position(player);
    let raycast = RayCast::new(world_id, start_pos, aim_dir, PHOTON_RAY_MAX_DISTANCE, false).insert(ctx);
    let total_damage = get_weapon_damage(WeaponType::PhotonRifle);
    let damage_per_tick_tenths = (total_damage * HEALTH_SCALE + BEAM_DURATION_TICKS - 1) / BEAM_DURATION_TICKS;
    let damage_per_tick = damage_per_tick_tenths.max(1);
    ctx.db.pending_photon_beam().insert(PendingPhotonBeam {
        raycast_id: raycast.id,
        owner_id: player.identity,
        damage_per_tick,
        remaining_ticks: BEAM_DURATION_TICKS,
        world_id,
    });

    // Photon rifle recoil: 8x SMG bullet impulse (0.01 * 35 * 8 = 2.8)
    const PHOTON_RECOIL_IMPULSE: f32 = 0.01 * 35.0 * 8.0;
    apply_shooter_recoil_impulse(ctx, player, aim_dir, PHOTON_RECOIL_IMPULSE);

    Ok(())
}

pub fn shoot_bazooka_impl(
    ctx: &ReducerContext,
    player: &Player,
    world_id: u64,
    knockback: f32,
) -> Result<(), String> {
    use spacetime_rapier::RigidBody;

    let aim_dir = Vec3::new(player.aim_x, 0.0, player.aim_z).normalize();
    let start_pos = muzzle_world_position(player);

    let speed = 20.0;
    let velocity = Vec3::new(aim_dir.x * speed, 0.0, aim_dir.z * speed);

    let rb_props = RigidBodyProperties::builder()
        .world_id(world_id)
        .mass(0.5)
        .restitution(0.0)
        .build()
        .insert(ctx);

    let collider = Collider::ball(world_id, 0.2).insert(ctx);

    let rocket_rb = RigidBody::builder()
        .world_id(world_id)
        .position_x(start_pos.x)
        .position_y(start_pos.y)
        .position_z(start_pos.z)
        .linear_velocity_x(velocity.x)
        .linear_velocity_y(velocity.y)
        .linear_velocity_z(velocity.z)
        .collider_id(collider.id)
        .properties_id(rb_props.id)
        .body_type(RigidBodyType::Dynamic)
        .gravity_scale(1.0)
        .build()
        .insert(ctx);

    let now_micros = ctx.timestamp.to_micros_since_unix_epoch() as u64;
    let expires_at = now_micros + PROJECTILE_TTL_ROCKET_SEC * 1_000_000;

    ctx.db.projectile().insert(Projectile {
        rigid_body_id: rocket_rb.id,
        owner_id: player.identity,
        world_id,
        damage: 80.0,
        radius: 5.0,
        can_detonate: true,
        expires_at_micros: expires_at,
        position_x: start_pos.x,
        position_y: start_pos.y,
        position_z: start_pos.z,
        velocity_x: velocity.x,
        velocity_y: velocity.y,
        velocity_z: velocity.z,
        projectile_type: PROJECTILE_TYPE_ROCKET,
        gravity_scale: 1.0,
    });

    // Bazooka recoil: use knockback as impulse magnitude (rocket mass*speed would be 10, too large)
    apply_shooter_recoil_impulse(ctx, player, aim_dir, knockback);

    Ok(())
}

/// Shoot a bullet projectile (for machine gun, etc.) with random spray.
/// radius=0, can_detonate=false — direct hit damage, no explosion.
pub fn shoot_bullet_impl(
    ctx: &ReducerContext,
    player: &Player,
    world_id: u64,
    damage: i32,
    speed: f32,
    spray_radians: f32,
) -> Result<(), String> {
    use spacetime_rapier::RigidBody;

    let mut aim_x = player.aim_x;
    let mut aim_z = player.aim_z;
    let len_sq = aim_x * aim_x + aim_z * aim_z;
    if len_sq < 0.001 {
        aim_x = 0.0;
        aim_z = -1.0;
    } else {
        let len = len_sq.sqrt();
        aim_x /= len;
        aim_z /= len;
    }

    // Add random spray (cone around aim)
    let angle = (ctx.timestamp.to_micros_since_unix_epoch() as u32).wrapping_mul(1103515245).wrapping_add(12345);
    let rand1 = ((angle % 10000) as f32 / 10000.0) * 2.0 - 1.0;
    let rand2 = (((angle >> 16) % 10000) as f32 / 10000.0) * 2.0 - 1.0;
    let spray_angle = rand1 * spray_radians;
    let perp_x = -aim_z;
    let perp_z = aim_x;
    let aim_dir = Vec3::new(
        aim_x + perp_x * spray_angle + aim_x * rand2 * spray_radians * 0.5,
        0.0,
        aim_z + perp_z * spray_angle + aim_z * rand2 * spray_radians * 0.5,
    ).normalize();

    let start_pos = muzzle_world_position(player);

    let velocity = Vec3::new(aim_dir.x * speed, 0.0, aim_dir.z * speed);

    let rb_props = RigidBodyProperties::builder()
        .world_id(world_id)
        .mass(0.01)
        .restitution(0.0)
        .linear_damping(0.0)
        .ccd_enabled(true)
        .build()
        .insert(ctx);

    let mut collider = Collider::ball(world_id, 0.16);
    collider.is_sensor = true;
    collider.collision_memberships = GROUP_BULLET;
    collider.collision_filter = GROUP_PLAYER | GROUP_WALL | GROUP_FLOOR | GROUP_GRENADE;
    let collider = collider.insert(ctx);

    let bullet_rb = RigidBody::builder()
        .world_id(world_id)
        .position_x(start_pos.x)
        .position_y(start_pos.y)
        .position_z(start_pos.z)
        .linear_velocity_x(velocity.x)
        .linear_velocity_y(velocity.y)
        .linear_velocity_z(velocity.z)
        .collider_id(collider.id)
        .properties_id(rb_props.id)
        .body_type(RigidBodyType::Dynamic)
        .gravity_scale(0.0)
        .build()
        .insert(ctx);

    let now_micros = ctx.timestamp.to_micros_since_unix_epoch() as u64;
    let expires_at = now_micros + PROJECTILE_TTL_BULLET_SEC * 1_000_000;

    ctx.db.projectile().insert(Projectile {
        rigid_body_id: bullet_rb.id,
        owner_id: player.identity,
        world_id,
        damage: damage as f32,
        radius: 0.0,       // Direct hit, no explosion
        can_detonate: false,
        expires_at_micros: expires_at,
        position_x: start_pos.x,
        position_y: start_pos.y,
        position_z: start_pos.z,
        velocity_x: velocity.x,
        velocity_y: velocity.y,
        velocity_z: velocity.z,
        projectile_type: PROJECTILE_TYPE_BULLET,
        gravity_scale: 0.0,
    });

    // Recoil: impulse = bullet_mass * speed (user spec: SMG uses speed + mass of bullets)
    const BULLET_MASS: f32 = 0.01;
    let impulse_mag = BULLET_MASS * speed;
    let aim_dir = Vec3::new(aim_x, 0.0, aim_z).normalize();
    apply_shooter_recoil_impulse(ctx, player, aim_dir, impulse_mag);

    Ok(())
}

//! Weapon tuning data – single place for balancing. Edit values here to tune the game.

use crate::state::WeaponType;

/// Beam weapon config (photon rifle and similar). Only present on beam-type weapons.
#[derive(Clone, Copy, Debug)]
pub struct PhotonBeamConfig {
    pub charge_micros: i64,
    pub recoil_impulse: f32,
    pub beam_radius: f32,
    /// 1.0 at muzzle → (1 - damage_falloff) at beam end. E.g. 0.6 = 40% at end.
    pub damage_falloff: f32,
    pub total_damage: f32,
}

/// Projectile config for weapons that fire physical bullets/pellets.
#[derive(Clone, Copy, Debug)]
pub struct ProjectileConfig {
    pub speed: f32,
    pub spray_radians: f32,
    /// Distance at 50% damage (S-curve). 0 = no falloff.
    pub falloff_range: f32,
    pub falloff_k: f32,
    pub recoil_impulse: f32,
    pub ttl_micros: u64,
    pub mass: f32,
    /// Protocol value: 0=bullet, 2=shotgun.
    pub projectile_type: u8,
    /// None = one projectile per shot. Some(n) = shotgun, n pellets per shot.
    pub pellets: Option<u32>,
}

/// Per-weapon configuration. All tunable values in one struct.
#[derive(Clone, Copy, Debug)]
pub struct WeaponConfig {
    /// Display name (e.g. "dualMachineGun", "shotgun").
    pub name: &'static str,
    /// Base damage (display/stats). For shotgun, damage per pellet.
    pub damage: i32,
    /// Fire rate in milliseconds between shots. Stored as ms for readability.
    pub fire_rate_ms: i64,
    /// Muzzle offset in local space (x=right, y=up, z=forward; -z = barrel).
    pub muzzle_offset: (f32, f32, f32),
    /// Beam weapon config. Only Some for PhotonRifle (and future beam weapons).
    pub photon: Option<PhotonBeamConfig>,
    /// Projectile config. Some for bullet/shotgun weapons.
    pub projectile: Option<ProjectileConfig>,
}

impl WeaponConfig {
    pub fn fire_rate_micros(&self) -> i64 {
        self.fire_rate_ms * 1000
    }
}

/// Common bullet projectile config (SMG, ChainGun, DualMG, Bazooka, Flamethrower).
const BULLET_PROJECTILE: ProjectileConfig = ProjectileConfig {
    speed: 35.0,
    spray_radians: 0.06,
    falloff_range: 15.0,
    falloff_k: 6.0,
    recoil_impulse: 0.24,
    ttl_micros: 20_000_000,  // 20 sec
    mass: 0.01,
    projectile_type: 0,
    pellets: None,
};

/// Shotgun projectile config.
const SHOTGUN_PROJECTILE: ProjectileConfig = ProjectileConfig {
    speed: 35.0,
    spray_radians: 0.35,
    falloff_range: 15.0,
    falloff_k: 6.0,
    recoil_impulse: 0.72,  // 3× bullet
    ttl_micros: 500_000,   // 0.5 sec
    mass: 0.01,
    projectile_type: 2,
    pellets: Some(6),
};

/// Lookup weapon config. All tuning lives here – edit this match to balance.
pub fn weapon_config(w: WeaponType) -> &'static WeaponConfig {
    use WeaponType::*;
    static SMG: WeaponConfig = WeaponConfig {
        name: "smg",
        damage: 8,
        fire_rate_ms: 67,
        muzzle_offset: (1.0, 0.0, 0.0),
        photon: None,
        projectile: Some(BULLET_PROJECTILE),
    };
    static DUAL_MACHINE_GUN: WeaponConfig = WeaponConfig {
        name: "dualMachineGun",
        damage: 6,
        fire_rate_ms: 50,
        muzzle_offset: (-0.38, 0.125, -0.7),
        photon: None,
        projectile: Some(BULLET_PROJECTILE),
    };
    static CHAIN_GUN: WeaponConfig = WeaponConfig {
        name: "chainGun",
        damage: 5,
        fire_rate_ms: 33,
        muzzle_offset: (1.0, 0.0, 0.0),
        photon: None,
        projectile: Some(BULLET_PROJECTILE),
    };
    static PHOTON_RIFLE: WeaponConfig = WeaponConfig {
        name: "photonRifle",
        damage: 115,
        fire_rate_ms: 2000,
        muzzle_offset: (0.0, 0.0, -0.5),
        photon: Some(PhotonBeamConfig {
            charge_micros: 1_200_000,  // 1.2 sec charge
            recoil_impulse: 2.0,
            beam_radius: 0.6,
            damage_falloff: 0.6,  // 40% damage at beam end
            total_damage: 120.0,
        }),
        projectile: None,
    };
    static BAZOOKA: WeaponConfig = WeaponConfig {
        name: "bazooka",
        damage: 80,
        fire_rate_ms: 800,
        muzzle_offset: (1.0, 0.0, 0.0),
        photon: None,
        projectile: Some(BULLET_PROJECTILE),
    };
    static FLAMETHROWER: WeaponConfig = WeaponConfig {
        name: "flamethrower",
        damage: 4,
        fire_rate_ms: 50,
        muzzle_offset: (1.0, 0.0, 0.0),
        photon: None,
        projectile: Some(BULLET_PROJECTILE),
    };
    static SHOTGUN: WeaponConfig = WeaponConfig {
        name: "shotgun",
        damage: 27,   // per pellet; 6 pellets × 17 ≈ 102, all hit = death (100 HP)
        fire_rate_ms: 900,  // ~1.1 shots/sec
        muzzle_offset: (-0.38, 0.125, -0.7),
        photon: None,
        projectile: Some(SHOTGUN_PROJECTILE),
    };
    match w {
        Smg => &SMG,
        DualMachineGun => &DUAL_MACHINE_GUN,
        ChainGun => &CHAIN_GUN,
        PhotonRifle => &PHOTON_RIFLE,
        Bazooka => &BAZOOKA,
        Flamethrower => &FLAMETHROWER,
        Shotgun => &SHOTGUN,
    }
}

/// Convenience: damage for a weapon.
pub fn weapon_damage(w: WeaponType) -> i32 {
    weapon_config(w).damage
}

/// Convenience: fire rate in microseconds.
pub fn weapon_fire_rate_micros(w: WeaponType) -> i64 {
    weapon_config(w).fire_rate_micros()
}

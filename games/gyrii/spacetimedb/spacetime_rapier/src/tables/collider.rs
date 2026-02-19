//! Collider table - collision shapes for rigid bodies

use bon::Builder;
use spacetimedb::{table, ReducerContext, SpacetimeType, Table};
use crate::math::Vec3;

#[cfg(feature = "dim2")]
use crate::math::Vec2;

pub type ColliderId = u64;

/// Type of collider shape
#[derive(SpacetimeType, Debug, Clone, Copy, PartialEq, Default)]
pub enum ColliderType {
    /// Sphere/Ball shape (radius)
    #[default]
    Ball,
    /// Box/Cuboid shape (half-extents)
    Cuboid,
    /// Capsule shape (half-height, radius)
    Capsule,
    /// Cylinder shape (half-height, radius) - 3D only
    Cylinder,
    /// Cone shape (half-height, radius) - 3D only
    Cone,
    /// Triangle shape (3 vertices)
    Triangle,
    /// Heightfield - not yet implemented
    Heightfield,
    /// Half-space (infinite plane): solid region in direction of normal. Uses normal_x, normal_y, normal_z.
    HalfSpace,
}

/// A collider (collision shape) in the physics simulation
#[table(name = rapier_collider, public)]
#[derive(Builder, Clone, Copy, Debug, Default, PartialEq)]
#[builder(derive(Debug, Clone))]
pub struct Collider {
    #[primary_key]
    #[auto_inc]
    #[builder(default = 0)]
    pub id: u64,

    /// Which physics world this collider belongs to
    #[index(btree)]
    #[builder(default = 1)]
    pub world_id: u64,

    /// Type of shape
    #[builder(default = ColliderType::default())]
    pub collider_type: ColliderType,

    // Shape parameters - interpretation depends on collider_type
    /// For Ball: radius
    /// For Capsule/Cylinder/Cone: radius
    #[builder(default = 0.5)]
    pub radius: f32,

    /// For Capsule/Cylinder/Cone: half-height
    #[builder(default = 0.5)]
    pub half_height: f32,

    // For Cuboid: half-extents
    #[builder(default = 0.5)]
    pub half_extent_x: f32,
    #[builder(default = 0.5)]
    pub half_extent_y: f32,
    #[builder(default = 0.5)]
    pub half_extent_z: f32,

    // For Triangle: vertices
    #[builder(default = 0.0)]
    pub vertex_a_x: f32,
    #[builder(default = 0.0)]
    pub vertex_a_y: f32,
    #[builder(default = 0.0)]
    pub vertex_a_z: f32,
    #[builder(default = 1.0)]
    pub vertex_b_x: f32,
    #[builder(default = 0.0)]
    pub vertex_b_y: f32,
    #[builder(default = 0.0)]
    pub vertex_b_z: f32,
    #[builder(default = 0.5)]
    pub vertex_c_x: f32,
    #[builder(default = 1.0)]
    pub vertex_c_y: f32,
    #[builder(default = 0.0)]
    pub vertex_c_z: f32,

    /// Whether this is a sensor (trigger) - no physical response
    #[builder(default = false)]
    pub is_sensor: bool,

    /// Collision group membership (bits). Default 0xFFFF = all.
    #[builder(default = 0xFFFFu32)]
    pub collision_memberships: u32,

    /// Collision group filter (bits). Default 0xFFFF = all.
    #[builder(default = 0xFFFFu32)]
    pub collision_filter: u32,

    /// For HalfSpace: plane outward normal x (unit vector)
    #[builder(default = 0.0)]
    pub normal_x: f32,
    /// For HalfSpace: plane outward normal y
    #[builder(default = 1.0)]
    pub normal_y: f32,
    /// For HalfSpace: plane outward normal z
    #[builder(default = 0.0)]
    pub normal_z: f32,
}

impl Collider {
    /// Insert this collider into the database
    pub fn insert(self, ctx: &ReducerContext) -> Self {
        ctx.db.rapier_collider().insert(self)
    }

    /// Find a collider by ID
    pub fn find(ctx: &ReducerContext, id: ColliderId) -> Option<Self> {
        ctx.db.rapier_collider().id().find(id)
    }

    /// Get all colliders in a world
    pub fn all_in_world(ctx: &ReducerContext, world_id: u64) -> impl Iterator<Item = Self> + '_ {
        ctx.db.rapier_collider().world_id().filter(world_id)
    }

    /// Update this collider in the database
    pub fn update(self, ctx: &ReducerContext) -> Self {
        ctx.db.rapier_collider().id().update(self)
    }

    /// Delete this collider from the database
    pub fn delete(&self, ctx: &ReducerContext) {
        ctx.db.rapier_collider().id().delete(self.id);
    }

    // Factory methods

    /// Create a ball/sphere collider
    pub fn ball(world_id: u64, radius: f32) -> Self {
        Self {
            id: 0,
            world_id,
            collider_type: ColliderType::Ball,
            radius,
            ..Default::default()
        }
    }

    /// Create a cuboid/box collider from half-extents
    pub fn cuboid(world_id: u64, half_extents: Vec3) -> Self {
        Self {
            id: 0,
            world_id,
            collider_type: ColliderType::Cuboid,
            half_extent_x: half_extents.x,
            half_extent_y: half_extents.y,
            half_extent_z: half_extents.z,
            ..Default::default()
        }
    }

    /// Create a capsule collider
    pub fn capsule(world_id: u64, half_height: f32, radius: f32) -> Self {
        Self {
            id: 0,
            world_id,
            collider_type: ColliderType::Capsule,
            half_height,
            radius,
            ..Default::default()
        }
    }

    /// Create a cylinder collider (3D only)
    pub fn cylinder(world_id: u64, half_height: f32, radius: f32) -> Self {
        Self {
            id: 0,
            world_id,
            collider_type: ColliderType::Cylinder,
            half_height,
            radius,
            ..Default::default()
        }
    }

    /// Create a cone collider (3D only)
    pub fn cone(world_id: u64, half_height: f32, radius: f32) -> Self {
        Self {
            id: 0,
            world_id,
            collider_type: ColliderType::Cone,
            half_height,
            radius,
            ..Default::default()
        }
    }

    /// Create a half-space collider (infinite plane). Normal points to the "solid" side.
    /// E.g. floor at y=0 with normal (0, 1, 0) has solid below the plane.
    pub fn halfspace(world_id: u64, normal_x: f32, normal_y: f32, normal_z: f32) -> Self {
        Self {
            id: 0,
            world_id,
            collider_type: ColliderType::HalfSpace,
            normal_x,
            normal_y,
            normal_z,
            ..Default::default()
        }
    }

    /// Create a triangle collider
    pub fn triangle(world_id: u64, a: Vec3, b: Vec3, c: Vec3) -> Self {
        Self {
            id: 0,
            world_id,
            collider_type: ColliderType::Triangle,
            vertex_a_x: a.x,
            vertex_a_y: a.y,
            vertex_a_z: a.z,
            vertex_b_x: b.x,
            vertex_b_y: b.y,
            vertex_b_z: b.z,
            vertex_c_x: c.x,
            vertex_c_y: c.y,
            vertex_c_z: c.z,
            ..Default::default()
        }
    }

    /// Get half-extents as Vec3 (for Cuboid)
    pub fn half_extents(&self) -> Vec3 {
        Vec3::new(self.half_extent_x, self.half_extent_y, self.half_extent_z)
    }

    // 2D factory methods
    #[cfg(feature = "dim2")]
    pub fn cuboid_2d(world_id: u64, half_extents: Vec2) -> Self {
        Self {
            id: 0,
            world_id,
            collider_type: ColliderType::Cuboid,
            half_extent_x: half_extents.x,
            half_extent_y: half_extents.y,
            half_extent_z: 0.0,
            ..Default::default()
        }
    }
}

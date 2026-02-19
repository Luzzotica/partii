//! RigidBody table - physics bodies in the simulation

use bon::Builder;
use spacetimedb::{table, ReducerContext, SpacetimeType, Table};
use crate::math::{Vec3, Quat};

#[cfg(feature = "dim2")]
use crate::math::Vec2;

pub type RigidBodyId = u64;

/// Type of rigid body
#[derive(SpacetimeType, Debug, Clone, Copy, PartialEq, Default)]
pub enum RigidBodyType {
    /// Static bodies never move
    Static,
    /// Dynamic bodies are affected by forces and collisions
    #[default]
    Dynamic,
    /// Kinematic bodies are controlled externally (e.g., by player input)
    Kinematic,
}

/// A rigid body in the physics simulation
#[table(name = rapier_rigid_body, public)]
#[derive(Builder, Clone, Copy, Debug, Default, PartialEq)]
#[builder(derive(Debug, Clone))]
pub struct RigidBody {
    #[primary_key]
    #[auto_inc]
    #[builder(default = 0)]
    pub id: u64,

    /// Which physics world this body belongs to
    #[index(btree)]
    #[builder(default = 1)]
    pub world_id: u64,

    // Position
    #[builder(default = 0.0)]
    pub position_x: f32,
    #[builder(default = 0.0)]
    pub position_y: f32,
    #[builder(default = 0.0)]
    pub position_z: f32,

    // Rotation (quaternion for 3D, just z component used for 2D)
    #[builder(default = 0.0)]
    pub rotation_x: f32,
    #[builder(default = 0.0)]
    pub rotation_y: f32,
    #[builder(default = 0.0)]
    pub rotation_z: f32,
    #[builder(default = 1.0)]
    pub rotation_w: f32,

    // Linear velocity
    #[builder(default = 0.0)]
    pub linear_velocity_x: f32,
    #[builder(default = 0.0)]
    pub linear_velocity_y: f32,
    #[builder(default = 0.0)]
    pub linear_velocity_z: f32,

    // Angular velocity
    #[builder(default = 0.0)]
    pub angular_velocity_x: f32,
    #[builder(default = 0.0)]
    pub angular_velocity_y: f32,
    #[builder(default = 0.0)]
    pub angular_velocity_z: f32,

    /// Type of body (Static, Dynamic, Kinematic)
    #[builder(default = RigidBodyType::default())]
    pub body_type: RigidBodyType,

    /// ID of the collider attached to this body
    pub collider_id: u64,

    /// ID of the properties (mass, friction, restitution)
    pub properties_id: u64,

    /// Scaling factor for gravity (0 = ignore gravity, 1 = full). Default 1.0.
    #[builder(default = 1.0)]
    pub gravity_scale: f32,

    /// Whether this body is currently enabled
    #[builder(default = true)]
    pub enabled: bool,
}

impl RigidBody {
    /// Insert this body into the database
    pub fn insert(self, ctx: &ReducerContext) -> Self {
        ctx.db.rapier_rigid_body().insert(self)
    }

    /// Find a body by ID
    pub fn find(ctx: &ReducerContext, id: RigidBodyId) -> Option<Self> {
        ctx.db.rapier_rigid_body().id().find(id)
    }

    /// Get all bodies in a world
    pub fn all_in_world(ctx: &ReducerContext, world_id: u64) -> impl Iterator<Item = Self> + '_ {
        ctx.db.rapier_rigid_body().world_id().filter(world_id)
    }

    /// Update this body in the database
    pub fn update(self, ctx: &ReducerContext) -> Self {
        ctx.db.rapier_rigid_body().id().update(self)
    }

    /// Delete this body from the database
    pub fn delete(&self, ctx: &ReducerContext) {
        ctx.db.rapier_rigid_body().id().delete(self.id);
    }

    /// Get position as Vec3
    pub fn position(&self) -> Vec3 {
        Vec3::new(self.position_x, self.position_y, self.position_z)
    }

    /// Set position from Vec3
    pub fn set_position(&mut self, pos: Vec3) {
        self.position_x = pos.x;
        self.position_y = pos.y;
        self.position_z = pos.z;
    }

    /// Get rotation as Quat
    pub fn rotation(&self) -> Quat {
        Quat::new(self.rotation_x, self.rotation_y, self.rotation_z, self.rotation_w)
    }

    /// Set rotation from Quat
    pub fn set_rotation(&mut self, rot: Quat) {
        self.rotation_x = rot.x;
        self.rotation_y = rot.y;
        self.rotation_z = rot.z;
        self.rotation_w = rot.w;
    }

    /// Get linear velocity as Vec3
    pub fn linear_velocity(&self) -> Vec3 {
        Vec3::new(self.linear_velocity_x, self.linear_velocity_y, self.linear_velocity_z)
    }

    /// Set linear velocity from Vec3
    pub fn set_linear_velocity(&mut self, vel: Vec3) {
        self.linear_velocity_x = vel.x;
        self.linear_velocity_y = vel.y;
        self.linear_velocity_z = vel.z;
    }

    /// Get angular velocity as Vec3
    pub fn angular_velocity(&self) -> Vec3 {
        Vec3::new(self.angular_velocity_x, self.angular_velocity_y, self.angular_velocity_z)
    }

    /// Set angular velocity from Vec3
    pub fn set_angular_velocity(&mut self, vel: Vec3) {
        self.angular_velocity_x = vel.x;
        self.angular_velocity_y = vel.y;
        self.angular_velocity_z = vel.z;
    }

    /// Check if this is a dynamic body
    pub fn is_dynamic(&self) -> bool {
        self.body_type == RigidBodyType::Dynamic
    }

    /// Check if this is a kinematic body
    pub fn is_kinematic(&self) -> bool {
        self.body_type == RigidBodyType::Kinematic
    }

    /// Check if this is a static body
    pub fn is_static(&self) -> bool {
        self.body_type == RigidBodyType::Static
    }

    // 2D helpers
    #[cfg(feature = "dim2")]
    pub fn position_2d(&self) -> Vec2 {
        Vec2::new(self.position_x, self.position_y)
    }

    #[cfg(feature = "dim2")]
    pub fn set_position_2d(&mut self, pos: Vec2) {
        self.position_x = pos.x;
        self.position_y = pos.y;
    }

    #[cfg(feature = "dim2")]
    pub fn rotation_angle(&self) -> f32 {
        // Extract Z rotation from quaternion
        2.0 * self.rotation_z.atan2(self.rotation_w)
    }

    #[cfg(feature = "dim2")]
    pub fn set_rotation_angle(&mut self, angle: f32) {
        let half = angle / 2.0;
        self.rotation_x = 0.0;
        self.rotation_y = 0.0;
        self.rotation_z = half.sin();
        self.rotation_w = half.cos();
    }
}

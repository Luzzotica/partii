//! SpacetimeDB table definitions for physics entities
//!
//! All tables use helper methods to avoid trait import issues:
//! - `Entity::find(ctx, id)` instead of `ctx.db.entity().id().find(id)`
//! - `Entity::insert(self, ctx)` instead of `ctx.db.entity().insert(self)`

mod physics_world;
mod rigid_body;
mod collider;
mod properties;
mod trigger;
mod raycast;
mod sensor_collision;

pub use physics_world::*;
pub use rigid_body::*;
pub use collider::*;
pub use properties::*;
pub use trigger::*;
pub use raycast::*;
pub use sensor_collision::*;

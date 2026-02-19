// Weapon handler trait: each weapon implements on_input, can_fire, fire.

use spacetimedb::{Identity, ReducerContext};

use crate::player::Player;

pub trait WeaponHandler {
    /// Update weapon-specific component state when shoot button state changes.
    fn on_input(&self, ctx: &ReducerContext, identity: Identity, is_shooting: bool);

    /// Return true if the weapon is allowed to fire this tick (fire rate, charge complete, etc.).
    fn can_fire(&self, ctx: &ReducerContext, player: &Player) -> bool;

    /// Perform the shot and update last_shot_at; clear charge state if applicable.
    fn fire(
        &self,
        ctx: &ReducerContext,
        player: &Player,
        world_id: u64,
    ) -> Result<(), String>;
}

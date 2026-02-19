// Bazooka: projectile weapon.

use spacetimedb::ReducerContext;
use crate::player::player;

use crate::player::{get_weapon_fire_rate_ms, get_weapon_knockback, Player, WeaponType};
use crate::weapons::common::shoot_bazooka_impl;
use crate::weapons::handler::WeaponHandler;

pub struct BazookaHandler;

impl WeaponHandler for BazookaHandler {
    fn on_input(&self, _ctx: &ReducerContext, _identity: spacetimedb::Identity, _is_shooting: bool) {
        // No charge/component state for bazooka
    }

    fn can_fire(&self, ctx: &ReducerContext, player: &Player) -> bool {
        if !player.is_shooting || !player.is_alive {
            return false;
        }
        let now = ctx.timestamp.to_micros_since_unix_epoch();
        let fire_rate_micros = get_weapon_fire_rate_ms(WeaponType::Bazooka) * 1000;
        now - player.last_shot_at >= fire_rate_micros
    }

    fn fire(
        &self,
        ctx: &ReducerContext,
        player: &Player,
        world_id: u64,
    ) -> Result<(), String> {
        let knockback = get_weapon_knockback(WeaponType::Bazooka);
        shoot_bazooka_impl(ctx, player, world_id, knockback)?;

        let now = ctx.timestamp.to_micros_since_unix_epoch();
        if let Some(mut p) = ctx.db.player().identity().find(player.identity) {
            p.last_shot_at = now;
            ctx.db.player().identity().update(p);
        }
        Ok(())
    }
}

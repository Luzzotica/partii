// Hitscan weapons: SMG, Dual Machine Gun, Chain Gun, Flamethrower (no charge).

use spacetimedb::ReducerContext;
use crate::player::player;

use crate::player::{get_weapon_damage, get_weapon_fire_rate_ms, get_weapon_knockback, Player};
use crate::weapons::common::shoot_hitscan_impl;
use crate::weapons::handler::WeaponHandler;

pub struct HitscanHandler;

impl WeaponHandler for HitscanHandler {
    fn on_input(&self, _ctx: &ReducerContext, _identity: spacetimedb::Identity, _is_shooting: bool) {
        // No component state for standard hitscan
    }

    fn can_fire(&self, ctx: &ReducerContext, player: &Player) -> bool {
        if !player.is_shooting || !player.is_alive {
            return false;
        }
        let now = ctx.timestamp.to_micros_since_unix_epoch();
        let fire_rate_micros = get_weapon_fire_rate_ms(player.weapon) * 1000;
        now - player.last_shot_at >= fire_rate_micros
    }

    fn fire(
        &self,
        ctx: &ReducerContext,
        player: &Player,
        world_id: u64,
    ) -> Result<(), String> {
        let damage = get_weapon_damage(player.weapon);
        let knockback = get_weapon_knockback(player.weapon);
        shoot_hitscan_impl(ctx, player, world_id, damage, knockback)?;

        let now = ctx.timestamp.to_micros_since_unix_epoch();
        if let Some(mut p) = ctx.db.player().identity().find(player.identity) {
            p.last_shot_at = now;
            ctx.db.player().identity().update(p);
        }
        Ok(())
    }
}

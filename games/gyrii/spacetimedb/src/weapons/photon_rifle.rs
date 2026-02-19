// Photon Rifle: charge-up weapon; state in PhotonRifleCharge component table.

use spacetimedb::{table, Identity, ReducerContext, Table};
use crate::player::player;

use crate::player::{get_weapon_fire_rate_ms, Player, WeaponType};
use crate::weapons::handler::WeaponHandler;
use crate::weapons::common::create_photon_beam;

/// Charge time before beam fires; client bar uses same value so 100% aligns with fire.
const CHARGE_DURATION_MS: i64 = 1200;

// ============================================================================
// PHOTON RIFLE CHARGE COMPONENT (ECS-style state)
// ============================================================================

#[derive(Clone)]
#[table(name = photon_rifle_charge, public)]
pub struct PhotonRifleCharge {
    #[primary_key]
    pub identity: Identity,
    pub charge_started_at: i64,
}

// ============================================================================
// PHOTON RIFLE HANDLER
// ============================================================================

pub struct PhotonRifleHandler;

impl WeaponHandler for PhotonRifleHandler {
    fn on_input(&self, ctx: &ReducerContext, identity: Identity, is_shooting: bool) {
        if is_shooting {
            let now = ctx.timestamp.to_micros_since_unix_epoch();
            if let Some(existing) = ctx.db.photon_rifle_charge().identity().find(identity) {
                // Already charging, leave as is
                let _ = existing;
            } else {
                ctx.db.photon_rifle_charge().insert(PhotonRifleCharge {
                    identity,
                    charge_started_at: now,
                });
            }
        } else {
            ctx.db.photon_rifle_charge().identity().delete(identity);
        }
    }

    fn can_fire(&self, ctx: &ReducerContext, player: &Player) -> bool {
        if !player.is_shooting || !player.is_alive {
            return false;
        }
        let now = ctx.timestamp.to_micros_since_unix_epoch();
        let fire_rate_micros = get_weapon_fire_rate_ms(WeaponType::PhotonRifle) * 1000;
        if now - player.last_shot_at < fire_rate_micros {
            return false;
        }
        let charge = match ctx.db.photon_rifle_charge().identity().find(player.identity) {
            Some(c) => c,
            None => return false,
        };
        let charge_elapsed_micros = now - charge.charge_started_at;
        charge_elapsed_micros >= CHARGE_DURATION_MS * 1000
    }

    fn fire(
        &self,
        ctx: &ReducerContext,
        player: &Player,
        world_id: u64,
    ) -> Result<(), String> {
        create_photon_beam(ctx, player, world_id)?;

        let now = ctx.timestamp.to_micros_since_unix_epoch();
        if let Some(mut p) = ctx.db.player().identity().find(player.identity) {
            p.last_shot_at = now;
            ctx.db.player().identity().update(p);
        }
        ctx.db.photon_rifle_charge().identity().delete(player.identity);
        Ok(())
    }
}

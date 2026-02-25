import {
  canonicalPlayerId,
  identityToHex,
  PendingShotEvent,
  useGyriiStore,
  WeaponType,
} from "../../store/gameStore";
import type { DbConnection } from "../../generated";
import { SubscriptionHandle } from "../../generated";
import { registerLobbyEntity } from "./registry";
import type { LobbyContext } from "./types";

let subscriptionHandle: SubscriptionHandle | null = null;

registerLobbyEntity({
  filter: "world_id",
  table: "projectile",
  subscribe(conn, context) {
    subscriptionHandle = conn
      .subscriptionBuilder()
      .onApplied(() => {})
      .subscribe([
        `SELECT * FROM projectile WHERE world_id = ${context.worldId}`,
      ]);
  },
  unsubscribe() {
    if (subscriptionHandle != null && subscriptionHandle.isActive()) {
      subscriptionHandle.unsubscribe();
      subscriptionHandle = null;
    }
  },
  setupRowCallbacks(conn) {
    conn.db.projectile.onInsert((_ctx: any, row: any) => {
      const ownerIdHex = identityToHex(row.ownerId);
      if (!ownerIdHex) return;
      const projectileType = row.projectileType ?? row.projectile_type ?? 0;
      const weapon: WeaponType =
        projectileType === 1
          ? "bazooka"
          : projectileType === 2
            ? "shotgun"
            : "dualMachineGun";
      const position = {
        x: row.positionX ?? row.position_x ?? 0,
        y: row.positionY ?? row.position_y ?? 0,
        z: row.positionZ ?? row.position_z ?? 0,
      };
      const event: PendingShotEvent = {
        playerId: canonicalPlayerId(ownerIdHex),
        weapon,
        projectileType,
        position,
        velocity: {
          x: row.velocityX ?? row.velocity_x ?? 0,
          y: row.velocityY ?? row.velocity_y ?? 0,
          z: row.velocityZ ?? row.velocity_z ?? 0,
        },
      };
      useGyriiStore.getState().addPendingShotEvent(event);
    });
  },
});

export function usePendingShotEvents() {
  return useGyriiStore((s) => s.pendingShotEvents);
}

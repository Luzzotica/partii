import {
  canonicalPlayerId,
  identityToHex,
  PendingGrenadeDeleteEvent,
  PendingGrenadeInsertEvent,
  PendingGrenadeUpdateEvent,
  useGyriiStore,
} from "../../store/gameStore";
import type { DbConnection } from "../../generated";
import { SubscriptionHandle } from "../../generated";
import { registerLobbyEntity } from "./registry";
import type { LobbyContext } from "./types";

let subscriptionHandle: SubscriptionHandle | null = null;

registerLobbyEntity({
  filter: "world_id",
  table: "grenade",
  subscribe(conn, context) {
    subscriptionHandle = conn
      .subscriptionBuilder()
      .onApplied(() => {})
      .subscribe([`SELECT * FROM grenade WHERE world_id = ${context.worldId}`]);
  },
  unsubscribe() {
    if (subscriptionHandle != null && subscriptionHandle.isActive()) {
      subscriptionHandle.unsubscribe();
      subscriptionHandle = null;
    }
  },
  setupRowCallbacks(conn) {
    conn.db.grenade.onInsert((_ctx: any, row: any) => {
      const ownerIdHex = identityToHex(row.ownerId);
      if (!ownerIdHex) return;
      const canonicalId = canonicalPlayerId(ownerIdHex);
      const owner = useGyriiStore.getState().players.get(canonicalId);
      const ownerColor = owner?.color
        ? { r: owner.color.r, g: owner.color.g, b: owner.color.b }
        : undefined;
      const event: PendingGrenadeInsertEvent = {
        rigidBodyId: Number(row.rigidBodyId ?? row.rigid_body_id ?? 0),
        position: {
          x: row.positionX ?? row.position_x ?? 0,
          y: row.positionY ?? row.position_y ?? 0,
          z: row.positionZ ?? row.position_z ?? 0,
        },
        velocity: {
          x: row.velocityX ?? row.velocity_x ?? 0,
          y: row.velocityY ?? row.velocity_y ?? 0,
          z: row.velocityZ ?? row.velocity_z ?? 0,
        },
        ownerId: canonicalId,
        ownerColor,
      };
      useGyriiStore.getState().addPendingGrenadeInsert(event);
    });
    conn.db.grenade.onDelete((_ctx: any, row: any) => {
      const event: PendingGrenadeDeleteEvent = {
        rigidBodyId: Number(row.rigidBodyId ?? row.rigid_body_id ?? 0),
      };
      useGyriiStore.getState().addPendingGrenadeDelete(event);
    });
    conn.db.grenade.onUpdate((_ctx: any, _oldRow: any, newRow: any) => {
      const event: PendingGrenadeUpdateEvent = {
        rigidBodyId: Number(newRow.rigidBodyId ?? newRow.rigid_body_id ?? 0),
        position: {
          x: newRow.positionX ?? newRow.position_x ?? 0,
          y: newRow.positionY ?? newRow.position_y ?? 0,
          z: newRow.positionZ ?? newRow.position_z ?? 0,
        },
        velocity: {
          x: newRow.velocityX ?? newRow.velocity_x ?? 0,
          y: newRow.velocityY ?? newRow.velocity_y ?? 0,
          z: newRow.velocityZ ?? newRow.velocity_z ?? 0,
        },
      };
      useGyriiStore.getState().addPendingGrenadeUpdate(event);
    });
  },
});

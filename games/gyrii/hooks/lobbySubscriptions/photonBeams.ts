import { useGyriiStore } from "../../store/gameStore";
import type { DbConnection } from "../../generated";
import { SubscriptionHandle } from "../../generated";
import { registerLobbyEntity } from "./registry";
import type { LobbyContext } from "./types";

let subscriptionHandle: SubscriptionHandle | null = null;

function toPhotonBeamEntry(row: any) {
  return {
    id: row.id ?? 0,
    originX: row.originX ?? row.origin_x ?? 0,
    originY: row.originY ?? row.origin_y ?? 0,
    originZ: row.originZ ?? row.origin_z ?? 0,
    endX: row.endX ?? row.end_x ?? 0,
    endY: row.endY ?? row.end_y ?? 0,
    endZ: row.endZ ?? row.end_z ?? 0,
    remainingTicks: row.remainingTicks ?? row.remaining_ticks ?? 60,
    triggerId: row.triggerId ?? row.trigger_id ?? 0,
    worldId: Number(row.worldId ?? row.world_id ?? 0),
  };
}

registerLobbyEntity({
  filter: "world_id",
  table: "photon_beam",
  subscribe(conn, context) {
    useGyriiStore.getState().clearPhotonBeams();
    subscriptionHandle = conn
      .subscriptionBuilder()
      .onApplied(() => {})
      .subscribe([
        `SELECT * FROM photon_beam WHERE world_id = ${context.worldId}`,
      ]);
  },
  unsubscribe() {
    if (subscriptionHandle != null && subscriptionHandle.isActive()) {
      subscriptionHandle.unsubscribe();
      subscriptionHandle = null;
    }
    useGyriiStore.getState().clearPhotonBeams();
  },
  setupRowCallbacks(conn) {
    conn.db.photonBeam.onInsert((_ctx: any, row: any) => {
      useGyriiStore.getState().setPhotonBeam(toPhotonBeamEntry(row));
    });
    conn.db.photonBeam.onUpdate((_ctx: any, row: any) => {
      useGyriiStore.getState().setPhotonBeam(toPhotonBeamEntry(row));
    });
    conn.db.photonBeam.onDelete((_ctx: any, row: any) => {
      const id = row?.id ?? 0;
      useGyriiStore.getState().removePhotonBeam(id);
    });
  },
});

export function usePhotonBeams() {
  return useGyriiStore((s) => s.photonBeams);
}

import {
  canonicalPlayerId,
  identityToHex,
  useGyriiStore,
} from "../../store/gameStore";
import type { DbConnection } from "../../generated";
import { SubscriptionHandle } from "../../generated";
import { registerLobbyEntity } from "./registry";
import type { LobbyContext } from "./types";

let subscriptionHandle: SubscriptionHandle | null = null;

function getPlayerName(conn: DbConnection, identity: unknown): string {
  const hex = identityToHex(identity);
  if (!hex) return "Unknown";
  for (const row of conn.db.player.iter()) {
    if (
      canonicalPlayerId(identityToHex(row.identity)) === canonicalPlayerId(hex)
    ) {
      return row.name ?? "Unknown";
    }
  }
  return "Unknown";
}

registerLobbyEntity({
  filter: "lobby_id",
  table: "kill_event",
  subscribe(conn, context) {
    useGyriiStore.getState().clearKillFeed();
    subscriptionHandle = conn
      .subscriptionBuilder()
      .onApplied(() => {})
      .subscribe([
        `SELECT * FROM kill_event WHERE lobby_id = ${context.lobbyId}`,
      ]);
  },
  unsubscribe() {
    if (subscriptionHandle != null && subscriptionHandle.isActive()) {
      subscriptionHandle.unsubscribe();
      subscriptionHandle = null;
    }
    useGyriiStore.getState().clearKillFeed();
  },
  setupRowCallbacks(conn) {
    conn.db.killEvent.onInsert((_ctx: any, row: any) => {
      const killerName = getPlayerName(conn, row.killerId);
      const victimName = getPlayerName(conn, row.victimId);
      const killerId = canonicalPlayerId(identityToHex(row.killerId));
      const victimId = canonicalPlayerId(identityToHex(row.victimId));
      useGyriiStore.getState().addKillEvent({
        killerId,
        killerName,
        victimId,
        victimName,
        weapon: row.weaponType ?? row.weapon_type ?? "unknown",
        timestamp:
          row.timestamp?.toMicrosSinceUnixEpoch?.() ?? Date.now() * 1000,
      });
    });
  },
});

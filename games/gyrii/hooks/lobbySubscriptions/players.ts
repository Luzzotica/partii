import {
  canonicalPlayerId,
  identityToHex,
  SecondaryType,
  useGyriiStore,
  WeaponType,
} from "../../store/gameStore";
import type { Player } from "../../store/gameStore";
import type { DbConnection } from "../../generated";
import { SubscriptionHandle } from "../../generated";
import { registerLobbyEntity } from "./registry";
import { getConnectionForSync, getIdentityForSync } from "./registry";
import type { LobbyContext } from "./types";

let subscriptionHandle: SubscriptionHandle | null = null;

function convertServerPlayer(row: any): {
  id: string;
  player: Player;
} {
  const rawId =
    identityToHex(row.identity) || row.identity?.toString?.() || "unknown";
  const id = canonicalPlayerId(rawId);
  const weaponTag =
    typeof row.weapon === "object" ? row.weapon?.tag : row.weapon;
  const weaponMap: Record<string, WeaponType> = {
    Smg: "smg",
    DualMachineGun: "dualMachineGun",
    ChainGun: "chainGun",
    PhotonRifle: "photonRifle",
    Bazooka: "bazooka",
    Flamethrower: "flamethrower",
  };
  const secondaryTag =
    typeof row.secondary === "object" ? row.secondary?.tag : row.secondary;
  const secondaryMap: Record<string, SecondaryType> = {
    PopupKnives: "popupKnives",
    BubbleShield: "bubbleShield",
    SelfDestructNuke: "selfDestructNuke",
  };
  const mainColor = {
    r: Math.round((row.colorR ?? 0) * 255),
    g: Math.round((row.colorG ?? 0.5) * 255),
    b: Math.round((row.colorB ?? 0.5) * 255),
  };
  const secondaryColor = {
    r: Math.round((row.secondaryColorR ?? 0.5) * 255),
    g: Math.round((row.secondaryColorG ?? 0) * 255),
    b: Math.round((row.secondaryColorB ?? 0.5) * 255),
  };
  const marbleConfig = {
    designId: Math.min(
      4,
      row.designId ?? 0,
    ) as import("../../store/gameStore").MarbleDesignId,
    mainColor,
    secondaryColor,
  };
  return {
    id,
    player: {
      id,
      name: row.name ?? "Unknown",
      position: {
        x: row.positionX ?? row.position_x ?? 0,
        y: row.positionY ?? row.position_y ?? 0.5,
        z: row.positionZ ?? row.position_z ?? 0,
      },
      rotation: 0,
      health: row.health ?? 1000,
      kills: row.kills ?? 0,
      deaths: row.deaths ?? 0,
      flagCaptures: row.flagCaptures ?? row.flag_captures ?? 0,
      team: row.team ?? 0,
      color: mainColor,
      secondaryColor,
      marbleConfig,
      weapon: weaponMap[weaponTag] ?? "smg",
      secondary: secondaryMap[secondaryTag] ?? "popupKnives",
      grenadeCount: row.grenades ?? 2,
      molotovCount: row.molotovs ?? 1,
      aimDirection:
        (row.aimX ?? row.aim_x) != null && (row.aimZ ?? row.aim_z) != null
          ? { x: row.aimX ?? row.aim_x, z: row.aimZ ?? row.aim_z }
          : undefined,
      velocity: {
        x: row.velocityX ?? row.velocity_x ?? 0,
        y: row.velocityY ?? row.velocity_y ?? 0,
        z: row.velocityZ ?? row.velocity_z ?? 0,
      },
      lastImpulseX:
        (row as any).lastImpulseX ?? (row as any).last_impulse_x ?? 0,
      lastImpulseY:
        (row as any).lastImpulseY ?? (row as any).last_impulse_y ?? 0,
      lastImpulseZ:
        (row as any).lastImpulseZ ?? (row as any).last_impulse_z ?? 0,
      lastImpulseTime:
        (row as any).lastImpulseTime ?? (row as any).last_impulse_time ?? 0,
      lastShotAt: row.lastShotAt != null ? Number(row.lastShotAt) : undefined,
      serverSnapshotId:
        Number(
          (row as any).serverSnapshotId ?? (row as any).server_snapshot_id,
        ) || 0,
      lastGrenadeThrownAt:
        (row as any).lastGrenadeThrownAt != null
          ? Number((row as any).lastGrenadeThrownAt)
          : undefined,
      isAlive: row.isAlive ?? true,
    },
  };
}

/** Called after joining a lobby so player list updates immediately; also used by row callbacks. */
export function syncPlayers(): void {
  const conn = getConnectionForSync();
  const identity = getIdentityForSync();
  if (!conn || !identity) return;
  const store = useGyriiStore.getState();
  const lobby = store.currentLobby;
  if (!lobby) return;

  const ourHex = canonicalPlayerId(identity);

  try {
    const serverPlayers = Array.from(conn.db.player.iter());
    const seenIds = new Set<string>();
    const prevPlayers = new Map(store.players);
    if (store.localPlayer) prevPlayers.set(ourHex, store.localPlayer);
    for (const row of serverPlayers) {
      const { id, player } = convertServerPlayer(row);
      seenIds.add(id);
      if (id === ourHex) {
        store.setLocalPlayer(player);
      } else {
        store.updatePlayer(id, player);
      }
    }

    const currentPlayers = store.players;
    for (const id of currentPlayers.keys()) {
      if (!seenIds.has(id)) {
        store.removePlayer(id);
      }
    }
    if (store.localPlayer && !seenIds.has(store.localPlayer.id)) {
      store.setLocalPlayer(null);
    }
  } catch (e) {
    console.warn("Error syncing players:", e);
  }
}

registerLobbyEntity({
  filter: "lobby_id",
  table: "player",
  subscribe(conn, context) {
    useGyriiStore.getState().clearPlayers();
    useGyriiStore.getState().setLocalPlayer(null);
    subscriptionHandle = conn
      .subscriptionBuilder()
      .onApplied(() => syncPlayers())
      .subscribe([`SELECT * FROM player WHERE lobby_id = ${context.lobbyId}`]);
  },
  unsubscribe() {
    if (subscriptionHandle != null && subscriptionHandle.isActive()) {
      subscriptionHandle.unsubscribe();
      subscriptionHandle = null;
    }
    useGyriiStore.getState().clearPlayers();
    useGyriiStore.getState().setLocalPlayer(null);
  },
  setupRowCallbacks(conn) {
    conn.db.player.onInsert(() => syncPlayers());
    conn.db.player.onDelete(() => syncPlayers());
    conn.db.player.onUpdate(() => syncPlayers());
  },
});

export function usePlayers() {
  return useGyriiStore((s) => ({
    players: s.players,
    localPlayer: s.localPlayer,
  }));
}

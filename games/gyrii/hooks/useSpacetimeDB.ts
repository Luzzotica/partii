import { useEffect, useRef, useState, useCallback } from "react";
import {
  canonicalPlayerId,
  identityToHex,
  useGyriiStore,
} from "../store/gameStore";
import { DbConnection } from "../generated";
import {
  setConnectionGetters,
  setupAllRowCallbacks,
  syncLobbyEntitySubscriptions,
  syncPlayers,
} from "./lobbySubscriptions";

// SpacetimeDB connection configuration
// Default: maincloud (production). Override with NEXT_PUBLIC_GYRII_SPACETIMEDB_URL=http://127.0.0.1:3001 for local dev.
const SPACETIMEDB_URL =
  process.env.NEXT_PUBLIC_GYRII_SPACETIMEDB_URL || "http://127.0.0.1:3001";
const MODULE_NAME = process.env.NEXT_PUBLIC_GYRII_SPACETIMEDB_MODULE || "gyrii";

// ── Module-level singleton ──────────────────────────────────────────────────
// Lives outside React so StrictMode / mount-unmount cycles don't destroy it.
let singletonConnection: DbConnection | null = null;
let singletonIdentity: string | null = null;
/** Raw identity for reducers that take Identity (e.g. debug_player_in_wall). */
let singletonIdentityObj: unknown = null;
let singletonConnecting = false;
let singletonSubscribed = false;
let lobbyPollInterval: ReturnType<typeof setInterval> | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let isGyriiActive = false;

const RECONNECT_DELAY_MS = 3000;

function weaponToServerTag(weapon: string): string {
  const map: Record<string, string> = {
    smg: "Smg",
    dualMachineGun: "DualMachineGun",
    chainGun: "ChainGun",
    photonRifle: "PhotonRifle",
    bazooka: "Bazooka",
    flamethrower: "Flamethrower",
  };
  return map[weapon] ?? "Smg";
}

function secondaryToServerTag(secondary: string): string {
  const map: Record<string, string> = {
    popupKnives: "PopupKnives",
    bubbleShield: "BubbleShield",
    selfDestructNuke: "SelfDestructNuke",
  };
  return map[secondary] ?? "PopupKnives";
}

/** Call when entering the Gyrii page to enable connection. */
export function activateSpacetimeDB() {
  isGyriiActive = true;
  ensureConnected();
}

/** Call when leaving the Gyrii page to stop connection and reconnect attempts. */
export function deactivateSpacetimeDB() {
  isGyriiActive = false;
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (lobbyPollInterval) {
    clearInterval(lobbyPollInterval);
    lobbyPollInterval = null;
  }
  if (singletonConnection) {
    try {
      singletonConnection.disconnect?.();
    } catch {}
    singletonConnection = null;
  }
  singletonIdentity = null;
  singletonIdentityObj = null;
  singletonSubscribed = false;
  singletonConnecting = false;
  useGyriiStore.getState().setConnected(false);
  useGyriiStore.getState().setConnecting(false);
  useGyriiStore.getState().setConnectionError(null);
  useGyriiStore.getState().setPendingLeaveLobby(false);
}

// Helper to convert a server lobby object to client lobby
function convertLobby(lobby: any, connection: DbConnection) {
  const lobbyPlayers = Array.from(connection.db.lobbyPlayer.iter());
  const playerCount = lobbyPlayers.filter(
    (lp: any) => lp.lobbyId === lobby.id,
  ).length;

  const mapTag =
    typeof lobby.mapId === "object" ? lobby.mapId.tag : lobby.mapId;
  const mapIdStr =
    mapTag === "Arena" ? "arena" : mapTag === "Maze" ? "maze" : "warehouse";

  const gmTag =
    typeof lobby.gameMode === "object" ? lobby.gameMode.tag : lobby.gameMode;
  const gameModeStr =
    gmTag === "FreeForAll"
      ? "freeForAll"
      : gmTag === "TeamDeathmatch"
        ? "teamDeathmatch"
        : "captureTheFlag";

  const gsTag =
    typeof lobby.gameState === "object" ? lobby.gameState.tag : lobby.gameState;
  const gameStateStr =
    gsTag === "Waiting"
      ? "waiting"
      : gsTag === "Starting"
        ? "starting"
        : gsTag === "InProgress"
          ? "inProgress"
          : "ended";

  return {
    id: lobby.id.toString(),
    name: lobby.name,
    hostId: lobby.hostId.toString(),
    mapId: mapIdStr,
    mapPool: [mapIdStr],
    physicsWorldId:
      (lobby.physicsWorldId ?? lobby.physics_world_id) != null
        ? Number(lobby.physicsWorldId ?? lobby.physics_world_id)
        : undefined,
    maxPlayers: lobby.maxPlayers,
    playerCount,
    gameMode: gameModeStr as "freeForAll" | "teamDeathmatch" | "captureTheFlag",
    gameState: gameStateStr as "waiting" | "starting" | "inProgress" | "ended",
    hasPassword: lobby.hasPassword,
    scoreLimit: lobby.scoreLimit ?? 25,
    flagLimit: lobby.flagLimit ?? 3,
    nextRoundStartsAtMs: undefined,
  };
}

function syncLobbies() {
  if (!singletonConnection) return;
  try {
    const conn = singletonConnection;
    const lobbies = Array.from(conn.db.lobby.iter()).map((lobby: any) =>
      convertLobby(lobby, conn),
    );
    useGyriiStore.getState().setAvailableLobbies(lobbies);
  } catch (e) {
    console.warn("Error syncing lobbies:", e);
  }
}

function checkOurLobby() {
  if (!singletonConnection || !singletonIdentity) return;
  const conn = singletonConnection;
  const store = useGyriiStore.getState();
  const ourHex = canonicalPlayerId(singletonIdentity);

  try {
    const ourLobbyPlayer = Array.from(conn.db.lobbyPlayer.iter()).find(
      (lp: any) => identityToHex(lp.playerIdentity) === ourHex,
    );

    if (store.pendingLeaveLobby) {
      if (!ourLobbyPlayer) {
        syncLobbyEntitySubscriptions(conn, null);
        store.setCurrentLobby(null);
        store.setPendingLeaveLobby(false);
      }
      return;
    }

    if (ourLobbyPlayer) {
      const currentLobby = store.currentLobby;
      const currentId = currentLobby ? BigInt(currentLobby.id) : null;
      if (ourLobbyPlayer.lobbyId !== currentId) {
        const lobby = Array.from(conn.db.lobby.iter()).find(
          (l: any) => l.id === ourLobbyPlayer.lobbyId,
        );
        if (lobby) {
          const lobbyId = lobby.id.toString();
          const worldId = Number(
            (lobby as any).physicsWorldId ??
              (lobby as any).physics_world_id ??
              0,
          );
          syncLobbyEntitySubscriptions(conn, { lobbyId, worldId });
          store.setCurrentLobby(convertLobby(lobby, conn));
          syncPlayers();
        }
      }
    } else {
      if (store.currentLobby !== null) {
        syncLobbyEntitySubscriptions(conn, null);
        store.setCurrentLobby(null);
      }
    }
  } catch (e) {
    console.warn("Error checking lobby membership:", e);
  }
}

function setupSubscriptions(connection: DbConnection) {
  if (singletonSubscribed) return;
  singletonSubscribed = true;

  try {
    // Subscribe to lobby table - onApplied fires when matching rows become available
    connection
      .subscriptionBuilder()
      .onApplied(() => {
        syncLobbies();
      })
      .subscribe("SELECT * FROM lobby");

    // Register lobby row callbacks for live insert/delete
    connection.db.lobby.onInsert(() => syncLobbies());
    connection.db.lobby.onDelete(() => syncLobbies());

    // Subscribe to lobby_player for checkOurLobby
    connection
      .subscriptionBuilder()
      .onApplied(() => {
        syncLobbies();
        checkOurLobby();
      })
      .subscribe("SELECT * FROM lobby_player");

    connection.db.lobbyPlayer.onInsert(() => {
      syncLobbies();
      checkOurLobby();
    });
    connection.db.lobbyPlayer.onDelete(() => {
      syncLobbies();
      checkOurLobby();
    });

    setConnectionGetters(
      () => singletonConnection,
      () => singletonIdentity,
    );
    setupAllRowCallbacks(connection);

    // Debug: sync players inside photon beam triggers for highlight
    connection
      .subscriptionBuilder()
      .subscribe("SELECT * FROM debug_photon_beam_target");
    const syncBeamHighlight = () => {
      const rows = Array.from(connection.db.debugPhotonBeamTarget.iter());
      const ids = new Set(
        rows.map((r: any) =>
          canonicalPlayerId(
            identityToHex(r.identity) ?? r.identity?.toString?.() ?? "",
          ),
        ),
      );
      useGyriiStore.getState().setPlayersInBeamHighlight(ids);
    };
    connection.db.debugPhotonBeamTarget.onInsert(() => syncBeamHighlight());
    connection.db.debugPhotonBeamTarget.onDelete(() => syncBeamHighlight());
    syncBeamHighlight(); // initial sync
  } catch (e) {
    console.warn("Error setting up subscriptions:", e);
    singletonSubscribed = false;
  }

  // Optional fallback poll (every 5s) - subscriptions should handle updates
  if (lobbyPollInterval) clearInterval(lobbyPollInterval);
  lobbyPollInterval = setInterval(() => {
    syncLobbies();
    checkOurLobby();
  }, 5000);
}

function scheduleReconnect() {
  if (!isGyriiActive) return;
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    if (isGyriiActive) ensureConnected();
  }, RECONNECT_DELAY_MS);
}

function ensureConnected() {
  if (!isGyriiActive || singletonConnection || singletonConnecting) return;
  singletonConnecting = true;
  useGyriiStore.getState().setConnecting(true);
  useGyriiStore.getState().setConnectionError(null);

  console.log(`Connecting to SpacetimeDB at ${SPACETIMEDB_URL}...`);

  try {
    const connection = DbConnection.builder()
      .withUri(SPACETIMEDB_URL)
      .withModuleName(MODULE_NAME)
      .onConnect((ctx: any) => {
        singletonConnecting = false;
        singletonIdentityObj = ctx.identity ?? null;
        singletonIdentity = ctx.identity?.toString() ?? null;
        useGyriiStore.getState().setConnected(true);
        useGyriiStore.getState().setConnecting(false);
        useGyriiStore.getState().setConnectionError(null);
        console.log("Connected to SpacetimeDB, identity:", singletonIdentity);
        setupSubscriptions(connection);
      })
      .onDisconnect(() => {
        singletonConnecting = false;
        singletonConnection = null;
        singletonIdentity = null;
        singletonIdentityObj = null;
        singletonSubscribed = false;
        useGyriiStore.getState().setConnected(false);
        useGyriiStore.getState().setConnecting(false);
        useGyriiStore.getState().setConnectionError("Disconnected");
        // Return to gyrii page (lobby list) when disconnected, same as leaving the game
        useGyriiStore.getState().setCurrentLobby(null);
        useGyriiStore.getState().setPendingLeaveLobby(false);
        useGyriiStore.getState().clearPlayers();
        if (lobbyPollInterval) {
          clearInterval(lobbyPollInterval);
          lobbyPollInterval = null;
        }
        if (isGyriiActive) {
          console.log("Disconnected from SpacetimeDB - will reconnect");
          scheduleReconnect();
        }
      })
      .build();

    singletonConnection = connection;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to connect";
    useGyriiStore.getState().setConnectionError(message);
    useGyriiStore.getState().setConnecting(false);
    singletonConnecting = false;
    console.error("SpacetimeDB connection error:", error);
    scheduleReconnect();
  }
}

// ── React Hook ──────────────────────────────────────────────────────────────
// Thin wrapper: ensures the singleton is alive, exposes reducer helpers.
export function useSpacetimeDB() {
  const [isConnecting, setIsConnecting] = useState(false);
  const isConnected = useGyriiStore((s) => s.isConnected);

  // Connection is activated by the Gyrii page on mount, not here
  useEffect(() => {
    if (!isGyriiActive) return;
    ensureConnected();
    const handleVisibilityChange = () => {
      if (
        isGyriiActive &&
        document.visibilityState === "visible" &&
        !singletonConnection &&
        !singletonConnecting
      ) {
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
        ensureConnected();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Derive isConnecting from singleton state
  useEffect(() => {
    setIsConnecting(singletonConnecting);
  }, [isConnected]);

  // Reducer calls — all use the singleton connection
  const createLobby = useCallback(
    async (
      name: string,
      hostPlayerName: string,
      mapId: "Arena" | "Maze" | "Warehouse",
      _mapPool: ("Arena" | "Maze" | "Warehouse")[],
      maxPlayers: number,
      gameMode: "FreeForAll" | "TeamDeathmatch" | "CaptureTheFlag",
      scoreLimit: number,
      flagLimit: number,
      password: string = "",
    ) => {
      if (!singletonConnection) {
        console.warn("Not connected to SpacetimeDB");
        return;
      }
      try {
        const mapIdEnum = { tag: mapId } as any;
        const gameModeEnum = { tag: gameMode } as any;
        await singletonConnection.reducers.createLobby({
          name,
          hostPlayerName: hostPlayerName.trim() || "Player",
          mapId: mapIdEnum,
          gameMode: gameModeEnum,
          maxPlayers,
          scoreLimit,
          flagLimit,
          password,
          customMapJson: "", // use built-in map for mapId; pass custom JSON for player-made maps
        });
        console.log("Create lobby:", {
          name,
          mapId,
          maxPlayers,
          gameMode,
          scoreLimit,
          flagLimit,
        });
      } catch (error) {
        console.error("Failed to create lobby:", error);
        useGyriiStore
          .getState()
          .setConnectionError(
            error instanceof Error ? error.message : "Failed to create lobby",
          );
      }
    },
    [],
  );

  const joinLobby = useCallback(
    async (lobbyId: number, playerName: string, password: string = "") => {
      if (!singletonConnection) {
        console.warn("Not connected to SpacetimeDB");
        return;
      }
      try {
        await singletonConnection.reducers.joinLobby({
          lobbyId: BigInt(lobbyId),
          playerName,
          password,
        });
        console.log("Join lobby:", { lobbyId, playerName });
      } catch (error) {
        console.error("Failed to join lobby:", error);
        useGyriiStore
          .getState()
          .setConnectionError(
            error instanceof Error ? error.message : "Failed to join lobby",
          );
        throw error;
      }
    },
    [],
  );

  const leaveLobby = useCallback(async () => {
    if (!singletonConnection) {
      console.warn("Not connected to SpacetimeDB");
      return;
    }
    try {
      await singletonConnection.reducers.leaveLobby({});
      console.log("Leave lobby");
    } catch (error) {
      console.error("Failed to leave lobby:", error);
    }
  }, []);

  const updateInput = useCallback(
    async (
      directionX: number,
      directionZ: number,
      aimDirectionX: number,
      aimDirectionZ: number,
    ) => {
      if (!singletonConnection) return;
      try {
        await singletonConnection.reducers.updateInput({
          inputX: directionX,
          inputZ: directionZ,
          aimX: aimDirectionX,
          aimZ: aimDirectionZ,
        });
      } catch (e) {
        // Silently ignore - player might not exist yet
      }
    },
    [],
  );

  const setShooting = useCallback(
    async (isShooting: boolean, aimX: number, aimZ: number) => {
      if (!singletonConnection) return;
      try {
        await singletonConnection.reducers.setShooting({
          isShooting,
          aimX,
          aimZ,
        });
      } catch {
        // Swallow reducer errors (e.g. not in game)
      }
    },
    [],
  );

  const shoot = useCallback(async () => {
    if (!singletonConnection) return;
    console.log("Shoot");
  }, []);

  const throwGrenade = useCallback(async (aimX: number, aimZ: number) => {
    if (!singletonConnection) return;
    try {
      singletonConnection.reducers.throwGrenade({ aimX, aimZ });
    } catch {
      // Swallow reducer errors (e.g. not in game, no grenades)
    }
  }, []);

  const throwMolotov = useCallback(async (aimX: number, aimZ: number) => {
    if (!singletonConnection) return;
    try {
      await singletonConnection.reducers.throwMolotov({ aimX, aimZ });
    } catch {
      // Swallow reducer errors (e.g. not in game, no molotovs)
    }
  }, []);

  const useSecondary = useCallback(async () => {
    if (!singletonConnection) return;
    console.log("Use secondary");
  }, []);

  const setLoadout = useCallback(async (weapon: string, secondary: string) => {
    if (!singletonConnection) return;
    console.log("Set loadout:", { weapon, secondary });
  }, []);

  const requestSpawn = useCallback(
    async (weapon: string, secondary: string) => {
      if (!singletonConnection) {
        console.warn("Not connected to SpacetimeDB");
        return;
      }
      try {
        const weaponTag = weaponToServerTag(weapon);
        const secondaryTag = secondaryToServerTag(secondary);
        await singletonConnection.reducers.requestSpawn({
          weapon: { tag: weaponTag } as any,
          secondary: { tag: secondaryTag } as any,
        });
      } catch (error) {
        console.error("Failed to request spawn:", error);
        useGyriiStore
          .getState()
          .setConnectionError(
            error instanceof Error ? error.message : "Failed to spawn",
          );
        throw error;
      }
    },
    [],
  );

  const refreshLobbies = useCallback(() => {
    syncLobbies();
  }, []);

  const toggleReady = useCallback(async () => {
    if (!singletonConnection) return;
    console.log("Toggle ready");
  }, []);

  const startGame = useCallback(async () => {
    if (!singletonConnection) return;
    console.log("Start game");
  }, []);

  const setMarbleConfig = useCallback(
    async (config: import("../store/gameStore").MarbleConfig) => {
      if (!singletonConnection) return;
      try {
        await singletonConnection.reducers.setMarbleConfig({
          designId: config.designId,
          mainR: config.mainColor.r / 255,
          mainG: config.mainColor.g / 255,
          mainB: config.mainColor.b / 255,
          secR: config.secondaryColor.r / 255,
          secG: config.secondaryColor.g / 255,
          secB: config.secondaryColor.b / 255,
        });
      } catch (e) {
        // Player might not exist yet
      }
    },
    [],
  );

  return {
    isConnecting,
    createLobby,
    joinLobby,
    refreshLobbies,
    setMarbleConfig,
    leaveLobby,
    toggleReady,
    startGame,
    updateInput,
    setShooting,
    shoot,
    throwGrenade,
    throwMolotov,
    useSecondary,
    setLoadout,
    requestSpawn,
  };
}

import { useEffect, useRef, useState, useCallback } from "react";
import { SecondaryType, useGyriiStore, WeaponType } from "../store/gameStore";
import { DbConnection } from "../generated";

// SpacetimeDB connection configuration
const SPACETIMEDB_URL =
  process.env.NEXT_PUBLIC_SPACETIMEDB_URL || "http://127.0.0.1:3001";
const MODULE_NAME = process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE || "gyrii";

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
    physicsWorldId:
      lobby.physicsWorldId != null ? Number(lobby.physicsWorldId) : undefined,
    maxPlayers: lobby.maxPlayers,
    playerCount,
    gameMode: gameModeStr as "freeForAll" | "teamDeathmatch" | "captureTheFlag",
    gameState: gameStateStr as "waiting" | "starting" | "inProgress" | "ended",
    hasPassword: lobby.hasPassword,
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

function identityToHex(identity: any): string {
  if (!identity) return "";
  if (typeof identity.toHexString === "function")
    return identity.toHexString().replace(/^0x/i, "").toLowerCase();
  const s = String(identity);
  return s
    .replace(/^0x/i, "")
    .replace(/^Identity\(|\)$/g, "")
    .toLowerCase();
}

// Convert server Player row to store Player format
function convertServerPlayer(row: any): {
  id: string;
  player: import("../store/gameStore").Player;
} {
  const id =
    identityToHex(row.identity) || row.identity?.toString?.() || "unknown";
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
  const marbleConfig = {
    designId: Math.min(
      4,
      row.designId ?? 0,
    ) as import("../store/gameStore").MarbleDesignId,
    mainColor,
    secondaryColor: {
      r: Math.round((row.secondaryColorR ?? 0.5) * 255),
      g: Math.round((row.secondaryColorG ?? 0) * 255),
      b: Math.round((row.secondaryColorB ?? 0.5) * 255),
    },
  };
  return {
    id,
    player: {
      id,
      name: row.name ?? "Unknown",
      position: {
        x: row.positionX ?? 0,
        y: row.positionY ?? 0.5,
        z: row.positionZ ?? 0,
      },
      rotation: 0,
      health: row.health ?? 100,
      kills: row.kills ?? 0,
      deaths: row.deaths ?? 0,
      team: row.team ?? 0,
      color: mainColor,
      marbleConfig,
      weapon: weaponMap[weaponTag] ?? "smg",
      secondary: secondaryMap[secondaryTag] ?? "popupKnives",
      ammo: row.ammo ?? 30,
      grenadeCount: row.grenades ?? 2,
      molotovCount: row.molotovs ?? 1,
    },
  };
}

function syncPlayers() {
  if (!singletonConnection || !singletonIdentity) return;
  const store = useGyriiStore.getState();
  const lobby = store.currentLobby;
  if (!lobby) return;

  const lobbyId = BigInt(lobby.id);
  const ourHex = singletonIdentity
    .replace(/^0x/i, "")
    .replace(/^Identity\(|\)$/g, "")
    .toLowerCase();

  try {
    const conn = singletonConnection;
    const serverPlayers = Array.from(conn.db.player.iter()).filter(
      (p: any) => p.lobbyId === lobbyId,
    );

    const seenIds = new Set<string>();
    for (const row of serverPlayers) {
      const { id, player } = convertServerPlayer(row);
      seenIds.add(id);
      if (identityToHex(row.identity) === ourHex) {
        store.setLocalPlayer(player);
      } else {
        store.updatePlayer(id, player);
      }
    }

    // Remove players no longer in the lobby
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

function checkOurLobby() {
  if (!singletonConnection || !singletonIdentity) return;
  const conn = singletonConnection;
  const store = useGyriiStore.getState();
  const ourHex = singletonIdentity
    .replace(/^0x/i, "")
    .replace(/^Identity\(|\)$/g, "")
    .toLowerCase();

  try {
    const ourLobbyPlayer = Array.from(conn.db.lobbyPlayer.iter()).find(
      (lp: any) => identityToHex(lp.playerIdentity) === ourHex,
    );

    if (store.pendingLeaveLobby) {
      if (!ourLobbyPlayer) {
        store.setCurrentLobby(null);
        store.clearPlayers();
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
          store.setCurrentLobby(convertLobby(lobby, conn));
          syncPlayers();
        }
      }
    } else {
      if (store.currentLobby !== null) {
        store.setCurrentLobby(null);
        store.clearPlayers();
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

    // Subscribe to player table for multiplayer sync
    connection
      .subscriptionBuilder()
      .onApplied(() => syncPlayers())
      .subscribe("SELECT * FROM player");

    connection.db.player.onInsert(() => syncPlayers());
    connection.db.player.onDelete(() => syncPlayers());
    connection.db.player.onUpdate?.(() => syncPlayers());
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
      mapId: "Arena" | "Maze" | "Warehouse",
      maxPlayers: number,
      gameMode: "FreeForAll" | "TeamDeathmatch" | "CaptureTheFlag",
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
          mapId: mapIdEnum,
          gameMode: gameModeEnum,
          maxPlayers,
          scoreLimit: 50,
          password,
        });
        console.log("Create lobby:", { name, mapId, maxPlayers, gameMode });
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
      isShooting: boolean,
    ) => {
      if (!singletonConnection) return;
      try {
        await singletonConnection.reducers.updateInput({
          inputX: directionX,
          inputZ: directionZ,
          aimX: aimDirectionX,
          aimZ: aimDirectionZ,
          isShooting,
        });
      } catch (e) {
        // Silently ignore - player might not exist yet
      }
    },
    [],
  );

  const shoot = useCallback(async () => {
    if (!singletonConnection) return;
    console.log("Shoot");
  }, []);

  const throwGrenade = useCallback(async (throwPower: number) => {
    if (!singletonConnection) return;
    console.log("Throw grenade:", { throwPower });
  }, []);

  const throwMolotov = useCallback(async (throwPower: number) => {
    if (!singletonConnection) return;
    console.log("Throw molotov:", { throwPower });
  }, []);

  const useSecondary = useCallback(async () => {
    if (!singletonConnection) return;
    console.log("Use secondary");
  }, []);

  const setLoadout = useCallback(async (weapon: string, secondary: string) => {
    if (!singletonConnection) return;
    console.log("Set loadout:", { weapon, secondary });
  }, []);

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
    shoot,
    throwGrenade,
    throwMolotov,
    useSecondary,
    setLoadout,
  };
}

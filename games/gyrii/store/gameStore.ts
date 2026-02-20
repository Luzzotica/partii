import { create } from "zustand";

export type GameState =
  | "loading"
  | "menu"
  | "lobby"
  | "playing"
  | "paused"
  | "dead"
  | "ended";
export type WeaponType =
  | "smg"
  | "dualMachineGun"
  | "chainGun"
  | "photonRifle"
  | "bazooka"
  | "flamethrower";
export type SecondaryType = "popupKnives" | "bubbleShield" | "selfDestructNuke";

export type MarbleDesignId = 0 | 1 | 2 | 3 | 4;

export interface MarbleConfig {
  designId: MarbleDesignId;
  mainColor: { r: number; g: number; b: number };
  secondaryColor: { r: number; g: number; b: number };
}

export interface Player {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  rotation: number;
  health: number;
  kills: number;
  deaths: number;
  flagCaptures?: number;
  team: number;
  color: { r: number; g: number; b: number };
  /** Server-synced secondary color (e.g. for marble design). */
  secondaryColor: { r: number; g: number; b: number };
  marbleConfig?: MarbleConfig;
  weapon: WeaponType;
  secondary: SecondaryType;
  grenadeCount: number;
  molotovCount: number;
  /** Server-synced aim direction (x, z); used for other players' weapon rotation. */
  aimDirection?: { x: number; z: number };
  /** Server-synced velocity (m/s); used for client extrapolation between updates. */
  velocity?: { x: number; y: number; z: number };
  /** Last impulse applied (e.g. bullet hit); client adds to predicted velocity once. */
  lastImpulseX?: number;
  lastImpulseY?: number;
  lastImpulseZ?: number;
  lastImpulseTime?: number;
  /** Server timestamp when this player last fired (for shot feedback). */
  lastShotAt?: number;
  /** Server timestamp (micros) when this player last threw a grenade; used for cooldown. */
  lastGrenadeThrownAt?: number;
  /** Server-synced alive state; when false, show respawn loadout screen. */
  isAlive?: boolean;
}

/** Projectile type: which pool and behavior. Must match server PROJECTILE_TYPE_*. */
export const PROJECTILE_TYPE_BULLET = 0;
export const PROJECTILE_TYPE_ROCKET = 1;

/** Event pushed when server creates a projectile (bullet/rocket); game loop spawns visual. */
export interface PendingShotEvent {
  playerId: string;
  weapon: WeaponType;
  projectileType: number; // 0 = bullet, 1 = rocket — which pool to use
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

/** Event pushed when server creates a grenade; game loop spawns client physics body. */
export interface PendingGrenadeInsertEvent {
  rigidBodyId: number;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  ownerId: string;
  /** Thrower's primary color (r,g,b 0-1) for trail particles. */
  ownerColor?: { r: number; g: number; b: number };
}

/** Event pushed when server deletes a grenade (exploded); game loop removes and plays FX. */
export interface PendingGrenadeDeleteEvent {
  rigidBodyId: number;
}

/** Event pushed when server updates grenade position; game loop syncs physics body. */
export interface PendingGrenadeUpdateEvent {
  rigidBodyId: number;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

export interface Lobby {
  id: string;
  name: string;
  hostId: string;
  mapId: string;
  physicsWorldId?: number; // for physics debug (heartbeat, debug_physics_world)
  maxPlayers: number;
  playerCount: number;
  gameMode: "freeForAll" | "teamDeathmatch" | "captureTheFlag";
  gameState: "waiting" | "starting" | "inProgress" | "ended";
  hasPassword: boolean;
  scoreLimit: number;
  flagLimit: number;
}

export interface KillEvent {
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  weapon: string;
  timestamp: number;
}

/** Active photon beams from server (id -> beam); used for beam rendering. */
export interface PhotonBeamEntry {
  id: number;
  originX: number;
  originY: number;
  originZ: number;
  endX: number;
  endY: number;
  endZ: number;
  /** Server remaining ticks; used for fade-out (0 = about to disappear). */
  remainingTicks: number;
  /** 0 until server has resolved beam end and created trigger; only render when !== 0. */
  triggerId: number;
  /** Physics world id; only render beams for current lobby's world. */
  worldId: number;
}

/** Single source of truth for matching store players to game meshes. Use everywhere we key by player id. */
export function canonicalPlayerId(id: string): string {
  return String(id)
    .toLowerCase()
    .replace(/^0x/i, "")
    .replace(/^Identity\(|\)$/g, "");
}

/** Normalize SpacetimeDB Identity to hex string for comparison. */
export function identityToHex(identity: unknown): string {
  if (!identity) return "";
  if (typeof (identity as any).toHexString === "function")
    return (identity as any).toHexString().replace(/^0x/i, "").toLowerCase();
  const s = String(identity);
  return s
    .replace(/^0x/i, "")
    .replace(/^Identity\(|\)$/g, "")
    .toLowerCase();
}

interface GyriiStore {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setConnectionError: (error: string | null) => void;

  // Game state
  gameState: GameState;
  setGameState: (state: GameState) => void;

  // Player state
  localPlayer: Player | null;
  players: Map<string, Player>;
  setLocalPlayer: (player: Player | null) => void;
  updatePlayer: (id: string, update: Partial<Player>) => void;
  removePlayer: (id: string) => void;
  clearPlayers: () => void;

  // Lobby state
  currentLobby: Lobby | null;
  availableLobbies: Lobby[];
  /** When true, user clicked Quit to menu; ignore server lobby_player until we see we left */
  pendingLeaveLobby: boolean;
  setCurrentLobby: (lobby: Lobby | null) => void;
  setAvailableLobbies: (lobbies: Lobby[]) => void;
  setPendingLeaveLobby: (pending: boolean) => void;

  // Kill feed
  killFeed: KillEvent[];
  addKillEvent: (event: KillEvent) => void;
  clearKillFeed: () => void;

  // Active photon beams (server table sync); key = beam id string
  photonBeams: Map<string, PhotonBeamEntry>;
  setPhotonBeam: (beam: PhotonBeamEntry) => void;
  removePhotonBeam: (id: number) => void;
  clearPhotonBeams: () => void;

  /** Debug: player ids currently inside photon beam trigger (for highlight). */
  playersInBeamHighlight: Set<string>;
  setPlayersInBeamHighlight: (ids: Set<string>) => void;

  // Internal: queue of shot events from server (Projectile inserts); drained by game loop
  pendingShotEvents: PendingShotEvent[];
  // Internal: queue of grenade events from server; drained by game loop
  pendingGrenadeInserts: PendingGrenadeInsertEvent[];
  pendingGrenadeDeletes: PendingGrenadeDeleteEvent[];
  pendingGrenadeUpdates: PendingGrenadeUpdateEvent[];

  // Input state
  inputDirection: { x: number; z: number };
  aimDirection: { x: number; z: number };
  mousePosition: { x: number; y: number };
  setMousePosition: (x: number, y: number) => void;
  isShooting: boolean;
  setInputDirection: (x: number, z: number) => void;
  setAimDirection: (x: number, z: number) => void;
  setIsShooting: (shooting: boolean) => void;
  /** 0..1 charge progress for charge weapons (e.g. photon rifle); 0 when not charging. */
  weaponChargeProgress: number;
  setWeaponChargeProgress: (progress: number) => void;
  /** Timestamp (performance.now()) until which photon rifle cannot start a new charge. */
  photonRifleRechargeUntil: number;
  setPhotonRifleRechargeUntil: (until: number) => void;

  // Loadout
  selectedWeapon: WeaponType;
  selectedSecondary: SecondaryType;
  setSelectedWeapon: (weapon: WeaponType) => void;
  setSelectedSecondary: (secondary: SecondaryType) => void;

  // Settings
  playerName: string;
  playerColor: { r: number; g: number; b: number };
  marbleConfig: MarbleConfig;
  setPlayerName: (name: string) => void;
  setPlayerColor: (color: { r: number; g: number; b: number }) => void;
  setMarbleConfig: (config: MarbleConfig) => void;

  // Pending shot events from server (Projectile table inserts); game loop drains and spawns visuals
  addPendingShotEvent: (event: PendingShotEvent) => void;
  takePendingShotEvents: () => PendingShotEvent[];
  // Pending grenade events from server; game loop drains and spawns/removes visuals
  addPendingGrenadeInsert: (event: PendingGrenadeInsertEvent) => void;
  addPendingGrenadeDelete: (event: PendingGrenadeDeleteEvent) => void;
  addPendingGrenadeUpdate: (event: PendingGrenadeUpdateEvent) => void;
  takePendingGrenadeEvents: () => {
    inserts: PendingGrenadeInsertEvent[];
    deletes: PendingGrenadeDeleteEvent[];
    updates: PendingGrenadeUpdateEvent[];
  };

  // Reset
  reset: () => void;
}

const initialState = {
  isConnected: false,
  isConnecting: false,
  connectionError: null,
  gameState: "loading" as GameState,
  localPlayer: null,
  players: new Map<string, Player>(),
  currentLobby: null,
  availableLobbies: [],
  pendingLeaveLobby: false,
  killFeed: [],
  photonBeams: new Map<string, PhotonBeamEntry>(),
  playersInBeamHighlight: new Set<string>(),
  pendingShotEvents: [] as PendingShotEvent[],
  pendingGrenadeInserts: [] as PendingGrenadeInsertEvent[],
  pendingGrenadeDeletes: [] as PendingGrenadeDeleteEvent[],
  pendingGrenadeUpdates: [] as PendingGrenadeUpdateEvent[],
  inputDirection: { x: 0, z: 0 },
  aimDirection: { x: 0, z: 1 },
  mousePosition: { x: 0, y: 0 },
  isShooting: false,
  weaponChargeProgress: 0,
  photonRifleRechargeUntil: 0,
  selectedWeapon: "smg" as WeaponType,
  selectedSecondary: "popupKnives" as SecondaryType,
  playerName: "Player",
  playerColor: { r: 0, g: 255, b: 255 },
  marbleConfig: {
    designId: 0,
    mainColor: { r: 0, g: 255, b: 255 },
    secondaryColor: { r: 255, g: 0, b: 128 },
  } as MarbleConfig,
};

export const useGyriiStore = create<GyriiStore>((set, get) => ({
  ...initialState,

  setConnected: (connected) => set({ isConnected: connected }),
  setConnecting: (connecting) => set({ isConnecting: connecting }),
  setConnectionError: (error) => set({ connectionError: error }),

  setGameState: (state) => set({ gameState: state }),

  setLocalPlayer: (player) =>
    set({
      localPlayer: player
        ? { ...player, id: canonicalPlayerId(player.id) }
        : null,
    }),

  updatePlayer: (id, update) => {
    const canonicalId = canonicalPlayerId(id);
    const players = new Map(get().players);
    const existing = players.get(canonicalId);
    if (existing) {
      players.set(canonicalId, { ...existing, ...update });
    } else {
      players.set(canonicalId, {
        id: canonicalId,
        name: "Unknown",
        position: { x: 0, y: 0.5, z: 0 },
        rotation: 0,
        health: 1000,
        kills: 0,
        deaths: 0,
        team: 0,
        color: { r: 255, g: 255, b: 255 },
        secondaryColor: { r: 255, g: 0, b: 128 },
        weapon: "smg",
        secondary: "popupKnives",
        grenadeCount: 2,
        molotovCount: 1,
        ...update,
      } as Player);
    }
    set({ players });
  },

  removePlayer: (id) => {
    const players = new Map(get().players);
    players.delete(canonicalPlayerId(id));
    set({ players });
  },

  clearPlayers: () => set({ players: new Map(), localPlayer: null }),

  setCurrentLobby: (lobby) =>
    set((s) => ({
      currentLobby: lobby,
      ...(lobby === null
        ? { photonBeams: new Map<string, PhotonBeamEntry>() }
        : {}),
    })),
  setAvailableLobbies: (lobbies) => set({ availableLobbies: lobbies }),
  setPendingLeaveLobby: (pending) => set({ pendingLeaveLobby: pending }),

  addKillEvent: (event) => {
    const killFeed = [event, ...get().killFeed].slice(0, 5);
    set({ killFeed });
  },
  clearKillFeed: () => set({ killFeed: [] }),

  setPhotonBeam: (beam) =>
    set((s) => {
      const next = new Map(s.photonBeams);
      next.set(String(beam.id), beam);
      return { photonBeams: next };
    }),
  removePhotonBeam: (id) =>
    set((s) => {
      const next = new Map(s.photonBeams);
      next.delete(String(id));
      return { photonBeams: next };
    }),
  clearPhotonBeams: () => set({ photonBeams: new Map() }),
  setPlayersInBeamHighlight: (ids) => set({ playersInBeamHighlight: ids }),

  setInputDirection: (x, z) => set({ inputDirection: { x, z } }),
  setAimDirection: (x, z) => set({ aimDirection: { x, z } }),
  setMousePosition: (x, y) => set({ mousePosition: { x, y } }),
  setIsShooting: (shooting) => set({ isShooting: shooting }),
  setWeaponChargeProgress: (progress) =>
    set({ weaponChargeProgress: progress }),
  setPhotonRifleRechargeUntil: (until) =>
    set({ photonRifleRechargeUntil: until }),

  setSelectedWeapon: (weapon) => set({ selectedWeapon: weapon }),
  setSelectedSecondary: (secondary) => set({ selectedSecondary: secondary }),

  setPlayerName: (name) => set({ playerName: name }),
  setPlayerColor: (color) => set({ playerColor: color }),
  setMarbleConfig: (config) => set({ marbleConfig: config }),

  addPendingShotEvent: (event) =>
    set((s) => ({
      pendingShotEvents: [...s.pendingShotEvents, event],
    })),
  takePendingShotEvents: () => {
    const events: PendingShotEvent[] = [];
    useGyriiStore.setState((s) => {
      events.push(...s.pendingShotEvents);
      return { pendingShotEvents: [] };
    });
    return events;
  },

  addPendingGrenadeInsert: (event) =>
    set((s) => ({
      pendingGrenadeInserts: [...s.pendingGrenadeInserts, event],
    })),
  addPendingGrenadeDelete: (event) =>
    set((s) => ({
      pendingGrenadeDeletes: [...s.pendingGrenadeDeletes, event],
    })),
  addPendingGrenadeUpdate: (event) =>
    set((s) => ({
      pendingGrenadeUpdates: [...s.pendingGrenadeUpdates, event],
    })),
  takePendingGrenadeEvents: () => {
    const inserts: PendingGrenadeInsertEvent[] = [];
    const deletes: PendingGrenadeDeleteEvent[] = [];
    const updates: PendingGrenadeUpdateEvent[] = [];
    useGyriiStore.setState((s) => {
      inserts.push(...s.pendingGrenadeInserts);
      deletes.push(...s.pendingGrenadeDeletes);
      updates.push(...s.pendingGrenadeUpdates);
      return {
        pendingGrenadeInserts: [],
        pendingGrenadeDeletes: [],
        pendingGrenadeUpdates: [],
      };
    });
    return { inserts, deletes, updates };
  },

  reset: () => set(initialState),
}));

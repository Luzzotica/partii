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
  team: number;
  color: { r: number; g: number; b: number };
  marbleConfig?: MarbleConfig;
  weapon: WeaponType;
  secondary: SecondaryType;
  ammo: number;
  grenadeCount: number;
  molotovCount: number;
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
}

export interface KillEvent {
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  weapon: string;
  timestamp: number;
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

  // Input state
  inputDirection: { x: number; z: number };
  aimDirection: { x: number; z: number };
  mousePosition: { x: number; y: number };
  setMousePosition: (x: number, y: number) => void;
  isShooting: boolean;
  setInputDirection: (x: number, z: number) => void;
  setAimDirection: (x: number, z: number) => void;
  setIsShooting: (shooting: boolean) => void;

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
  inputDirection: { x: 0, z: 0 },
  aimDirection: { x: 0, z: 1 },
  mousePosition: { x: 0, y: 0 },
  isShooting: false,
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

  setLocalPlayer: (player) => set({ localPlayer: player }),

  updatePlayer: (id, update) => {
    const players = new Map(get().players);
    const existing = players.get(id);
    if (existing) {
      players.set(id, { ...existing, ...update });
    } else {
      players.set(id, {
        id,
        name: "Unknown",
        position: { x: 0, y: 0.5, z: 0 },
        rotation: 0,
        health: 100,
        kills: 0,
        deaths: 0,
        team: 0,
        color: { r: 255, g: 255, b: 255 },
        weapon: "smg",
        secondary: "popupKnives",
        ammo: 30,
        grenadeCount: 2,
        molotovCount: 1,
        ...update,
      } as Player);
    }
    set({ players });
  },

  removePlayer: (id) => {
    const players = new Map(get().players);
    players.delete(id);
    set({ players });
  },

  clearPlayers: () => set({ players: new Map(), localPlayer: null }),

  setCurrentLobby: (lobby) => set({ currentLobby: lobby }),
  setAvailableLobbies: (lobbies) => set({ availableLobbies: lobbies }),
  setPendingLeaveLobby: (pending) => set({ pendingLeaveLobby: pending }),

  addKillEvent: (event) => {
    const killFeed = [event, ...get().killFeed].slice(0, 5);
    set({ killFeed });
  },
  clearKillFeed: () => set({ killFeed: [] }),

  setInputDirection: (x, z) => set({ inputDirection: { x, z } }),
  setAimDirection: (x, z) => set({ aimDirection: { x, z } }),
  setMousePosition: (x, y) => set({ mousePosition: { x, y } }),
  setIsShooting: (shooting) => set({ isShooting: shooting }),

  setSelectedWeapon: (weapon) => set({ selectedWeapon: weapon }),
  setSelectedSecondary: (secondary) => set({ selectedSecondary: secondary }),

  setPlayerName: (name) => set({ playerName: name }),
  setPlayerColor: (color) => set({ playerColor: color }),
  setMarbleConfig: (config) => set({ marbleConfig: config }),

  reset: () => set(initialState),
}));

/**
 * WebSocket client for the new Rust Gyrii server.
 * Use when NEXT_PUBLIC_GYRII_USE_NEW_SERVER=true.
 */

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { canonicalPlayerId, useGyriiStore } from "../store/gameStore";
import type { Player } from "../store/gameStore";

const GYRII_SERVER_WS =
  process.env.NEXT_PUBLIC_GYRII_SERVER_WS || "ws://localhost:4000";

let ws: WebSocket | null = null;
let identity: string | null = null;
let isActive = false;
let isConnecting = false;

function playerFromPayload(p: {
  id: string;
  name: string;
  position: number[];
  health: number;
  kills: number;
  deaths: number;
  team: number;
  color: number[];
  design_id?: number;
  secondary_color?: number[];
  weapon: string;
  secondary: string;
  velocity: number[];
  is_alive: boolean;
  grenade_count: number;
  molotov_count: number;
  last_shot_at?: number;
  last_grenade_thrown_at?: number;
  aim_x?: number;
  aim_z?: number;
}): Player {
  const id = canonicalPlayerId(p.id);
  const mainColor = {
    r: Math.round((p.color?.[0] ?? 0) * 255),
    g: Math.round((p.color?.[1] ?? 0.5) * 255),
    b: Math.round((p.color?.[2] ?? 0.5) * 255),
  };
  const secondaryColor = {
    r: Math.round((p.secondary_color?.[0] ?? 0.5) * 255),
    g: Math.round((p.secondary_color?.[1] ?? 0) * 255),
    b: Math.round((p.secondary_color?.[2] ?? 0.5) * 255),
  };
  const designId = Math.min(
    4,
    p.design_id ?? 0,
  ) as import("../store/gameStore").MarbleDesignId;
  const marbleConfig: import("../store/gameStore").MarbleConfig = {
    designId,
    mainColor,
    secondaryColor,
  };
  return {
    id,
    name: p.name ?? "Unknown",
    position: {
      x: p.position?.[0] ?? 0,
      y: p.position?.[1] ?? 0.5,
      z: p.position?.[2] ?? 0,
    },
    rotation: 0,
    health: p.health ?? 1000,
    kills: p.kills ?? 0,
    deaths: p.deaths ?? 0,
    team: p.team ?? 0,
    color: mainColor,
    secondaryColor,
    marbleConfig,
    weapon: (p.weapon as Player["weapon"]) ?? "smg",
    secondary: (p.secondary as Player["secondary"]) ?? "popupKnives",
    grenadeCount: p.grenade_count ?? 2,
    molotovCount: p.molotov_count ?? 1,
    lastShotAt: p.last_shot_at,
    lastGrenadeThrownAt: p.last_grenade_thrown_at,
    aimDirection:
      p.aim_x != null && p.aim_z != null
        ? { x: p.aim_x, z: p.aim_z }
        : undefined,
    velocity: {
      x: p.velocity?.[0] ?? 0,
      y: p.velocity?.[1] ?? 0,
      z: p.velocity?.[2] ?? 0,
    },
    isAlive: p.is_alive ?? true,
  };
}

function lobbyFromPayload(l: any, playerCount: number) {
  return {
    id: String(l.id),
    name: l.name ?? "",
    hostId: String(l.host_id ?? ""),
    mapId: l.map_id ?? "arena",
    mapPool: Array.isArray(l.map_pool) ? l.map_pool : [l.map_id ?? "arena"],
    maxPlayers: l.max_players ?? 8,
    playerCount,
    gameMode:
      (l.game_mode as "freeForAll" | "teamDeathmatch" | "captureTheFlag") ??
      "freeForAll",
    gameState:
      (l.game_state as "waiting" | "starting" | "inProgress" | "ended") ??
      "waiting",
    hasPassword: l.has_password ?? false,
    scoreLimit: l.score_limit ?? 25,
    flagLimit: l.flag_limit ?? 3,
    nextRoundStartsAtMs: l.next_round_starts_at_ms ?? undefined,
  };
}

function lobbySummaryToStore(l: any) {
  return {
    id: String(l.id),
    name: l.name ?? "",
    hostId: String(l.host_id ?? ""),
    mapId: l.map_id ?? "arena",
    mapPool: Array.isArray(l.map_pool) ? l.map_pool : [l.map_id ?? "arena"],
    maxPlayers: l.max_players ?? 8,
    playerCount: l.player_count ?? 0,
    gameMode:
      (l.game_mode as "freeForAll" | "teamDeathmatch" | "captureTheFlag") ??
      "freeForAll",
    gameState:
      (l.game_state as "waiting" | "starting" | "inProgress" | "ended") ??
      "waiting",
    hasPassword: l.has_password ?? false,
    scoreLimit: l.score_limit ?? 25,
    flagLimit: l.flag_limit ?? 3,
    nextRoundStartsAtMs: l.next_round_starts_at_ms ?? undefined,
  };
}

function applyLobbyState(msg: any) {
  const store = useGyriiStore.getState();
  store.clearPlayers();
  const lobby = lobbyFromPayload(msg.lobby, msg.players?.length ?? 0);
  store.setCurrentLobby(lobby);
  if (lobby.gameState !== "ended") {
    store.setRoundEndedBanner(null);
  }
  const ourId = canonicalPlayerId(identity ?? "");
  for (const p of msg.players ?? []) {
    const player = playerFromPayload(p);
    if (player.id === ourId) {
      store.setLocalPlayer(player);
    } else {
      store.updatePlayer(player.id, player);
    }
  }
}

function applyGameEnded(msg: any) {
  useGyriiStore.getState().setRoundEndedBanner({
    lobbyId: String(msg.lobby_id ?? ""),
    winnerTeam:
      typeof msg.winner_team === "number"
        ? (msg.winner_team as number)
        : undefined,
    winnerPlayerIdentity:
      typeof msg.winner_player_identity === "string"
        ? msg.winner_player_identity
        : undefined,
    winnerPlayerName:
      typeof msg.winner_player_name === "string"
        ? msg.winner_player_name
        : undefined,
    nextMapId: String(msg.next_map_id ?? "arena"),
    countdownMs: Number(msg.countdown_ms ?? 5000),
    shownAtMs: Date.now(),
  });
}

function applyLobbyList(msg: any) {
  const lobbies = (msg.lobbies ?? []).map(lobbySummaryToStore);
  useGyriiStore.getState().setAvailableLobbies(lobbies);
}

function profileFromPayload(p: {
  id: string;
  name: string;
  team: number;
  color: number[];
  design_id?: number;
  secondary_color?: number[];
  weapon: string;
  secondary: string;
}): Partial<import("../store/gameStore").Player> {
  const mainColor = {
    r: Math.round((p.color?.[0] ?? 0) * 255),
    g: Math.round((p.color?.[1] ?? 0.5) * 255),
    b: Math.round((p.color?.[2] ?? 0.5) * 255),
  };
  const secondaryColor = {
    r: Math.round((p.secondary_color?.[0] ?? 0.5) * 255),
    g: Math.round((p.secondary_color?.[1] ?? 0) * 255),
    b: Math.round((p.secondary_color?.[2] ?? 0.5) * 255),
  };
  const designId = Math.min(
    4,
    p.design_id ?? 0,
  ) as import("../store/gameStore").MarbleDesignId;
  const marbleConfig: import("../store/gameStore").MarbleConfig = {
    designId,
    mainColor,
    secondaryColor,
  };
  return {
    id: canonicalPlayerId(p.id),
    name: p.name ?? "Unknown",
    team: p.team ?? 0,
    color: mainColor,
    secondaryColor,
    marbleConfig,
    weapon:
      (p.weapon as import("../store/gameStore").Player["weapon"]) ?? "smg",
    secondary:
      (p.secondary as import("../store/gameStore").Player["secondary"]) ??
      "popupKnives",
  };
}

function applyPlayerJoined(msg: any) {
  const store = useGyriiStore.getState();
  const p = msg.player;
  if (!p?.id) return;
  const profile = profileFromPayload(p);
  const id = profile.id!;
  const ourId = canonicalPlayerId(identity ?? "");
  // Merge profile into existing player, or create minimal placeholder (realtime will fill in)
  const existing = id === ourId ? store.localPlayer : store.players.get(id);
  const merged: import("../store/gameStore").Player = {
    ...(existing ?? {
      id,
      position: { x: 0, y: 0.5, z: 0 },
      rotation: 0,
      health: 1000,
      kills: 0,
      deaths: 0,
      grenadeCount: 2,
      molotovCount: 1,
      isAlive: true,
    }),
    ...profile,
  } as import("../store/gameStore").Player;
  if (id === ourId) {
    store.setLocalPlayer(merged);
  } else {
    store.updatePlayer(id, merged);
  }
}

function applyPlayerLeft(msg: any) {
  const store = useGyriiStore.getState();
  const id = canonicalPlayerId(msg.player_id ?? "");
  if (!id) return;

  if (store.localPlayer?.id === id) {
    store.setLocalPlayer(null);
  }
  store.removePlayer(id);
}

function realtimeFromPayload(p: {
  id: string;
  team?: number;
  weapon?: string;
  secondary?: string;
  position?: number[];
  health?: number;
  kills?: number;
  deaths?: number;
  velocity?: number[];
  is_alive?: boolean;
  grenade_count?: number;
  molotov_count?: number;
  last_shot_at?: number;
  last_grenade_thrown_at?: number;
  aim_x?: number;
  aim_z?: number;
}): Partial<import("../store/gameStore").Player> {
  return {
    id: canonicalPlayerId(p.id),
    team: p.team ?? 0,
    weapon:
      (p.weapon as import("../store/gameStore").Player["weapon"]) ?? "smg",
    secondary:
      (p.secondary as import("../store/gameStore").Player["secondary"]) ??
      "popupKnives",
    position: {
      x: p.position?.[0] ?? 0,
      y: p.position?.[1] ?? 0.5,
      z: p.position?.[2] ?? 0,
    },
    health: p.health ?? 1000,
    kills: p.kills ?? 0,
    deaths: p.deaths ?? 0,
    velocity: {
      x: p.velocity?.[0] ?? 0,
      y: p.velocity?.[1] ?? 0,
      z: p.velocity?.[2] ?? 0,
    },
    isAlive: p.is_alive ?? true,
    grenadeCount: p.grenade_count ?? 2,
    molotovCount: p.molotov_count ?? 1,
    lastShotAt: p.last_shot_at,
    lastGrenadeThrownAt: p.last_grenade_thrown_at,
    aimDirection:
      p.aim_x != null && p.aim_z != null
        ? { x: p.aim_x, z: p.aim_z }
        : undefined,
  };
}

const DEFAULT_PROFILE: Partial<import("../store/gameStore").Player> = {
  color: { r: 0, g: 255, b: 255 },
  secondaryColor: { r: 255, g: 0, b: 128 },
  marbleConfig: {
    designId: 0,
    mainColor: { r: 0, g: 255, b: 255 },
    secondaryColor: { r: 255, g: 0, b: 128 },
  },
  name: "Player",
  weapon: "smg",
  secondary: "popupKnives",
};

function applyDelta(msg: any) {
  const store = useGyriiStore.getState();
  const ourId = canonicalPlayerId(identity ?? "");
  for (const p of msg.players ?? []) {
    const realtime = realtimeFromPayload(p);
    const id = realtime.id!;
    const existing = id === ourId ? store.localPlayer : store.players.get(id);
    const base =
      existing ??
      ({
        ...DEFAULT_PROFILE,
        id,
        position: realtime.position,
        rotation: 0,
        health: realtime.health ?? 1000,
        kills: realtime.kills ?? 0,
        deaths: realtime.deaths ?? 0,
        team: 0,
        grenadeCount: 2,
        molotovCount: 1,
      } as import("../store/gameStore").Player);
    const merged = {
      ...base,
      ...realtime,
    } as import("../store/gameStore").Player;
    if (id === ourId) {
      store.setLocalPlayer(merged);
    } else {
      store.updatePlayer(id, merged);
    }
  }

  for (const e of msg.shot_events ?? []) {
    store.addPendingShotEvent({
      playerId: e.player_id,
      weapon: (e.weapon ?? "smg") as import("../store/gameStore").WeaponType,
      projectileType: e.projectile_type ?? 0,
      position: {
        x: e.position?.[0] ?? 0,
        y: e.position?.[1] ?? 0.5,
        z: e.position?.[2] ?? 0,
      },
      velocity: {
        x: e.velocity?.[0] ?? 0,
        y: e.velocity?.[1] ?? 0,
        z: e.velocity?.[2] ?? 0,
      },
    });
  }
  for (const g of msg.grenade_inserts ?? []) {
    store.addPendingGrenadeInsert({
      rigidBodyId: g.rigid_body_id,
      position: {
        x: g.position?.[0] ?? 0,
        y: g.position?.[1] ?? 0.5,
        z: g.position?.[2] ?? 0,
      },
      velocity: {
        x: g.velocity?.[0] ?? 0,
        y: g.velocity?.[1] ?? 0,
        z: g.velocity?.[2] ?? 0,
      },
      ownerId: g.owner_id ?? "",
      ownerColor: g.owner_color
        ? {
            r: g.owner_color[0],
            g: g.owner_color[1],
            b: g.owner_color[2],
          }
        : undefined,
    });
  }
  for (const g of msg.grenade_deletes ?? []) {
    store.addPendingGrenadeDelete({ rigidBodyId: g.rigid_body_id });
  }
  for (const g of msg.grenade_updates ?? []) {
    store.addPendingGrenadeUpdate({
      rigidBodyId: g.rigid_body_id,
      position: {
        x: g.position?.[0] ?? 0,
        y: g.position?.[1] ?? 0.5,
        z: g.position?.[2] ?? 0,
      },
      velocity: {
        x: g.velocity?.[0] ?? 0,
        y: g.velocity?.[1] ?? 0,
        z: g.velocity?.[2] ?? 0,
      },
    });
  }
  for (const k of msg.kill_events ?? []) {
    store.addKillEvent({
      killerId: k.killer_id ?? "",
      killerName: k.killer_name ?? "",
      victimId: k.victim_id ?? "",
      victimName: k.victim_name ?? "",
      weapon: k.weapon ?? "",
      timestamp: k.timestamp ?? Date.now(),
    });
  }
  const beamIds = new Set<number>();
  for (const b of msg.photon_beams ?? []) {
    const id = Number(b.id ?? 0);
    beamIds.add(id);
    store.setPhotonBeam({
      id,
      originX: b.origin_x ?? 0,
      originY: b.origin_y ?? 0.5,
      originZ: b.origin_z ?? 0,
      endX: b.end_x ?? 0,
      endY: b.end_y ?? 0.5,
      endZ: b.end_z ?? 0,
      remainingTicks: b.remaining_ticks ?? 60,
      triggerId: 1,
      worldId: 0,
    });
  }
  for (const id of Array.from(store.photonBeams.keys())) {
    if (!beamIds.has(Number(id))) {
      store.removePhotonBeam(Number(id));
    }
  }
}

function sendAction(action: string, params: Record<string, unknown> = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ action, params }));
}

export function activateGyriiServer() {
  isActive = true;
  connect();
}

export function deactivateGyriiServer() {
  isActive = false;
  if (ws) {
    ws.close();
    ws = null;
  }
  identity = null;
  useGyriiStore.getState().setConnected(false);
  useGyriiStore.getState().setConnecting(false);
  useGyriiStore.getState().setConnectionError(null);
  useGyriiStore.getState().setCurrentLobby(null);
  useGyriiStore.getState().clearPlayers();
  useGyriiStore.getState().setRoundEndedBanner(null);
}

function connect() {
  if (!isActive || ws || isConnecting) return;
  isConnecting = true;
  useGyriiStore.getState().setConnecting(true);
  useGyriiStore.getState().setConnectionError(null);

  const url = GYRII_SERVER_WS.replace(/^http/, "ws");
  ws = new WebSocket(url);

  ws.onopen = () => {
    isConnecting = false;
    useGyriiStore.getState().setConnected(true);
    useGyriiStore.getState().setConnecting(false);
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const accessToken = data.session?.access_token;
      if (accessToken) {
        sendAction("authenticate", { accessToken });
      }
    });
    sendAction("list_lobbies", {});
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "init") {
        identity = msg.identity ?? null;
      } else if (msg.type === "lobby_state") {
        applyLobbyState(msg);
      } else if (msg.type === "lobby_list") {
        applyLobbyList(msg);
      } else if (msg.type === "delta") {
        applyDelta(msg);
      } else if (msg.type === "player_joined") {
        applyPlayerJoined(msg);
      } else if (msg.type === "player_left") {
        applyPlayerLeft(msg);
      } else if (msg.type === "game_ended") {
        applyGameEnded(msg);
      }
    } catch (_) {}
  };

  ws.onclose = () => {
    isConnecting = false;
    ws = null;
    useGyriiStore.getState().setConnected(false);
    // Return to gyrii page (lobby list) when disconnected, same as leaving the game
    useGyriiStore.getState().setCurrentLobby(null);
    useGyriiStore.getState().setPendingLeaveLobby(false);
    useGyriiStore.getState().clearPlayers();
    useGyriiStore.getState().setRoundEndedBanner(null);
    if (isActive) {
      setTimeout(connect, 3000);
    }
  };

  ws.onerror = () => {
    useGyriiStore.getState().setConnectionError("WebSocket error");
  };
}

export function useGyriiServer() {
  const [isConnecting, setIsConnecting] = useState(false);
  const isConnected = useGyriiStore((s) => s.isConnected);

  useEffect(() => {
    if (!isActive) return;
    connect();
  }, []);

  useEffect(() => {
    setIsConnecting(useGyriiStore.getState().isConnecting);
  }, [isConnected]);

  // Poll lobby list every 2s when connected and not in a lobby
  const currentLobby = useGyriiStore((s) => s.currentLobby);
  useEffect(() => {
    if (!isConnected || currentLobby) return;
    sendAction("list_lobbies", {}); // Immediate fetch
    const id = setInterval(() => sendAction("list_lobbies", {}), 2000);
    return () => clearInterval(id);
  }, [isConnected, currentLobby]);

  const createLobby = useCallback(
    async (
      name: string,
      hostPlayerName: string,
      mapId: "Arena" | "Maze" | "Warehouse",
      mapPool: ("Arena" | "Maze" | "Warehouse")[],
      maxPlayers: number,
      gameMode: "FreeForAll" | "TeamDeathmatch" | "CaptureTheFlag",
      scoreLimit: number,
      flagLimit: number,
      password: string = "",
    ) => {
      sendAction("create_lobby", {
        name,
        hostPlayerName: hostPlayerName.trim() || "Player",
        mapId: { tag: mapId },
        mapPool,
        gameMode: { tag: gameMode },
        maxPlayers,
        scoreLimit,
        flagLimit,
        password,
      });
    },
    [],
  );

  const joinLobby = useCallback(
    async (lobbyId: number, playerName: string, password: string = "") => {
      sendAction("join_lobby", {
        lobbyId,
        playerName,
        password,
      });
    },
    [],
  );

  const leaveLobby = useCallback(async () => {
    sendAction("leave_lobby", {});
    useGyriiStore.getState().setCurrentLobby(null);
    useGyriiStore.getState().clearPlayers();
  }, []);

  const updateInput = useCallback(
    async (
      directionX: number,
      directionZ: number,
      aimDirectionX: number,
      aimDirectionZ: number,
    ) => {
      sendAction("update_input", {
        inputX: directionX,
        inputZ: directionZ,
        aimX: aimDirectionX,
        aimZ: aimDirectionZ,
      });
    },
    [],
  );

  const setShooting = useCallback(
    async (isShooting: boolean, aimX: number, aimZ: number) => {
      sendAction("set_shooting", { isShooting, aimX, aimZ });
    },
    [],
  );

  const setMarbleConfig = useCallback(
    async (config: import("../store/gameStore").MarbleConfig) => {
      sendAction("set_marble_config", {
        designId: config.designId,
        mainR: config.mainColor.r / 255,
        mainG: config.mainColor.g / 255,
        mainB: config.mainColor.b / 255,
        secR: config.secondaryColor.r / 255,
        secG: config.secondaryColor.g / 255,
        secB: config.secondaryColor.b / 255,
      });
    },
    [],
  );

  const requestSpawn = useCallback(
    async (weapon: string, secondary: string) => {
      const weaponMap: Record<string, string> = {
        smg: "Smg",
        dualMachineGun: "DualMachineGun",
        chainGun: "ChainGun",
        photonRifle: "PhotonRifle",
        bazooka: "Bazooka",
        flamethrower: "Flamethrower",
      };
      const secondaryMap: Record<string, string> = {
        popupKnives: "PopupKnives",
        bubbleShield: "BubbleShield",
        selfDestructNuke: "SelfDestructNuke",
      };
      sendAction("request_spawn", {
        weapon: { tag: weaponMap[weapon] ?? "Smg" },
        secondary: { tag: secondaryMap[secondary] ?? "PopupKnives" },
      });
    },
    [],
  );

  const refreshLobbies = useCallback(() => {
    sendAction("list_lobbies", {});
  }, []);

  return {
    isConnecting,
    createLobby,
    joinLobby,
    refreshLobbies,
    setMarbleConfig,
    leaveLobby,
    toggleReady: async () => {},
    startGame: async () => {
      sendAction("start_game", {});
    },
    updateInput,
    setShooting,
    shoot: async () => {},
    throwGrenade: async (aimX: number, aimZ: number) => {
      sendAction("throw_grenade", { aimX, aimZ });
    },
    throwMolotov: async (aimX: number, aimZ: number) => {
      sendAction("throw_molotov", { aimX, aimZ });
    },
    useSecondary: async () => {},
    setLoadout: async () => {},
    requestSpawn,
  };
}

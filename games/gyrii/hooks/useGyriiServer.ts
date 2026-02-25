/**
 * WebSocket client for the new Rust Gyrii server.
 * Use when NEXT_PUBLIC_GYRII_USE_NEW_SERVER=true.
 * Uses binary protobuf for all messages (client and server).
 */

import { useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { canonicalPlayerId, useGyriiStore } from "../store/gameStore";
import type { Player } from "../store/gameStore";
import {
  GameMode,
  GameState,
  MapId,
  type Player as ProtoPlayer,
  type PlayerRealtime as ProtoPlayerRealtime,
  type PlayerProfile as ProtoPlayerProfile,
  type Lobby as ProtoLobby,
  type LobbySummary as ProtoLobbySummary,
  WeaponType as ProtoWeaponType,
  SecondaryType as ProtoSecondaryType,
} from "../proto-gen/gyrii_pb";
import * as transport from "../services/gyriiTransport";
import * as gyriiClient from "../services/gyriiClient";
import * as messageRouter from "../services/gyriiMessageRouter";
const DELTA_GAP_TIMEOUT_MS = 33;
const lastAppliedDeltaIdByLobby = new Map<string, number>();
const pendingDeltasByLobby = new Map<string, Map<number, any>>();
const gapTimersByLobby = new Map<string, ReturnType<typeof setTimeout>>();
let unregisterMessageHandler: (() => void) | null = null;

function bytesToUuidString(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hex.length === 32) {
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
  return hex;
}

function weaponProtoToStr(n: number): string {
  const m: Record<number, string> = {
    [ProtoWeaponType.WEAPON_SMG]: "smg",
    [ProtoWeaponType.WEAPON_DUAL_MACHINE_GUN]: "dualMachineGun",
    [ProtoWeaponType.WEAPON_CHAIN_GUN]: "chainGun",
    [ProtoWeaponType.WEAPON_PHOTON_RIFLE]: "photonRifle",
    [ProtoWeaponType.WEAPON_BAZOOKA]: "bazooka",
    [ProtoWeaponType.WEAPON_FLAMETHROWER]: "flamethrower",
    [ProtoWeaponType.WEAPON_SHOTGUN]: "shotgun",
  };
  return m[n] ?? "smg";
}

function secondaryProtoToStr(n: number): string {
  const m: Record<number, string> = {
    [ProtoSecondaryType.SECONDARY_POPUP_KNIVES]: "popupKnives",
    [ProtoSecondaryType.SECONDARY_BUBBLE_SHIELD]: "bubbleShield",
    [ProtoSecondaryType.SECONDARY_SELF_DESTRUCT_NUKE]: "selfDestructNuke",
  };
  return m[n] ?? "popupKnives";
}

function gameModeProtoToStr(n: number): string {
  const m: Record<number, string> = {
    [GameMode.FREE_FOR_ALL]: "freeForAll",
    [GameMode.TEAM_DEATHMATCH]: "teamDeathmatch",
    [GameMode.CAPTURE_THE_FLAG]: "captureTheFlag",
  };
  return m[n] ?? "freeForAll";
}

function gameStateProtoToStr(n: number): string {
  const m: Record<number, string> = {
    [GameState.WAITING]: "waiting",
    [GameState.STARTING]: "starting",
    [GameState.IN_PROGRESS]: "inProgress",
    [GameState.ENDED]: "ended",
  };
  return m[n] ?? "waiting";
}

function mapIdProtoToStr(n: number): string {
  const m: Record<number, string> = {
    [MapId.MAP_ARENA]: "arena",
    [MapId.MAP_MAZE]: "maze",
    [MapId.MAP_WAREHOUSE]: "warehouse",
    [MapId.MAP_CUSTOM]: "custom",
  };
  return m[n] ?? "arena";
}

function protoPlayerToJson(
  p: ProtoPlayer,
): Parameters<typeof playerFromPayload>[0] {
  return {
    id: bytesToUuidString(p.id),
    name: p.name,
    position: [p.positionX, p.positionY, p.positionZ],
    color: [p.colorR, p.colorG, p.colorB],
    secondary_color: [p.secondaryColorR, p.secondaryColorG, p.secondaryColorB],
    weapon: weaponProtoToStr(p.weapon),
    secondary: secondaryProtoToStr(p.secondary),
    velocity: [p.velocityX, p.velocityY, p.velocityZ],
    server_snapshot_id: Number(p.serverSnapshotId),
    design_id: p.designId,
    health: p.health,
    kills: p.kills,
    deaths: p.deaths,
    team: p.team,
    is_alive: p.isAlive,
    grenade_count: p.grenadeCount,
    molotov_count: p.molotovCount,
    last_shot_at: p.lastShotAt,
    last_grenade_thrown_at: p.lastGrenadeThrownAt,
    aim_x: p.aimX,
    aim_z: p.aimZ,
  } as any;
}

function protoPlayerRealtimeToJson(
  p: ProtoPlayerRealtime,
): Parameters<typeof realtimeFromPayload>[0] {
  return {
    id: bytesToUuidString(p.id),
    team: p.team,
    weapon: weaponProtoToStr(p.weapon),
    secondary: secondaryProtoToStr(p.secondary),
    position: [p.positionX, p.positionY, p.positionZ],
    health: p.health,
    kills: p.kills,
    deaths: p.deaths,
    velocity: [p.velocityX, p.velocityY, p.velocityZ],
    server_snapshot_id: Number(p.serverSnapshotId),
    is_alive: p.isAlive,
    grenade_count: p.grenadeCount,
    molotov_count: p.molotovCount,
    last_shot_at: p.lastShotAt,
    last_grenade_thrown_at: p.lastGrenadeThrownAt,
    aim_x: p.aimX,
    aim_z: p.aimZ,
  } as any;
}

function protoProfileToJson(
  p: ProtoPlayerProfile,
): Parameters<typeof profileFromPayload>[0] {
  return {
    id: bytesToUuidString(p.id),
    name: p.name,
    team: p.team,
    color: [p.colorR, p.colorG, p.colorB],
    secondary_color: [p.secondaryColorR, p.secondaryColorG, p.secondaryColorB],
    design_id: p.designId,
    weapon: weaponProtoToStr(p.weapon),
    secondary: secondaryProtoToStr(p.secondary),
  } as any;
}

function protoLobbyToJson(l: ProtoLobby): any {
  return {
    id: String(l.id),
    name: l.name,
    host_id: bytesToUuidString(l.hostId),
    map_id: mapIdProtoToStr(l.mapId),
    map_pool: l.mapPool.map(mapIdProtoToStr),
    max_players: l.maxPlayers,
    game_mode: gameModeProtoToStr(l.gameMode),
    game_state: gameStateProtoToStr(l.gameState),
    score_limit: l.scoreLimit,
    flag_limit: l.flagLimit,
    next_round_starts_at_ms: l.nextRoundStartsAtMs,
    is_custom_map: l.isCustomMap ?? false,
    map_json: l.mapJson,
  };
}

function protoLobbySummaryToJson(l: ProtoLobbySummary): any {
  return {
    id: String(l.id),
    name: l.name,
    host_id: bytesToUuidString(l.hostId),
    map_id: mapIdProtoToStr(l.mapId),
    map_pool: l.mapPool.map(mapIdProtoToStr),
    max_players: l.maxPlayers,
    player_count: l.playerCount,
    game_mode: gameModeProtoToStr(l.gameMode),
    game_state: gameStateProtoToStr(l.gameState),
    has_password: l.hasPassword,
    score_limit: l.scoreLimit,
    flag_limit: l.flagLimit,
    next_round_starts_at_ms: l.nextRoundStartsAtMs,
    is_custom_map: l.isCustomMap ?? false,
  };
}

function protoDeltaToMsg(d: import("../proto-gen/gyrii_pb").Delta): any {
  return {
    delta_id: Number(d.deltaId),
    base_snapshot_id: Number(d.baseSnapshotId),
    players: d.players.map((p) => protoPlayerRealtimeToJson(p)),
    shot_events: d.shotEvents.map((e) => ({
      player_id: bytesToUuidString(e.playerId),
      weapon: weaponProtoToStr(e.weapon),
      projectile_type: e.projectileType ?? 0,
      position: [e.positionX, e.positionY, e.positionZ],
      velocity: [e.velocityX, e.velocityY, e.velocityZ],
    })),
    grenade_inserts: d.grenadeInserts.map((g) => ({
      rigid_body_id: Number(g.rigidBodyId),
      position: [g.positionX, g.positionY, g.positionZ],
      velocity: [g.velocityX, g.velocityY, g.velocityZ],
      owner_id: bytesToUuidString(g.ownerId),
      owner_color: [g.ownerColorR, g.ownerColorG, g.ownerColorB],
    })),
    grenade_deletes: d.grenadeDeletes.map((g) => ({
      rigid_body_id: Number(g.rigidBodyId),
    })),
    grenade_updates: d.grenadeUpdates.map((g) => ({
      rigid_body_id: Number(g.rigidBodyId),
      position: [g.positionX, g.positionY, g.positionZ],
      velocity: [g.velocityX, g.velocityY, g.velocityZ],
    })),
    kill_events: d.killEvents.map((k) => ({
      killer_id: bytesToUuidString(k.killerId),
      killer_name: k.killerName ?? "",
      victim_id: bytesToUuidString(k.victimId),
      victim_name: k.victimName ?? "",
      weapon: k.weapon ?? "",
      timestamp: Number(k.timestamp ?? 0),
    })),
    photon_beams: d.photonBeams.map((b) => ({
      id: Number(b.id),
      owner_id: bytesToUuidString(b.ownerId),
      origin_x: b.originX,
      origin_y: b.originY,
      origin_z: b.originZ,
      end_x: b.endX,
      end_y: b.endY,
      end_z: b.endZ,
      remaining_ticks: b.remainingTicks ?? 0,
    })),
  };
}

function clearDeltaTracking(lobbyId?: string) {
  if (lobbyId) {
    const timer = gapTimersByLobby.get(lobbyId);
    if (timer) clearTimeout(timer);
    gapTimersByLobby.delete(lobbyId);
    pendingDeltasByLobby.delete(lobbyId);
    return;
  }
  for (const timer of gapTimersByLobby.values()) {
    clearTimeout(timer);
  }
  gapTimersByLobby.clear();
  pendingDeltasByLobby.clear();
  lastAppliedDeltaIdByLobby.clear();
}

function playerFromPayload(
  p: {
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
    server_snapshot_id?: number;
    is_alive: boolean;
    grenade_count: number;
    molotov_count: number;
    last_shot_at?: number;
    last_grenade_thrown_at?: number;
    aim_x?: number;
    aim_z?: number;
  },
  fallbackSnapshotId = 0,
): Player {
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
    lastShotAt: p.last_shot_at != null ? Number(p.last_shot_at) : undefined,
    lastGrenadeThrownAt:
      p.last_grenade_thrown_at != null
        ? Number(p.last_grenade_thrown_at)
        : undefined,
    aimDirection:
      p.aim_x != null && p.aim_z != null
        ? { x: p.aim_x, z: p.aim_z }
        : undefined,
    velocity: {
      x: p.velocity?.[0] ?? 0,
      y: p.velocity?.[1] ?? 0,
      z: p.velocity?.[2] ?? 0,
    },
    serverSnapshotId: Number(p.server_snapshot_id ?? fallbackSnapshotId) || 0,
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
    isCustomMap: l.is_custom_map ?? false,
    mapJson: l.map_json,
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
    isCustomMap: l.is_custom_map ?? false,
  };
}

function applyLobbyState(msg: any) {
  const store = useGyriiStore.getState();
  store.clearPlayers();
  const lobby = lobbyFromPayload(msg.lobby, msg.players?.length ?? 0);
  const snapshotId = Number(msg.snapshot_id ?? 0) || 0;
  const lastDeltaId = Number(msg.last_delta_id ?? 0) || 0;
  clearDeltaTracking(lobby.id);
  lastAppliedDeltaIdByLobby.set(lobby.id, lastDeltaId);
  store.setCurrentLobby(lobby);
  if (lobby.gameState !== "ended") {
    store.setRoundEndedBanner(null);
  }
  const ourId = canonicalPlayerId(transport.getIdentity() ?? "");
  let didSetLocalPlayer = false;
  let localPlayerIsAlive: boolean | undefined;
  for (const p of msg.players ?? []) {
    const player = playerFromPayload(p, snapshotId);
    if (player.id === ourId) {
      store.setLocalPlayer(player);
      didSetLocalPlayer = true;
      localPlayerIsAlive = player.isAlive;
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
  const ourId = canonicalPlayerId(transport.getIdentity() ?? "");
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

function realtimeFromPayload(
  p: {
    id: string;
    team?: number;
    weapon?: string;
    secondary?: string;
    position?: number[];
    health?: number;
    kills?: number;
    deaths?: number;
    velocity?: number[];
    server_snapshot_id?: number;
    is_alive?: boolean;
    grenade_count?: number;
    molotov_count?: number;
    last_shot_at?: number;
    last_grenade_thrown_at?: number;
    aim_x?: number;
    aim_z?: number;
  },
  fallbackSnapshotId = 0,
): Partial<import("../store/gameStore").Player> {
  const snapshotId = Math.max(
    Number(p.server_snapshot_id ?? 0) || 0,
    fallbackSnapshotId,
  );
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
    serverSnapshotId: snapshotId,
    isAlive: p.is_alive ?? true,
    grenadeCount: p.grenade_count ?? 2,
    molotovCount: p.molotov_count ?? 1,
    lastShotAt: p.last_shot_at != null ? Number(p.last_shot_at) : undefined,
    lastGrenadeThrownAt:
      p.last_grenade_thrown_at != null
        ? Number(p.last_grenade_thrown_at)
        : undefined,
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
  const lobbyId = String(store.currentLobby?.id ?? "");
  if (!lobbyId) return;
  const deltaId = Number(msg.delta_id ?? 0) || 0;
  if (deltaId <= 0) {
    applyCommittedDelta(msg);
    return;
  }

  const pending = pendingDeltasByLobby.get(lobbyId) ?? new Map<number, any>();
  pending.set(deltaId, msg);
  pendingDeltasByLobby.set(lobbyId, pending);

  let lastApplied = lastAppliedDeltaIdByLobby.get(lobbyId) ?? 0;
  if (deltaId <= lastApplied) {
    pending.delete(deltaId);
    return;
  }

  while (pending.has(lastApplied + 1)) {
    const next = pending.get(lastApplied + 1);
    pending.delete(lastApplied + 1);
    applyCommittedDelta(next);
    lastApplied += 1;
    lastAppliedDeltaIdByLobby.set(lobbyId, lastApplied);
  }

  const hasGap = pending.size > 0;
  const existingTimer = gapTimersByLobby.get(lobbyId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    gapTimersByLobby.delete(lobbyId);
  }
  if (!hasGap) return;

  const timer = setTimeout(() => {
    const outstanding = pendingDeltasByLobby.get(lobbyId);
    const stillHasGap = outstanding != null && outstanding.size > 0;
    if (!stillHasGap) return;
    // Missing delta(s) after short wait: ask server for authoritative snapshot resync.
    gyriiClient.requestLobbyState();
    pendingDeltasByLobby.set(lobbyId, new Map());
  }, DELTA_GAP_TIMEOUT_MS);
  gapTimersByLobby.set(lobbyId, timer);
}

function applyCommittedDelta(msg: any) {
  const store = useGyriiStore.getState();
  const ourId = canonicalPlayerId(transport.getIdentity() ?? "");
  const deltaId = Number(msg.delta_id ?? 0) || 0;
  const baseSnapshotId = Number(msg.base_snapshot_id ?? 0) || 0;
  const authoritativeFrameId = deltaId > 0 ? deltaId : baseSnapshotId;
  for (const p of msg.players ?? []) {
    const incomingSnapshotId = authoritativeFrameId;
    const id = canonicalPlayerId(p.id ?? "");
    if (!id) continue;
    const existing = id === ourId ? store.localPlayer : store.players.get(id);
    const existingSnapshotId = existing?.serverSnapshotId ?? -1;
    // Ignore stale or duplicate realtime payloads for this player.
    if (incomingSnapshotId <= existingSnapshotId) continue;

    const realtime = realtimeFromPayload(p, authoritativeFrameId);
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
      playerId: canonicalPlayerId(e.player_id ?? ""),
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

/** Direct spawn action - call from anywhere to bypass hook/callback issues */
export function requestSpawnAction(
  weapon:
    | "smg"
    | "dualMachineGun"
    | "chainGun"
    | "photonRifle"
    | "bazooka"
    | "flamethrower" = "dualMachineGun",
  secondary:
    | "popupKnives"
    | "bubbleShield"
    | "selfDestructNuke" = "popupKnives",
) {
  gyriiClient.requestSpawn(weapon, secondary);
}

function setupMessageHandler() {
  if (unregisterMessageHandler) return;
  transport.onMessage((data) => messageRouter.dispatch(data));
  unregisterMessageHandler = messageRouter.register(
    ({ case: msgCase, value }) => {
      switch (msgCase) {
        case "init":
          transport.setIdentityFromInit(
            (value as { identity: Uint8Array }).identity,
          );
          clearDeltaTracking();
          break;
        case "ok":
          break;
        case "error":
          console.warn(
            "Gyrii server action error:",
            (value as { error: string }).error,
          );
          break;
        case "lobbyState": {
          const ls = value as {
            lobby?: import("../proto-gen/gyrii_pb").Lobby;
            players?: import("../proto-gen/gyrii_pb").Player[];
            snapshotId?: bigint;
            lastDeltaId?: bigint;
          };
          const lobby = ls.lobby;
          if (!lobby) break;
          applyLobbyState({
            lobby: protoLobbyToJson(lobby),
            players: (ls.players ?? []).map(protoPlayerToJson),
            snapshot_id: Number(ls.snapshotId ?? 0),
            last_delta_id: Number(ls.lastDeltaId ?? 0),
          });
          break;
        }
        case "lobbyList":
          applyLobbyList({
            lobbies: (
              (
                value as {
                  lobbies: import("../proto-gen/gyrii_pb").LobbySummary[];
                }
              ).lobbies ?? []
            ).map(protoLobbySummaryToJson),
          });
          break;
        case "delta":
          applyDelta(
            protoDeltaToMsg(value as import("../proto-gen/gyrii_pb").Delta),
          );
          break;
        case "playerJoined": {
          const p = (
            value as { player?: import("../proto-gen/gyrii_pb").PlayerProfile }
          ).player;
          if (p) applyPlayerJoined({ player: protoProfileToJson(p) });
          break;
        }
        case "playerLeft":
          applyPlayerLeft({
            player_id: bytesToUuidString(
              (value as { playerId: Uint8Array }).playerId,
            ),
          });
          break;
        case "gameEnded": {
          const ge = value as {
            lobbyId?: bigint;
            winnerTeam?: number;
            winnerPlayerIdentity?: Uint8Array;
            winnerPlayerName?: string;
            nextMapId?: number;
            countdownMs?: bigint;
          };
          applyGameEnded({
            lobby_id: String(ge.lobbyId ?? ""),
            winner_team: ge.winnerTeam ?? undefined,
            winner_player_identity: ge.winnerPlayerIdentity
              ? bytesToUuidString(ge.winnerPlayerIdentity)
              : undefined,
            winner_player_name: ge.winnerPlayerName ?? undefined,
            next_map_id: mapIdProtoToStr(ge.nextMapId ?? 0),
            countdown_ms: Number(ge.countdownMs ?? 5000),
          });
          break;
        }
        default:
          break;
      }
    },
  );
}

export function activateGyriiServer() {
  transport.setActive(true);
  setupMessageHandler();
  transport.connect(
    (connecting, connected) => {
      useGyriiStore.getState().setConnecting(connecting);
      useGyriiStore.getState().setConnected(connected);
      if (!connected) {
        useGyriiStore
          .getState()
          .setConnectionError(connecting ? null : "WebSocket disconnected");
        useGyriiStore.getState().setCurrentLobby(null);
        useGyriiStore.getState().setPendingLeaveLobby(false);
        useGyriiStore.getState().clearPlayers();
        useGyriiStore.getState().setRoundEndedBanner(null);
        clearDeltaTracking();
      }
    },
    () => {
      clearDeltaTracking();
      const supabase = createClient();
      supabase.auth.getSession().then(({ data }) => {
        const accessToken = data.session?.access_token;
        if (accessToken) gyriiClient.authenticate(accessToken);
      });
      gyriiClient.listLobbies();
    },
  );
}

export function deactivateGyriiServer() {
  unregisterMessageHandler?.();
  unregisterMessageHandler = null;
  transport.disconnect();
  useGyriiStore.getState().setConnected(false);
  useGyriiStore.getState().setConnecting(false);
  useGyriiStore.getState().setConnectionError(null);
  useGyriiStore.getState().setCurrentLobby(null);
  useGyriiStore.getState().clearPlayers();
  useGyriiStore.getState().setRoundEndedBanner(null);
  clearDeltaTracking();
}

export function useGyriiServer() {
  const isConnecting = useGyriiStore((s) => s.isConnecting);
  const isConnected = useGyriiStore((s) => s.isConnected);

  // Poll lobby list every 2s when connected and not in a lobby
  const currentLobby = useGyriiStore((s) => s.currentLobby);
  useEffect(() => {
    if (!isConnected || currentLobby) return;
    gyriiClient.listLobbies();
    const id = setInterval(() => gyriiClient.listLobbies(), 2000);
    return () => clearInterval(id);
  }, [isConnected, currentLobby]);

  const createLobby = useCallback(
    (
      name: string,
      hostPlayerName: string,
      mapId: "Arena" | "Maze" | "Warehouse" | "Custom",
      mapPool: ("Arena" | "Maze" | "Warehouse")[],
      maxPlayers: number,
      gameMode: "FreeForAll" | "TeamDeathmatch" | "CaptureTheFlag",
      scoreLimit: number,
      flagLimit: number,
      password: string = "",
      customMapJson?: string,
    ) => {
      gyriiClient.createLobby(
        name,
        hostPlayerName,
        mapId,
        mapPool,
        maxPlayers,
        gameMode,
        scoreLimit,
        flagLimit,
        password,
        customMapJson,
      );
    },
    [],
  );

  const joinLobby = useCallback(
    (lobbyId: number, playerName: string, password: string = "") => {
      gyriiClient.joinLobby(lobbyId, playerName, password);
    },
    [],
  );

  const leaveLobby = useCallback(() => {
    gyriiClient.leaveLobby();
    useGyriiStore.getState().setCurrentLobby(null);
    useGyriiStore.getState().clearPlayers();
    clearDeltaTracking();
  }, []);

  const updateInput = useCallback(
    (
      directionX: number,
      directionZ: number,
      aimDirectionX: number,
      aimDirectionZ: number,
    ) => {
      gyriiClient.updateInput(
        directionX,
        directionZ,
        aimDirectionX,
        aimDirectionZ,
      );
    },
    [],
  );

  const setShooting = useCallback(
    (isShooting: boolean, aimX: number, aimZ: number) => {
      gyriiClient.setShooting(isShooting, aimX, aimZ);
    },
    [],
  );

  const setMarbleConfig = useCallback(
    (config: import("../store/gameStore").MarbleConfig) => {
      gyriiClient.setMarbleConfig(config);
    },
    [],
  );

  const requestSpawn = useCallback((weapon: string, secondary: string) => {
    gyriiClient.requestSpawn(
      weapon as
        | "smg"
        | "dualMachineGun"
        | "chainGun"
        | "photonRifle"
        | "bazooka"
        | "flamethrower",
      secondary as "popupKnives" | "bubbleShield" | "selfDestructNuke",
    );
  }, []);

  const refreshLobbies = useCallback(() => {
    gyriiClient.listLobbies();
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
      gyriiClient.startGame();
    },
    updateInput,
    setShooting,
    shoot: async () => {},
    throwGrenade: async (aimX: number, aimZ: number) => {
      gyriiClient.throwGrenade(aimX, aimZ);
    },
    throwMolotov: async (aimX: number, aimZ: number) => {
      gyriiClient.throwMolotov(aimX, aimZ);
    },
    useSecondary: async () => {},
    setLoadout: async () => {},
    requestSpawn,
  };
}

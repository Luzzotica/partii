/**
 * Gyrii client - sends protobuf ClientMessage to server.
 * Uses gyriiTransport for binary send.
 */

import { create, toBinary } from "@bufbuild/protobuf";
import { ClientMessageSchema } from "../proto-gen/gyrii_pb";
import {
  AuthenticateSchema,
  ListLobbiesSchema,
  CreateLobbySchema,
  JoinLobbySchema,
  RequestLobbyStateSchema,
  LeaveLobbySchema,
  SetReadySchema,
  StartGameSchema,
  EndGameSchema,
  RequestSpawnSchema,
  UpdateInputSchema,
  SetShootingSchema,
  SetLoadoutSchema,
  SetMarbleConfigSchema,
  ShootSchema,
  DetonateRocketSchema,
  ThrowGrenadeSchema,
  ThrowMolotovSchema,
  UseSecondarySchema,
} from "../proto-gen/actions_pb";
import {
  GameMode,
  MapId,
  WeaponType,
  SecondaryType,
} from "../proto-gen/common_pb";
import * as transport from "./gyriiTransport";

function weaponToProto(
  w:
    | "smg"
    | "dualMachineGun"
    | "chainGun"
    | "photonRifle"
    | "bazooka"
    | "flamethrower"
    | "shotgun",
): WeaponType {
  const m: Record<string, WeaponType> = {
    smg: WeaponType.WEAPON_SMG,
    dualMachineGun: WeaponType.WEAPON_DUAL_MACHINE_GUN,
    chainGun: WeaponType.WEAPON_CHAIN_GUN,
    photonRifle: WeaponType.WEAPON_PHOTON_RIFLE,
    bazooka: WeaponType.WEAPON_BAZOOKA,
    flamethrower: WeaponType.WEAPON_FLAMETHROWER,
    shotgun: WeaponType.WEAPON_SHOTGUN,
  };
  return m[w] ?? WeaponType.WEAPON_SMG;
}

function secondaryToProto(
  s:
    | "popupKnives"
    | "bubbleShield"
    | "selfDestructNuke"
    | "popupHammers"
    | "dash",
): SecondaryType {
  const m: Record<string, SecondaryType> = {
    popupKnives: SecondaryType.SECONDARY_POPUP_KNIVES,
    bubbleShield: SecondaryType.SECONDARY_BUBBLE_SHIELD,
    selfDestructNuke: SecondaryType.SECONDARY_SELF_DESTRUCT_NUKE,
    popupHammers: SecondaryType.SECONDARY_POPUP_HAMMERS,
    dash: SecondaryType.SECONDARY_DASH,
  };
  return m[s] ?? SecondaryType.SECONDARY_POPUP_KNIVES;
}

function mapIdToProto(
  m:
    | "Arena"
    | "Maze"
    | "Warehouse"
    | "Custom"
    | "arena"
    | "maze"
    | "warehouse"
    | "custom",
): MapId {
  const key = m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
  const map: Record<string, MapId> = {
    Arena: MapId.MAP_ARENA,
    Maze: MapId.MAP_MAZE,
    Warehouse: MapId.MAP_WAREHOUSE,
    Custom: MapId.MAP_CUSTOM,
  };
  return map[key] ?? MapId.MAP_ARENA;
}

function gameModeToProto(
  g: "FreeForAll" | "TeamDeathmatch" | "CaptureTheFlag",
): GameMode {
  const m: Record<string, GameMode> = {
    FreeForAll: GameMode.FREE_FOR_ALL,
    TeamDeathmatch: GameMode.TEAM_DEATHMATCH,
    CaptureTheFlag: GameMode.CAPTURE_THE_FLAG,
  };
  return m[g] ?? GameMode.FREE_FOR_ALL;
}

function send(
  msg: ReturnType<typeof create<typeof ClientMessageSchema>>,
): void {
  const bytes = toBinary(ClientMessageSchema, msg);
  transport.sendBinary(bytes);
}

export function authenticate(accessToken: string): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "authenticate",
        value: create(AuthenticateSchema, { accessToken }),
      },
    }),
  );
}

export function listLobbies(): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "listLobbies",
        value: create(ListLobbiesSchema, {}),
      },
    }),
  );
}

export function createLobby(
  name: string,
  hostPlayerName: string,
  mapId: "Arena" | "Maze" | "Warehouse" | "Custom",
  mapPool: ("Arena" | "Maze" | "Warehouse")[],
  maxPlayers: number,
  gameMode: "FreeForAll" | "TeamDeathmatch" | "CaptureTheFlag",
  scoreLimit: number,
  flagLimit: number,
  password = "",
  customMapJson?: string,
  teamCount = 2,
): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "createLobby",
        value: create(CreateLobbySchema, {
          name,
          hostPlayerName: hostPlayerName.trim() || "Player",
          mapId: mapIdToProto(mapId),
          mapPool: mapPool.map((m) => mapIdToProto(m)),
          gameMode: gameModeToProto(gameMode),
          maxPlayers,
          scoreLimit,
          flagLimit,
          password,
          customMapJson: customMapJson || undefined,
          teamCount: Math.min(4, Math.max(2, teamCount)),
        }),
      },
    }),
  );
}

export function joinLobby(
  lobbyId: number,
  playerName: string,
  password = "",
): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "joinLobby",
        value: create(JoinLobbySchema, {
          lobbyId: BigInt(lobbyId),
          playerName,
          password,
        }),
      },
    }),
  );
}

export function requestLobbyState(): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "requestLobbyState",
        value: create(RequestLobbyStateSchema, {}),
      },
    }),
  );
}

export function leaveLobby(): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "leaveLobby",
        value: create(LeaveLobbySchema, {}),
      },
    }),
  );
}

export function setReady(ready = true): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "setReady",
        value: create(SetReadySchema, { ready }),
      },
    }),
  );
}

export function startGame(): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "startGame",
        value: create(StartGameSchema, {}),
      },
    }),
  );
}

export function endGame(lobbyId: number): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "endGame",
        value: create(EndGameSchema, { lobbyId: BigInt(lobbyId) }),
      },
    }),
  );
}

export function requestSpawn(
  weapon:
    | "smg"
    | "dualMachineGun"
    | "chainGun"
    | "photonRifle"
    | "bazooka"
    | "flamethrower"
    | "shotgun" = "dualMachineGun",
  secondary:
    | "popupKnives"
    | "bubbleShield"
    | "selfDestructNuke"
    | "popupHammers"
    | "dash" = "popupKnives",
): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "requestSpawn",
        value: create(RequestSpawnSchema, {
          weapon: weaponToProto(weapon),
          secondary: secondaryToProto(secondary),
        }),
      },
    }),
  );
}

export function updateInput(
  directionX: number,
  directionZ: number,
  aimDirectionX: number,
  aimDirectionZ: number,
): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "updateInput",
        value: create(UpdateInputSchema, {
          inputX: directionX,
          inputZ: directionZ,
          aimX: aimDirectionX,
          aimZ: aimDirectionZ,
        }),
      },
    }),
  );
}

export function setShooting(
  isShooting: boolean,
  aimX: number,
  aimZ: number,
): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "setShooting",
        value: create(SetShootingSchema, {
          isShooting,
          aimX,
          aimZ,
        }),
      },
    }),
  );
}

export function setLoadout(
  weapon:
    | "smg"
    | "dualMachineGun"
    | "chainGun"
    | "photonRifle"
    | "bazooka"
    | "flamethrower",
  secondary:
    | "popupKnives"
    | "bubbleShield"
    | "selfDestructNuke"
    | "popupHammers"
    | "dash",
): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "setLoadout",
        value: create(SetLoadoutSchema, {
          weapon: weaponToProto(weapon),
          secondary: secondaryToProto(secondary),
        }),
      },
    }),
  );
}

export function setMarbleConfig(config: {
  designId: number;
  mainColor: { r: number; g: number; b: number };
  secondaryColor: { r: number; g: number; b: number };
}): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "setMarbleConfig",
        value: create(SetMarbleConfigSchema, {
          designId: config.designId,
          mainR: config.mainColor.r / 255,
          mainG: config.mainColor.g / 255,
          mainB: config.mainColor.b / 255,
          secR: config.secondaryColor.r / 255,
          secG: config.secondaryColor.g / 255,
          secB: config.secondaryColor.b / 255,
        }),
      },
    }),
  );
}

export function shoot(): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "shoot",
        value: create(ShootSchema, {}),
      },
    }),
  );
}

export function throwGrenade(aimX: number, aimZ: number): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "throwGrenade",
        value: create(ThrowGrenadeSchema, { aimX, aimZ }),
      },
    }),
  );
}

export function throwMolotov(aimX: number, aimZ: number): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "throwMolotov",
        value: create(ThrowMolotovSchema, { aimX, aimZ }),
      },
    }),
  );
}

export function useSecondary(): void {
  send(
    create(ClientMessageSchema, {
      message: {
        case: "useSecondary",
        value: create(UseSecondarySchema, {}),
      },
    }),
  );
}

/**
 * Client-side Rapier physics: same world as server (floor, boundary, interior walls),
 * dynamic bodies for all players and throwables. Step each frame; reconcile on server state.
 * Rapier is loaded asynchronously; call initRapier() before createWorldFromMap.
 */

import {
  PLAYER_ACCEL,
  PLAYER_DAMPING,
  PLAYER_INPUT_TICK_DT,
  GRAVITY,
  PLAYER_BALL_RADIUS,
} from "../constants";
import {
  GROUP_BULLET,
  GROUP_FLOOR,
  GROUP_PLAYER,
  GROUP_WALL,
  collisionGroups,
} from "./collisionGroups";
import type { MapData } from "../maps/MapLoader";
import { gridToWorldX, gridToWorldZ } from "../maps/MapLoader";

const FLOOR_HALF_Y = 0.05;
const BOUNDARY_WALL_HEIGHT = 2;

type RAPIER = typeof import("@dimforge/rapier3d").default;
let RAPIER: RAPIER | null = null;
let rapierInit: Promise<void> | null = null;

export async function initRapier(): Promise<void> {
  if (RAPIER) return;
  if (rapierInit) return rapierInit;
  rapierInit = (async () => {
    const mod = await import("@dimforge/rapier3d");
    RAPIER = mod.default ?? (mod as unknown as RAPIER);
  })();
  return rapierInit;
}

function getRAPIER(): RAPIER {
  if (!RAPIER)
    throw new Error("Rapier not initialized; call initRapier() first.");
  return RAPIER;
}

export type WorldHandle = {
  world: InstanceType<RAPIER["World"]>;
  playerBodies: Map<string, InstanceType<RAPIER["RigidBody"]>>;
  throwableBodies: Map<string, InstanceType<RAPIER["RigidBody"]>>;
  lastInputTime: number;
};

/**
 * Create a Rapier world from the same map data the server uses.
 * Floor: half-space (one large thin cuboid) if no floorGrid; else merged horizontal runs.
 * Boundary: one 1×1×2 static cuboid per edge cell. Interior: mapData.walls.
 */
export function createWorldFromMap(mapData: MapData): WorldHandle {
  const R = getRAPIER();
  const gravity = { x: 0, y: GRAVITY, z: 0 };
  const world = new R.World(gravity);

  const floorMembership = GROUP_FLOOR;
  const floorFilter = GROUP_PLAYER | GROUP_BULLET;
  const wallMembership = GROUP_WALL;
  const wallFilter = GROUP_PLAYER | GROUP_BULLET;
  const playerMembership = GROUP_PLAYER;
  const playerFilter = GROUP_FLOOR | GROUP_WALL | GROUP_BULLET;

  // Floor
  if (!mapData.floorGrid || mapData.floorGrid.length === 0) {
    const halfW = mapData.width / 2;
    const halfH = mapData.height / 2;
    const floorBodyDesc = R.RigidBodyDesc.fixed().setTranslation(
      0,
      -FLOOR_HALF_Y,
      0,
    );
    const floorBody = world.createRigidBody(floorBodyDesc);
    const floorCollider = R.ColliderDesc.cuboid(
      halfW,
      FLOOR_HALF_Y,
      halfH,
    ).setCollisionGroups(collisionGroups(floorMembership, floorFilter));
    world.createCollider(floorCollider, floorBody);
  } else {
    const grid = mapData.floorGrid;
    const height = grid.length;
    const width = grid[0]?.length ?? 0;
    for (let gy = 0; gy < height; gy++) {
      const row = grid[gy] ?? [];
      let gx = 0;
      while (gx < width) {
        if ((row[gx] ?? 0) === 0) {
          gx++;
          continue;
        }
        let runEnd = gx;
        while (runEnd < width && (row[runEnd] ?? 0) === 1) runEnd++;
        const runLen = runEnd - gx;
        const midGx = gx + runLen / 2 - 0.5;
        const worldX = gridToWorldX(midGx, mapData.width);
        const worldZ = gridToWorldZ(gy, mapData.height);
        const halfX = runLen / 2;
        const halfZ = 0.5;
        const floorBodyDesc = R.RigidBodyDesc.fixed().setTranslation(
          worldX,
          -FLOOR_HALF_Y,
          worldZ,
        );
        const floorBody = world.createRigidBody(floorBodyDesc);
        const floorCollider = R.ColliderDesc.cuboid(
          halfX,
          FLOOR_HALF_Y,
          halfZ,
        ).setCollisionGroups(collisionGroups(floorMembership, floorFilter));
        world.createCollider(floorCollider, floorBody);
        gx = runEnd;
      }
    }
  }

  // Boundary: one 1×1×2 cuboid per edge cell (north, south, west, east)
  const w = mapData.width;
  const h = mapData.height;
  const wallHalf = BOUNDARY_WALL_HEIGHT / 2;
  for (let gx = 0; gx < w; gx++) {
    const wx = gridToWorldX(gx, w);
    for (const gy of [0, h - 1]) {
      const worldZ = gridToWorldZ(gy, h);
      const body = world.createRigidBody(
        R.RigidBodyDesc.fixed().setTranslation(wx, 1, worldZ),
      );
      world.createCollider(
        R.ColliderDesc.cuboid(0.5, wallHalf, 0.5).setCollisionGroups(
          collisionGroups(wallMembership, wallFilter),
        ),
        body,
      );
    }
  }
  for (let gy = 0; gy < h; gy++) {
    const wz = gridToWorldZ(gy, h);
    for (const gx of [0, w - 1]) {
      const worldX = gridToWorldX(gx, w);
      const body = world.createRigidBody(
        R.RigidBodyDesc.fixed().setTranslation(worldX, 1, wz),
      );
      world.createCollider(
        R.ColliderDesc.cuboid(0.5, wallHalf, 0.5).setCollisionGroups(
          collisionGroups(wallMembership, wallFilter),
        ),
        body,
      );
    }
  }

  // Interior walls
  for (const wall of mapData.walls) {
    const wallHeight = wall.height === 2 ? 2 : 1;
    const centerY = wallHeight / 2;
    const worldX = gridToWorldX(wall.x, mapData.width);
    const worldZ = gridToWorldZ(wall.y, mapData.height);
    const bodyDesc = R.RigidBodyDesc.fixed().setTranslation(
      worldX,
      centerY,
      worldZ,
    );
    const body = world.createRigidBody(bodyDesc);
    const collider = R.ColliderDesc.cuboid(
      0.5,
      wallHeight / 2,
      0.5,
    ).setCollisionGroups(collisionGroups(wallMembership, wallFilter));
    world.createCollider(collider, body);
  }

  return {
    world,
    playerBodies: new Map(),
    throwableBodies: new Map(),
    lastInputTime: 0,
  };
}

export function createPlayerBody(
  handle: WorldHandle,
  playerId: string,
  x: number,
  y: number,
  z: number,
  vx = 0,
  vy = 0,
  vz = 0,
): void {
  if (handle.playerBodies.has(playerId)) return;
  const R = getRAPIER();
  const bodyDesc = R.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinvel(vx, vy, vz)
    .setCcdEnabled(true);
  const body = handle.world.createRigidBody(bodyDesc);
  const collider = R.ColliderDesc.ball(PLAYER_BALL_RADIUS)
    .setMass(1)
    .setCollisionGroups(
      collisionGroups(GROUP_PLAYER, GROUP_FLOOR | GROUP_WALL | GROUP_BULLET),
    );
  handle.world.createCollider(collider, body);
  handle.playerBodies.set(playerId, body);
}

export function removePlayerBody(handle: WorldHandle, playerId: string): void {
  const body = handle.playerBodies.get(playerId);
  if (body) {
    handle.world.removeRigidBody(body);
    handle.playerBodies.delete(playerId);
  }
}

export function setPlayerState(
  handle: WorldHandle,
  playerId: string,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
): void {
  const body = handle.playerBodies.get(playerId);
  if (!body) return;
  body.setTranslation({ x, y, z }, true);
  body.setLinvel({ x: vx, y: vy, z: vz }, true);
}

export function getPlayerPosition(
  handle: WorldHandle,
  playerId: string,
): { x: number; y: number; z: number } | null {
  const body = handle.playerBodies.get(playerId);
  if (!body) return null;
  const t = body.translation();
  return { x: t.x, y: t.y, z: t.z };
}

export function getPlayerLinvel(
  handle: WorldHandle,
  playerId: string,
): { x: number; y: number; z: number } | null {
  const body = handle.playerBodies.get(playerId);
  if (!body) return null;
  const v = body.linvel();
  return { x: v.x, y: v.y, z: v.z };
}

/** Apply impulse to player body (e.g. hit prediction when server sends lastImpulse). */
export function applyImpulseToPlayer(
  handle: WorldHandle,
  playerId: string,
  ix: number,
  iy: number,
  iz: number,
): void {
  const body = handle.playerBodies.get(playerId);
  if (!body) return;
  const v = body.linvel();
  body.setLinvel({ x: v.x + ix, y: v.y + iy, z: v.z + iz }, true);
}

/**
 * Apply input for local player at input-tick rate (same formula as server).
 */
export function applyInput(
  handle: WorldHandle,
  playerId: string,
  inputX: number,
  inputZ: number,
  now: number,
): void {
  const body = handle.playerBodies.get(playerId);
  if (!body) return;
  const dt = PLAYER_INPUT_TICK_DT;
  const elapsed = now - handle.lastInputTime;
  if (elapsed < dt) return;
  handle.lastInputTime = now;
  const v = body.linvel();
  let vx = v.x + inputX * PLAYER_ACCEL * dt;
  let vz = v.z + inputZ * PLAYER_ACCEL * dt;
  vx *= PLAYER_DAMPING;
  vz *= PLAYER_DAMPING;
  body.setLinvel({ x: vx, y: v.y, z: vz }, true);
}

export function step(handle: WorldHandle, dt: number): void {
  handle.world.step();
}

// --- Throwables ---

export function createThrowableBody(
  handle: WorldHandle,
  id: string,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  radius = 0.2,
  gravityScale = 1,
): void {
  if (handle.throwableBodies.has(id)) return;
  const R = getRAPIER();
  const bodyDesc = R.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinvel(vx, vy, vz)
    .setGravityScale(gravityScale);
  const body = handle.world.createRigidBody(bodyDesc);
  const collider = R.ColliderDesc.ball(radius).setCollisionGroups(
    collisionGroups(GROUP_BULLET, GROUP_FLOOR | GROUP_WALL),
  );
  handle.world.createCollider(collider, body);
  handle.throwableBodies.set(id, body);
}

export function removeThrowableBody(handle: WorldHandle, id: string): void {
  const body = handle.throwableBodies.get(id);
  if (body) {
    handle.world.removeRigidBody(body);
    handle.throwableBodies.delete(id);
  }
}

export function getThrowablePosition(
  handle: WorldHandle,
  id: string,
): { x: number; y: number; z: number } | null {
  const body = handle.throwableBodies.get(id);
  if (!body) return null;
  const t = body.translation();
  return { x: t.x, y: t.y, z: t.z };
}

export function destroyWorld(handle: WorldHandle): void {
  handle.world.free();
  handle.playerBodies.clear();
  handle.throwableBodies.clear();
}

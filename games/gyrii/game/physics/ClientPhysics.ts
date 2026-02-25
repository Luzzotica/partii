/**
 * Client-side Rapier physics: same world as server (floor, boundary, interior walls),
 * dynamic bodies for all players and throwables. Step each frame; reconcile on server state.
 * Rapier is loaded asynchronously; call initRapier() before createWorldFromMap.
 *
 * Timer: Real elapsed time (deltaTime) is accumulated in physicsAccumulator. Physics steps
 * run at fixed PHYSICS_TICK_DT (1/60 s). Player input is applied once per physics step.
 */

import {
  PLAYER_ACCEL,
  PLAYER_DAMPING,
  PHYSICS_TICK_DT,
  GRAVITY,
  PLAYER_BALL_RADIUS,
} from "../constants";
import {
  GROUP_BULLET,
  GROUP_FLOOR,
  GROUP_GRENADE,
  GROUP_PLAYER,
  GROUP_WALL,
  collisionGroups,
} from "./collisionGroups";
import type { MapData } from "../maps/MapLoader";
import { gridToWorldX, gridToWorldZ } from "../maps/MapLoader";

const FLOOR_HALF_Y = 0.05;
const BOUNDARY_WALL_HEIGHT = 2;
const PLAYER_LINEAR_DAMPING = 3.5;

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

/** Grace period in seconds: own bullets don't hit self. */
export const BULLET_SELF_HIT_GRACE_SEC = 0.5;

export type WorldHandle = {
  world: InstanceType<RAPIER["World"]>;
  eventQueue: InstanceType<RAPIER["EventQueue"]>;
  playerBodies: Map<string, InstanceType<RAPIER["RigidBody"]>>;
  /** Player collider handle -> player id (for filtering self-hit). */
  colliderToPlayerId: Map<number, string>;
  /** Player id -> collider handle (for cleanup on remove). */
  playerIdToColliderHandle: Map<string, number>;
  throwableBodies: Map<string, InstanceType<RAPIER["RigidBody"]>>;
  projectileBodies: Map<
    string,
    {
      body: InstanceType<RAPIER["RigidBody"]>;
      collider: InstanceType<RAPIER["Collider"]>;
    }
  >;
  /** Collider handle -> projectile id (for collision event lookup). */
  colliderToProjectileId: Map<number, string>;
  /** Projectile id -> owner + spawn time (for self-hit grace period). */
  projectileMeta: Map<string, { ownerId: string; spawnTime: number }>;
  /** Accumulated time for fixed-step physics; consumes real elapsed time. */
  physicsAccumulator: number;
};

/** Build vertices and indices for a single trimesh collider from floorGrid (solid=1, hole=0). */
function buildFloorTrimesh(mapData: MapData): {
  vertices: Float32Array;
  indices: Uint32Array;
} {
  const grid = mapData.floorGrid!;
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const verts: number[] = [];
  const inds: number[] = [];
  let vi = 0;
  for (let gy = 0; gy < height; gy++) {
    const row = grid[gy] ?? [];
    for (let gx = 0; gx < width; gx++) {
      if ((row[gx] ?? 0) === 0) continue;
      const cx = gridToWorldX(gx, mapData.width);
      const cz = gridToWorldZ(gy, mapData.height);
      const bl = [cx - 0.5, 0, cz - 0.5];
      const br = [cx + 0.5, 0, cz - 0.5];
      const tl = [cx - 0.5, 0, cz + 0.5];
      const tr = [cx + 0.5, 0, cz + 0.5];
      verts.push(
        bl[0],
        bl[1],
        bl[2],
        br[0],
        br[1],
        br[2],
        tl[0],
        tl[1],
        tl[2],
        tr[0],
        tr[1],
        tr[2],
      );
      inds.push(vi, vi + 2, vi + 3, vi, vi + 3, vi + 1);
      vi += 4;
    }
  }
  return {
    vertices: new Float32Array(verts),
    indices: new Uint32Array(inds),
  };
}

/**
 * Build merged wall runs from mapData.walls.
 * Connected walls (same row, adjacent in X, same height) are merged into runs.
 * Returns list of { gxStart, gxEnd, gy, height } for each run.
 */
function buildMergedWallRuns(mapData: MapData): Array<{
  gxStart: number;
  gxEnd: number;
  gy: number;
  height: 1 | 2;
}> {
  const w = mapData.width;
  const h = mapData.height;
  const grid: number[][] = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => 0),
  );
  for (const wall of mapData.walls) {
    const gy = Math.min(wall.y, h - 1);
    const gx = Math.min(wall.x, w - 1);
    grid[gy][gx] = wall.height === 2 ? 2 : 1;
  }
  const runs: Array<{
    gxStart: number;
    gxEnd: number;
    gy: number;
    height: 1 | 2;
  }> = [];
  for (let gy = 0; gy < h; gy++) {
    const row = grid[gy];
    let gx = 0;
    while (gx < w) {
      const hgt = row[gx] as 0 | 1 | 2;
      if (hgt === 0) {
        gx++;
        continue;
      }
      const gxStart = gx;
      while (gx < w && (row[gx] as number) === hgt) gx++;
      runs.push({
        gxStart,
        gxEnd: gx,
        gy,
        height: hgt as 1 | 2,
      });
    }
  }
  return runs;
}

/**
 * Create a Rapier world from the same map data the server uses.
 * Floor: half-space (one cuboid) if no floorGrid; else single trimesh collider.
 * Boundary: 4 merged cuboids (north, south, west, east). Interior: merged horizontal runs.
 */
export function createWorldFromMap(mapData: MapData): WorldHandle {
  const R = getRAPIER();
  const gravity = { x: 0, y: GRAVITY, z: 0 };
  const world = new R.World(gravity);

  const floorMembership = GROUP_FLOOR;
  const floorFilter = GROUP_PLAYER | GROUP_BULLET | GROUP_GRENADE;
  const wallMembership = GROUP_WALL;
  const wallFilter = GROUP_PLAYER | GROUP_BULLET | GROUP_GRENADE;
  const playerMembership = GROUP_PLAYER;
  const playerFilter = GROUP_FLOOR | GROUP_WALL | GROUP_BULLET | GROUP_GRENADE;

  // Floor: trimesh when floorGrid has holes, else single cuboid
  const halfW = mapData.width / 2;
  const halfH = mapData.height / 2;
  const hasHoles =
    mapData.floorGrid?.some((r) => r.some((s) => s === 0)) ?? false;
  if (hasHoles) {
    const { vertices, indices } = buildFloorTrimesh(mapData);
    if (vertices.length > 0) {
      const floorBody = world.createRigidBody(
        R.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
      );
      const floorCollider = R.ColliderDesc.trimesh(
        vertices,
        indices,
      ).setCollisionGroups(collisionGroups(floorMembership, floorFilter));
      world.createCollider(floorCollider, floorBody);
    }
  } else {
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
  }

  // Boundary: 4 merged cuboids (north, south, west, east)
  const w = mapData.width;
  const h = mapData.height;
  const wallHalf = BOUNDARY_WALL_HEIGHT / 2;
  const northZ = gridToWorldZ(0, h);
  const southZ = gridToWorldZ(h - 1, h);
  const westX = gridToWorldX(0, w);
  const eastX = gridToWorldX(w - 1, w);
  const boundaryCollider = (hx: number, hy: number, hz: number) =>
    R.ColliderDesc.cuboid(hx, hy, hz).setCollisionGroups(
      collisionGroups(wallMembership, wallFilter),
    );
  world.createCollider(
    boundaryCollider(halfW, wallHalf, 0.5),
    world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, 1, northZ)),
  );
  world.createCollider(
    boundaryCollider(halfW, wallHalf, 0.5),
    world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, 1, southZ)),
  );
  world.createCollider(
    boundaryCollider(0.5, wallHalf, halfH),
    world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(westX, 1, 0)),
  );
  world.createCollider(
    boundaryCollider(0.5, wallHalf, halfH),
    world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(eastX, 1, 0)),
  );

  // Interior walls: merged horizontal runs
  const wallRuns = buildMergedWallRuns(mapData);
  for (const run of wallRuns) {
    const runLen = run.gxEnd - run.gxStart;
    const midGx = run.gxStart + runLen / 2 - 0.5;
    const worldX = gridToWorldX(midGx, w);
    const worldZ = gridToWorldZ(run.gy, h);
    const wallHeight = run.height === 2 ? 2 : 1;
    const centerY = wallHeight / 2;
    const halfX = runLen / 2;
    const halfZ = 0.5;
    const halfY = wallHeight / 2;
    const body = world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(worldX, centerY, worldZ),
    );
    world.createCollider(
      R.ColliderDesc.cuboid(halfX, halfY, halfZ).setCollisionGroups(
        collisionGroups(wallMembership, wallFilter),
      ),
      body,
    );
  }

  const eventQueue = new R.EventQueue(true);
  return {
    world,
    eventQueue,
    playerBodies: new Map(),
    colliderToPlayerId: new Map(),
    playerIdToColliderHandle: new Map(),
    throwableBodies: new Map(),
    projectileBodies: new Map(),
    colliderToProjectileId: new Map(),
    projectileMeta: new Map(),
    physicsAccumulator: 0,
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
    .setLinearDamping(PLAYER_LINEAR_DAMPING)
    .setCcdEnabled(true);
  const body = handle.world.createRigidBody(bodyDesc);
  const colliderDesc = R.ColliderDesc.ball(PLAYER_BALL_RADIUS)
    .setMass(1)
    .setCollisionGroups(
      collisionGroups(
        GROUP_PLAYER,
        GROUP_FLOOR | GROUP_WALL | GROUP_BULLET | GROUP_PLAYER,
      ),
    );
  const collider = handle.world.createCollider(colliderDesc, body);
  handle.colliderToPlayerId.set(collider.handle, playerId);
  handle.playerIdToColliderHandle.set(playerId, collider.handle);
  handle.playerBodies.set(playerId, body);
}

export function removePlayerBody(handle: WorldHandle, playerId: string): void {
  const body = handle.playerBodies.get(playerId);
  if (body) {
    const colliderHandle = handle.playerIdToColliderHandle.get(playerId);
    if (colliderHandle != null) {
      handle.colliderToPlayerId.delete(colliderHandle);
      handle.playerIdToColliderHandle.delete(playerId);
    }
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
 * Apply one fixed timestep of player input. Matches server apply_input formula.
 * Called internally by step() before each physics step when input is provided.
 */
function applyInputOneTick(
  handle: WorldHandle,
  playerId: string,
  inputX: number,
  inputZ: number,
  dt: number,
): void {
  const body = handle.playerBodies.get(playerId);
  if (!body) return;
  const { x: vx, y: vy, z: vz } = body.linvel();
  let nvx = vx + inputX * PLAYER_ACCEL * dt;
  let nvz = vz + inputZ * PLAYER_ACCEL * dt;
  nvx *= PLAYER_DAMPING;
  nvz *= PLAYER_DAMPING;
  body.setLinvel({ x: nvx, y: vy, z: nvz }, true);
}

/** Max steps per frame to maintain 60Hz simulation at low FPS (e.g. 10fps needs 6 steps). */
const MAX_STEPS_PER_FRAME = 15;

/** Options for step(); input is applied once per physics tick when provided. */
export interface StepOptions {
  /** Own bullets won't register as "hit" when colliding with self for BULLET_SELF_HIT_GRACE_SEC. */
  localPlayerId?: string;
  /** Apply this input before each physics step (fixed timestep, matches server). */
  input?: { playerId: string; inputX: number; inputZ: number };
}

/**
 * Step physics by accumulated real elapsed time. Uses fixed PHYSICS_TICK_DT per step
 * so client and server simulate identically. Input is applied once per physics tick
 * when provided.
 */
const projectileCollisionsThisStep = new Set<string>();

export function step(
  handle: WorldHandle,
  dt: number,
  options?: StepOptions | string,
): string[] {
  const localPlayerId =
    typeof options === "string" ? options : options?.localPlayerId;
  const input =
    typeof options === "object" && options?.input ? options.input : undefined;

  projectileCollisionsThisStep.clear();
  handle.physicsAccumulator += dt;
  handle.world.timestep = PHYSICS_TICK_DT;
  const nowSec = performance.now() / 1000;
  let steps = 0;
  while (
    handle.physicsAccumulator >= PHYSICS_TICK_DT &&
    steps < MAX_STEPS_PER_FRAME
  ) {
    if (input) {
      applyInputOneTick(
        handle,
        input.playerId,
        input.inputX,
        input.inputZ,
        PHYSICS_TICK_DT,
      );
    }
    handle.world.step(handle.eventQueue);
    handle.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const projId1 = handle.colliderToProjectileId.get(h1);
      const projId2 = handle.colliderToProjectileId.get(h2);
      const projId = projId1 ?? projId2;
      const otherHandle = projId1 ? h2 : h1;
      const hitPlayerId = handle.colliderToPlayerId.get(otherHandle);

      if (
        projId &&
        hitPlayerId &&
        localPlayerId &&
        hitPlayerId === localPlayerId
      ) {
        const meta = handle.projectileMeta.get(projId);
        if (meta?.ownerId === localPlayerId) {
          const age = nowSec - meta.spawnTime;
          if (age < BULLET_SELF_HIT_GRACE_SEC) return;
        }
      }
      if (projId1) projectileCollisionsThisStep.add(projId1);
      if (projId2) projectileCollisionsThisStep.add(projId2);
    });
    handle.physicsAccumulator -= PHYSICS_TICK_DT;
    steps++;
  }
  if (handle.physicsAccumulator > PHYSICS_TICK_DT * 2) {
    handle.physicsAccumulator = PHYSICS_TICK_DT;
  }
  return Array.from(projectileCollisionsThisStep);
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
  restitution = 0,
): void {
  if (handle.throwableBodies.has(id)) return;
  const R = getRAPIER();
  const isGrenade = id.startsWith("grenade_");
  const bodyDesc = R.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinvel(vx, vy, vz)
    .setGravityScale(gravityScale)
    .setCcdEnabled(isGrenade); // prevent grenade tunneling through walls/floor
  const body = handle.world.createRigidBody(bodyDesc);
  // Grenades bounce off walls, floor, and players
  const membership = id.startsWith("grenade_") ? GROUP_GRENADE : GROUP_BULLET; // molotov uses BULLET for legacy compat
  const filter =
    GROUP_FLOOR | GROUP_WALL | (id.startsWith("grenade_") ? GROUP_PLAYER : 0);
  const collider = R.ColliderDesc.ball(radius)
    .setRestitution(restitution)
    .setCollisionGroups(collisionGroups(membership, filter));
  handle.world.createCollider(collider, body);
  handle.throwableBodies.set(id, body);
}

// --- Projectiles (bullets, rockets) - use Rapier for collision, lerp mesh on client ---

const BULLET_RADIUS = 0.08;
const ROCKET_RADIUS = 0.2;

export function createProjectileBody(
  handle: WorldHandle,
  id: string,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  isRocket: boolean,
  ownerId?: string,
): void {
  if (handle.projectileBodies.has(id)) return;
  const R = getRAPIER();
  const radius = isRocket ? ROCKET_RADIUS : BULLET_RADIUS;
  const bodyDesc = R.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinvel(vx, vy, vz)
    .setGravityScale(0)
    .setCcdEnabled(true);
  const body = handle.world.createRigidBody(bodyDesc);
  const colliderDesc = R.ColliderDesc.ball(radius)
    .setSensor(true) // no physical collision, only detection
    .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    .setCollisionGroups(
      collisionGroups(GROUP_BULLET, GROUP_FLOOR | GROUP_WALL | GROUP_PLAYER),
    );
  const collider = handle.world.createCollider(colliderDesc, body);
  handle.projectileBodies.set(id, { body, collider });
  handle.colliderToProjectileId.set(collider.handle, id);
  if (ownerId != null) {
    handle.projectileMeta.set(id, {
      ownerId,
      spawnTime: performance.now() / 1000,
    });
  }
}

export function removeProjectileBody(handle: WorldHandle, id: string): void {
  const entry = handle.projectileBodies.get(id);
  if (entry) {
    handle.colliderToProjectileId.delete(entry.collider.handle);
    handle.projectileMeta.delete(id);
    handle.world.removeRigidBody(entry.body);
    handle.projectileBodies.delete(id);
  }
}

export function getProjectilePosition(
  handle: WorldHandle,
  id: string,
): { x: number; y: number; z: number } | null {
  const entry = handle.projectileBodies.get(id);
  if (!entry) return null;
  const t = entry.body.translation();
  return { x: t.x, y: t.y, z: t.z };
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

/** Set position and velocity of a throwable body (for server reconciliation). */
export function setThrowableState(
  handle: WorldHandle,
  id: string,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
): void {
  const body = handle.throwableBodies.get(id);
  if (!body) return;
  body.setTranslation({ x, y, z }, true);
  body.setLinvel({ x: vx, y: vy, z: vz }, true);
}

/**
 * Cast a ray against floor and wall colliders only. Used for tracer visuals (no mesh picking).
 * @returns Hit point or null if no hit within maxToi.
 */
export function castRay(
  handle: WorldHandle,
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  maxToi: number,
): { x: number; y: number; z: number } | null {
  const R = getRAPIER();
  const lenSq = dirX * dirX + dirY * dirY + dirZ * dirZ;
  if (lenSq < 1e-12) return null;
  const len = Math.sqrt(lenSq);
  const ray = new R.Ray(
    { x: originX, y: originY, z: originZ },
    { x: dirX / len, y: dirY / len, z: dirZ / len },
  );
  const hit = handle.world.castRay(
    ray,
    maxToi,
    true,
    undefined,
    collisionGroups(0xffff, GROUP_FLOOR | GROUP_WALL),
  );
  if (!hit) return null;
  const t = hit.toi;
  return {
    x: originX + (dirX / len) * t,
    y: originY + (dirY / len) * t,
    z: originZ + (dirZ / len) * t,
  };
}

export function destroyWorld(handle: WorldHandle): void {
  handle.projectileBodies.forEach(({ body }) =>
    handle.world.removeRigidBody(body),
  );
  handle.projectileBodies.clear();
  handle.colliderToProjectileId.clear();
  handle.projectileMeta.clear();
  handle.colliderToPlayerId.clear();
  handle.playerIdToColliderHandle.clear();
  handle.eventQueue.free();
  handle.world.free();
  handle.playerBodies.clear();
  handle.throwableBodies.clear();
}

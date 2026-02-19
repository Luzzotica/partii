// MapLoader.ts - Loads maps from JSON and builds the scene
// All map geometry (ground, grid, boundary walls, interior walls) is created from JSON data.
// Boundary walls are grid-aligned (one 1×1 cell per edge), matching server physics.

// ============================================================================
// TYPES
// ============================================================================

/** Grid cell wall: one cell, no width/depth. height 1 = low (grenades arc over), 2 = tall. */
export interface WallData {
  x: number; // grid x, integer, 0 <= x < map width
  y: number; // grid y, integer, 0 <= y < map height (in Babylon this is Z)
  height: 1 | 2;
  color?: [number, number, number];
}

export interface SpawnPointData {
  x: number; // world or grid x
  y: number; // world or grid y (Babylon Z)
  team?: number;
}

export interface FlagLocationData {
  x: number;
  y: number;
  team: number;
}

export interface TeleporterData {
  id: string;
  x: number;
  y: number; // in Babylon this is Z
  radius: number;
  targetId: string;
  color?: [number, number, number];
}

/** Optional floor grid: [row][col], 1 = solid, 0 = hole. If missing, entire floor is solid. */
export type FloorGrid = number[][];

export interface MapData {
  name: string;
  description: string;
  width: number;
  height: number; // map height (horizontal axis; in Babylon this is Z)
  groundColor?: [number, number, number];
  /** If present, floor is a grid; 1 = solid tile, 0 = hole. Must be height x width. */
  floorGrid?: FloorGrid;
  walls: WallData[];
  spawnPoints: SpawnPointData[];
  flagLocations?: FlagLocationData[];
  teleporters: TeleporterData[];
}

export interface WallCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

export interface LoadedMap {
  name: string;
  width: number;
  height: number;
  wallColliders: WallCollider[];
  spawnPoints: SpawnPointData[];
  flagLocations?: FlagLocationData[];
  teleporters: TeleporterData[];
}

// ============================================================================
// MAP LOADING
// ============================================================================

/**
 * Build the entire map scene from JSON data.
 * Creates ground, grid overlay, boundary walls, and interior walls.
 * Returns collision data for the game loop.
 *
 * @param BABYLON - The dynamically imported BabylonJS module
 * @param scene - The BabylonJS scene
 * @param mapData - The parsed JSON map definition
 */
/** Grid cell (gx, gy) to world X (Babylon X). */
export function gridToWorldX(gx: number, mapWidth: number): number {
  return gx - mapWidth / 2 + 0.5;
}
/** Grid cell (gx, gy) to world Z (Babylon Z; stored as y in JSON). */
export function gridToWorldZ(gy: number, mapHeight: number): number {
  return gy - mapHeight / 2 + 0.5;
}

export function loadMap(BABYLON: any, scene: any, mapData: MapData): LoadedMap {
  const wallColliders: WallCollider[] = [];
  const gc = mapData.groundColor || [0.05, 0.05, 0.1];
  const groundMaterial = new BABYLON.PBRMaterial("groundMat", scene);
  groundMaterial.albedoColor = new BABYLON.Color3(gc[0], gc[1], gc[2]);
  groundMaterial.metallic = 0.8;
  groundMaterial.roughness = 0.4;
  groundMaterial.emissiveColor = new BABYLON.Color3(0, 0.05, 0.1);

  const gridMaterial = new BABYLON.StandardMaterial("gridMat", scene);
  gridMaterial.emissiveColor = new BABYLON.Color3(0.1, 0.2, 0.3);
  gridMaterial.wireframe = true;
  gridMaterial.alpha = 0.3;

  // --- Floor: grid of tiles (with holes) or one solid plane ---
  const floorGrid = mapData.floorGrid;
  if (floorGrid && floorGrid.length > 0 && floorGrid[0]?.length) {
    const floorParent = new BABYLON.TransformNode("floorGrid", scene);
    const gridParent = new BABYLON.TransformNode("floorGridOverlay", scene);
    const h = floorGrid.length;
    const w = floorGrid[0].length;
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        if ((floorGrid[gy]?.[gx] ?? 0) === 0) continue;
        const wx = gridToWorldX(gx, mapData.width);
        const wz = gridToWorldZ(gy, mapData.height);
        const tile = BABYLON.MeshBuilder.CreateGround(
          `floor_${gx}_${gy}`,
          { width: 1, height: 1 },
          scene,
        );
        tile.position = new BABYLON.Vector3(wx, 0, wz);
        tile.material = groundMaterial;
        tile.parent = floorParent;
        const gridTile = BABYLON.MeshBuilder.CreateGround(
          `grid_${gx}_${gy}`,
          { width: 1, height: 1, subdivisions: 1 },
          scene,
        );
        gridTile.position = new BABYLON.Vector3(wx, 0.01, wz);
        gridTile.material = gridMaterial;
        gridTile.parent = gridParent;
      }
    }
  } else {
    const groundPadding = 4;
    const groundWidth = mapData.width + groundPadding * 2;
    const groundDepth = mapData.height + groundPadding * 2;
    const ground = BABYLON.MeshBuilder.CreateGround(
      "ground",
      { width: groundWidth, height: groundDepth },
      scene,
    );
    ground.material = groundMaterial;
    const gridSubdivisions = Math.max(mapData.width, mapData.height);
    const gridGround = BABYLON.MeshBuilder.CreateGround(
      "gridGround",
      {
        width: groundWidth,
        height: groundDepth,
        subdivisions: gridSubdivisions,
      },
      scene,
    );
    gridGround.position.y = 0.01;
    gridGround.material = gridMaterial;
  }

  // --- Helper: create a wall mesh + collider ---
  const createWall = (
    name: string,
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    isBoundary: boolean,
    customColor?: [number, number, number],
  ) => {
    // Visual mesh
    const wall = BABYLON.MeshBuilder.CreateBox(
      name,
      { width, height, depth },
      scene,
    );
    wall.position = new BABYLON.Vector3(x, height / 2, z);

    // Material
    const wallMaterial = new BABYLON.PBRMaterial(`${name}_mat`, scene);
    if (customColor) {
      wallMaterial.albedoColor = new BABYLON.Color3(
        customColor[0],
        customColor[1],
        customColor[2],
      );
      wallMaterial.emissiveColor = new BABYLON.Color3(
        customColor[0] * 0.5,
        customColor[1] * 0.5,
        customColor[2] * 0.5,
      );
    } else if (isBoundary) {
      wallMaterial.albedoColor = new BABYLON.Color3(0.12, 0.12, 0.2);
      wallMaterial.emissiveColor = new BABYLON.Color3(0.03, 0.03, 0.08);
    } else if (height <= 1) {
      // Low walls - subtle teal tint
      wallMaterial.albedoColor = new BABYLON.Color3(0.15, 0.2, 0.3);
      wallMaterial.emissiveColor = new BABYLON.Color3(0.05, 0.15, 0.2);
    } else {
      // Tall walls - standard
      wallMaterial.albedoColor = new BABYLON.Color3(0.2, 0.2, 0.3);
      wallMaterial.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.2);
    }
    wallMaterial.metallic = 0.7;
    wallMaterial.roughness = 0.3;
    wall.material = wallMaterial;

    // Note: No physics impostor on walls - Havok plugin doesn't support the legacy impostor API
    // used by PhysicsImpostor (removeImpostor etc.). Server-side Rapier handles player-wall
    // collision; throwables use raycasting vs mesh names.

    // Collider (AABB) for client-side resolution if needed
    wallColliders.push({
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: z - depth / 2,
      maxZ: z + depth / 2,
      height,
    });
  };

  // --- Boundary walls (grid-aligned, one 1×1×2 cell per edge cell, matching server) ---
  const boundaryHeight = 2;

  // North edge: one cell per gx at gy=0
  for (let gx = 0; gx < mapData.width; gx++) {
    const worldX = gridToWorldX(gx, mapData.width);
    const worldZ = gridToWorldZ(0, mapData.height);
    createWall(
      `boundary_north_${gx}`,
      worldX,
      worldZ,
      1,
      1,
      boundaryHeight,
      true,
    );
  }
  // South edge: one cell per gx at gy=height-1
  for (let gx = 0; gx < mapData.width; gx++) {
    const worldX = gridToWorldX(gx, mapData.width);
    const worldZ = gridToWorldZ(mapData.height - 1, mapData.height);
    createWall(
      `boundary_south_${gx}`,
      worldX,
      worldZ,
      1,
      1,
      boundaryHeight,
      true,
    );
  }
  // West edge: one cell per gy at gx=0
  for (let gy = 0; gy < mapData.height; gy++) {
    const worldX = gridToWorldX(0, mapData.width);
    const worldZ = gridToWorldZ(gy, mapData.height);
    createWall(
      `boundary_west_${gy}`,
      worldX,
      worldZ,
      1,
      1,
      boundaryHeight,
      true,
    );
  }
  // East edge: one cell per gy at gx=width-1
  for (let gy = 0; gy < mapData.height; gy++) {
    const worldX = gridToWorldX(mapData.width - 1, mapData.width);
    const worldZ = gridToWorldZ(gy, mapData.height);
    createWall(
      `boundary_east_${gy}`,
      worldX,
      worldZ,
      1,
      1,
      boundaryHeight,
      true,
    );
  }

  // --- Interior walls (grid: one cell each, 1x1 in world) ---
  for (let i = 0; i < mapData.walls.length; i++) {
    const w = mapData.walls[i];
    const worldX = gridToWorldX(w.x, mapData.width);
    const worldZ = gridToWorldZ(w.y, mapData.height);
    createWall(`wall_${i}`, worldX, worldZ, 1, 1, w.height, false, w.color);
  }

  // --- Teleporters (visual only for now, logic handled by game) ---
  for (let i = 0; i < mapData.teleporters.length; i++) {
    const tp = mapData.teleporters[i];
    const color = tp.color || [0, 1, 1];

    // Create a glowing ring on the ground (JSON x,y → Babylon x,z)
    const ring = BABYLON.MeshBuilder.CreateTorus(
      `teleporter_${tp.id}`,
      { diameter: tp.radius * 2, thickness: 0.15, tessellation: 32 },
      scene,
    );
    ring.position = new BABYLON.Vector3(tp.x, 0.1, tp.y);
    ring.rotation.x = Math.PI / 2;

    const ringMaterial = new BABYLON.PBRMaterial(
      `teleporter_${tp.id}_mat`,
      scene,
    );
    ringMaterial.albedoColor = new BABYLON.Color3(color[0], color[1], color[2]);
    ringMaterial.emissiveColor = new BABYLON.Color3(
      color[0],
      color[1],
      color[2],
    );
    ringMaterial.metallic = 0.3;
    ringMaterial.roughness = 0.5;
    ring.material = ringMaterial;
  }

  return {
    name: mapData.name,
    width: mapData.width,
    height: mapData.height,
    wallColliders,
    spawnPoints: mapData.spawnPoints,
    flagLocations: mapData.flagLocations,
    teleporters: mapData.teleporters,
  };
}

// ============================================================================
// COLLISION RESOLUTION
// ============================================================================

/**
 * Resolve player movement against wall colliders using two-pass axis separation.
 * This approach naturally allows sliding along walls.
 *
 * Pass 1: Resolve X movement (using current Z for overlap check)
 * Pass 2: Resolve Z movement (using resolved X for overlap check)
 *
 * @param posX - Current player center X
 * @param posZ - Current player center Z
 * @param velX - Player velocity X component
 * @param velZ - Player velocity Z component
 * @param playerRadius - Player collision radius (0.5 for the ball)
 * @param walls - Array of wall colliders (AABB)
 * @returns Resolved position and adjusted velocity
 */
export function resolveCollision(
  posX: number,
  posZ: number,
  velX: number,
  velZ: number,
  playerRadius: number,
  walls: WallCollider[],
): { x: number; z: number; velX: number; velZ: number } {
  let newX = posX + velX;
  let newVelX = velX;

  // Pass 1: Resolve X axis
  for (const wall of walls) {
    // Only check walls where we overlap in Z (using CURRENT Z, before Z movement)
    if (posZ + playerRadius <= wall.minZ || posZ - playerRadius >= wall.maxZ) {
      continue;
    }

    // Check X overlap after applying X velocity
    if (newX + playerRadius > wall.minX && newX - playerRadius < wall.maxX) {
      // Push out based on movement direction
      if (velX > 0) {
        newX = wall.minX - playerRadius;
      } else if (velX < 0) {
        newX = wall.maxX + playerRadius;
      } else {
        // Zero velocity - push to nearest edge
        const distToMin = Math.abs(newX - (wall.minX - playerRadius));
        const distToMax = Math.abs(newX - (wall.maxX + playerRadius));
        newX =
          distToMin < distToMax
            ? wall.minX - playerRadius
            : wall.maxX + playerRadius;
      }
      newVelX = 0;
    }
  }

  // Pass 2: Resolve Z axis (using resolved X)
  let newZ = posZ + velZ;
  let newVelZ = velZ;

  for (const wall of walls) {
    // Only check walls where we overlap in X (using RESOLVED X)
    if (newX + playerRadius <= wall.minX || newX - playerRadius >= wall.maxX) {
      continue;
    }

    // Check Z overlap after applying Z velocity
    if (newZ + playerRadius > wall.minZ && newZ - playerRadius < wall.maxZ) {
      if (velZ > 0) {
        newZ = wall.minZ - playerRadius;
      } else if (velZ < 0) {
        newZ = wall.maxZ + playerRadius;
      } else {
        const distToMin = Math.abs(newZ - (wall.minZ - playerRadius));
        const distToMax = Math.abs(newZ - (wall.maxZ + playerRadius));
        newZ =
          distToMin < distToMax
            ? wall.minZ - playerRadius
            : wall.maxZ + playerRadius;
      }
      newVelZ = 0;
    }
  }

  return { x: newX, z: newZ, velX: newVelX, velZ: newVelZ };
}

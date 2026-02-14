// MapLoader.ts - Loads maps from JSON and builds the scene
// All map geometry (ground, grid, boundary walls, interior walls) is created from JSON data.
// Boundary walls are auto-generated from the map dimensions.

// ============================================================================
// TYPES
// ============================================================================

export interface WallData {
  x: number; // center position x
  z: number; // center position z
  width: number; // size along x-axis
  depth: number; // size along z-axis
  height: number; // 1 = low (grenades arc over), 2 = tall (blocks grenades)
  color?: [number, number, number]; // optional custom color
}

export interface SpawnPointData {
  x: number;
  z: number;
  team?: number;
}

export interface TeleporterData {
  id: string; // unique identifier
  x: number; // center position x
  z: number; // center position z
  radius: number; // activation radius
  targetId: string; // id of destination teleporter
  color?: [number, number, number]; // optional visual color
}

export interface MapData {
  name: string;
  description: string;
  width: number; // total map width (x-axis)
  depth: number; // total map depth (z-axis)
  groundColor?: [number, number, number];
  walls: WallData[];
  spawnPoints: SpawnPointData[];
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
  depth: number;
  wallColliders: WallCollider[];
  spawnPoints: SpawnPointData[];
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
export function loadMap(BABYLON: any, scene: any, mapData: MapData): LoadedMap {
  const wallColliders: WallCollider[] = [];
  const halfWidth = mapData.width / 2;
  const halfDepth = mapData.depth / 2;

  // --- Ground plane ---
  // Extend slightly beyond boundaries so ground is visible behind boundary walls
  const groundPadding = 4;
  const groundWidth = mapData.width + groundPadding * 2;
  const groundDepth = mapData.depth + groundPadding * 2;

  const ground = BABYLON.MeshBuilder.CreateGround(
    "ground",
    { width: groundWidth, height: groundDepth },
    scene,
  );
  const groundMaterial = new BABYLON.PBRMaterial("groundMat", scene);
  const gc = mapData.groundColor || [0.05, 0.05, 0.1];
  groundMaterial.albedoColor = new BABYLON.Color3(gc[0], gc[1], gc[2]);
  groundMaterial.metallic = 0.8;
  groundMaterial.roughness = 0.4;
  groundMaterial.emissiveColor = new BABYLON.Color3(0, 0.05, 0.1);
  ground.material = groundMaterial;

  // --- Grid overlay ---
  const gridSubdivisions = Math.max(mapData.width, mapData.depth);
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
  const gridMaterial = new BABYLON.StandardMaterial("gridMat", scene);
  gridMaterial.emissiveColor = new BABYLON.Color3(0.1, 0.2, 0.3);
  gridMaterial.wireframe = true;
  gridMaterial.alpha = 0.3;
  gridGround.material = gridMaterial;

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

  // --- Boundary walls (auto-generated from map dimensions) ---
  const boundaryThickness = 1;
  const boundaryHeight = 2;

  // North wall
  createWall(
    "boundary_north",
    0,
    -halfDepth,
    mapData.width,
    boundaryThickness,
    boundaryHeight,
    true,
  );
  // South wall
  createWall(
    "boundary_south",
    0,
    halfDepth,
    mapData.width,
    boundaryThickness,
    boundaryHeight,
    true,
  );
  // West wall
  createWall(
    "boundary_west",
    -halfWidth,
    0,
    boundaryThickness,
    mapData.depth,
    boundaryHeight,
    true,
  );
  // East wall
  createWall(
    "boundary_east",
    halfWidth,
    0,
    boundaryThickness,
    mapData.depth,
    boundaryHeight,
    true,
  );

  // --- Interior walls (from JSON) ---
  for (let i = 0; i < mapData.walls.length; i++) {
    const w = mapData.walls[i];
    createWall(
      `wall_${i}`,
      w.x,
      w.z,
      w.width,
      w.depth,
      w.height,
      false,
      w.color,
    );
  }

  // --- Teleporters (visual only for now, logic handled by game) ---
  for (let i = 0; i < mapData.teleporters.length; i++) {
    const tp = mapData.teleporters[i];
    const color = tp.color || [0, 1, 1];

    // Create a glowing ring on the ground
    const ring = BABYLON.MeshBuilder.CreateTorus(
      `teleporter_${tp.id}`,
      { diameter: tp.radius * 2, thickness: 0.15, tessellation: 32 },
      scene,
    );
    ring.position = new BABYLON.Vector3(tp.x, 0.1, tp.z);
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
    depth: mapData.depth,
    wallColliders,
    spawnPoints: mapData.spawnPoints,
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

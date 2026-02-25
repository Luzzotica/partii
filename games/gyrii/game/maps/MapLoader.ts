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

export interface LauncherData {
  id: string;
  x: number;
  y: number; // in Babylon this is Z
  radius: number;
  directionX: number;
  directionY: number;
  directionZ: number;
  force: number;
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
  launchers?: LauncherData[];
}

export interface LoadedMap {
  name: string;
  width: number;
  height: number;
  spawnPoints: SpawnPointData[];
  flagLocations?: FlagLocationData[];
  teleporters: TeleporterData[];
  launchers?: LauncherData[];
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

  // --- Floor: per-cell mesh when floorGrid has holes, else single plane ---
  const grid =
    mapData.floorGrid ??
    Array(mapData.height)
      .fill(null)
      .map(() => Array(mapData.width).fill(1));
  const hasHoles = grid.some((row: number[]) =>
    row.some((s: number) => s === 0),
  );

  if (hasHoles) {
    // Per-cell floor tiles for solid cells only (holes = no mesh)
    const floorTiles: any[] = [];
    for (let gy = 0; gy < mapData.height; gy++) {
      for (let gx = 0; gx < mapData.width; gx++) {
        if (grid[gy][gx] !== 1) continue;
        const wx = gridToWorldX(gx, mapData.width);
        const wz = gridToWorldZ(gy, mapData.height);
        const tile = BABYLON.MeshBuilder.CreateBox(
          `floor_${gx}_${gy}`,
          { width: 1, height: 0.02, depth: 1 },
          scene,
        );
        tile.position = new BABYLON.Vector3(wx, -0.01, wz);
        tile.isPickable = false;
        floorTiles.push(tile);
      }
    }
    const Mesh = (BABYLON as any).Mesh;
    if (floorTiles.length > 0 && Mesh) {
      const merged = Mesh.MergeMeshes(floorTiles, true, true);
      if (merged) {
        merged.name = "floor";
        merged.material = groundMaterial;
      }
    }
    // Grid overlay: same per-cell for solid cells
    const gridTiles: any[] = [];
    for (let gy = 0; gy < mapData.height; gy++) {
      for (let gx = 0; gx < mapData.width; gx++) {
        if (grid[gy][gx] !== 1) continue;
        const wx = gridToWorldX(gx, mapData.width);
        const wz = gridToWorldZ(gy, mapData.height);
        const tile = BABYLON.MeshBuilder.CreateGround(
          `grid_${gx}_${gy}`,
          { width: 1, height: 1 },
          scene,
        );
        tile.position = new BABYLON.Vector3(wx, 0.01, wz);
        tile.isPickable = false;
        tile.material = gridMaterial;
        gridTiles.push(tile);
      }
    }
    if (gridTiles.length > 0 && Mesh) {
      const mergedGrid = Mesh.MergeMeshes(gridTiles, true, true);
      if (mergedGrid) mergedGrid.name = "gridGround";
    }
  } else {
    // No holes: single plane (efficient)
    const groundPadding = 4;
    const groundWidth = mapData.width + groundPadding * 2;
    const groundDepth = mapData.height + groundPadding * 2;
    const ground = BABYLON.MeshBuilder.CreateGround(
      "ground",
      { width: groundWidth, height: groundDepth },
      scene,
    );
    ground.material = groundMaterial;
    ground.isPickable = false;
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
    gridGround.isPickable = false;
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
    wall.isPickable = false;
  };

  // --- Boundary walls: 4 merged meshes (north, south, west, east) to reduce draw calls ---
  const boundaryHeight = 2;
  const northZ = gridToWorldZ(0, mapData.height);
  const southZ = gridToWorldZ(mapData.height - 1, mapData.height);
  const westX = gridToWorldX(0, mapData.width);
  const eastX = gridToWorldX(mapData.width - 1, mapData.width);
  const halfW = mapData.width / 2;
  const halfH = mapData.height / 2;
  createWall(
    "boundary_north",
    0,
    northZ,
    mapData.width,
    1,
    boundaryHeight,
    true,
  );
  createWall(
    "boundary_south",
    0,
    southZ,
    mapData.width,
    1,
    boundaryHeight,
    true,
  );
  createWall(
    "boundary_west",
    westX,
    0,
    1,
    mapData.height,
    boundaryHeight,
    true,
  );
  createWall(
    "boundary_east",
    eastX,
    0,
    1,
    mapData.height,
    boundaryHeight,
    true,
  );

  // --- Interior walls: merge by material (low/tall/custom) to reduce draw calls ---
  const lowWalls: any[] = [];
  const tallWalls: any[] = [];
  const customWallGroups = new Map<
    string,
    { meshes: any[]; color: [number, number, number] }
  >();
  for (let i = 0; i < mapData.walls.length; i++) {
    const w = mapData.walls[i];
    const worldX = gridToWorldX(w.x, mapData.width);
    const worldZ = gridToWorldZ(w.y, mapData.height);
    const wall = BABYLON.MeshBuilder.CreateBox(
      `wall_${i}`,
      { width: 1, height: w.height, depth: 1 },
      scene,
    );
    wall.position = new BABYLON.Vector3(worldX, w.height / 2, worldZ);
    wall.isPickable = false;
    const key = w.color
      ? `c_${w.color[0]}_${w.color[1]}_${w.color[2]}`
      : w.height <= 1
        ? "low"
        : "tall";
    if (w.color) {
      let g = customWallGroups.get(key);
      if (!g) {
        g = { meshes: [], color: w.color };
        customWallGroups.set(key, g);
      }
      const mat = new BABYLON.PBRMaterial(`wall_custom_${key}`, scene);
      mat.albedoColor = new BABYLON.Color3(w.color[0], w.color[1], w.color[2]);
      mat.emissiveColor = new BABYLON.Color3(
        w.color[0] * 0.5,
        w.color[1] * 0.5,
        w.color[2] * 0.5,
      );
      mat.metallic = 0.7;
      mat.roughness = 0.3;
      wall.material = mat;
      g.meshes.push(wall);
    } else if (w.height <= 1) {
      lowWalls.push(wall);
    } else {
      tallWalls.push(wall);
    }
  }
  const lowMat = new BABYLON.PBRMaterial("wall_low_mat", scene);
  lowMat.albedoColor = new BABYLON.Color3(0.15, 0.2, 0.3);
  lowMat.emissiveColor = new BABYLON.Color3(0.05, 0.15, 0.2);
  lowMat.metallic = 0.7;
  lowMat.roughness = 0.3;
  lowWalls.forEach((m) => (m.material = lowMat));
  const tallMat = new BABYLON.PBRMaterial("wall_tall_mat", scene);
  tallMat.albedoColor = new BABYLON.Color3(0.2, 0.2, 0.3);
  tallMat.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.2);
  tallMat.metallic = 0.7;
  tallMat.roughness = 0.3;
  tallWalls.forEach((m) => (m.material = tallMat));
  const Mesh = (BABYLON as any).Mesh;
  if (lowWalls.length > 0 && Mesh) {
    const merged = Mesh.MergeMeshes(lowWalls, true, true);
    if (merged) merged.name = "walls_low";
  }
  if (tallWalls.length > 0 && Mesh) {
    const merged = Mesh.MergeMeshes(tallWalls, true, true);
    if (merged) merged.name = "walls_tall";
  }
  for (const [, g] of customWallGroups) {
    if (g.meshes.length > 0 && Mesh) {
      const merged = Mesh.MergeMeshes(g.meshes, true, true);
      if (merged) merged.name = "walls_custom";
    }
  }

  // --- Teleporters (visual only for now, logic handled by game) ---
  for (let i = 0; i < (mapData.teleporters ?? []).length; i++) {
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
    ring.isPickable = false;
  }

  // --- Launchers (angled platform, direction arrow) ---
  for (const launcher of mapData.launchers ?? []) {
    const color = launcher.color || [1, 0.6, 0];
    const platform = BABYLON.MeshBuilder.CreateBox(
      `launcher_${launcher.id}`,
      { width: launcher.radius * 2, height: 0.2, depth: launcher.radius * 2 },
      scene,
    );
    platform.position = new BABYLON.Vector3(launcher.x, 0.1, launcher.y);
    const dir = new BABYLON.Vector3(
      launcher.directionX,
      launcher.directionY,
      launcher.directionZ,
    );
    if (dir.lengthSquared() > 0.001) {
      platform.lookAt(platform.position.add(dir));
    }
    const mat = new BABYLON.PBRMaterial(`launcher_${launcher.id}_mat`, scene);
    mat.albedoColor = new BABYLON.Color3(color[0], color[1], color[2]);
    mat.emissiveColor = new BABYLON.Color3(
      color[0] * 0.5,
      color[1] * 0.5,
      color[2] * 0.5,
    );
    mat.metallic = 0.5;
    mat.roughness = 0.4;
    platform.material = mat;
    platform.isPickable = false;
  }

  return {
    name: mapData.name,
    width: mapData.width,
    height: mapData.height,
    spawnPoints: mapData.spawnPoints,
    flagLocations: mapData.flagLocations,
    teleporters: mapData.teleporters ?? [],
    launchers: mapData.launchers ?? [],
  };
}

// Map registry - import and export all available maps
// To add a new map: create a JSON file and add it here.

import type { MapData } from "./MapLoader";

import arenaData from "./arena.json";
import mazeData from "./maze.json";
import warehouseData from "./warehouse.json";

export const maps: Record<string, MapData> = {
  arena: arenaData as unknown as MapData,
  maze: mazeData as unknown as MapData,
  warehouse: warehouseData as unknown as MapData,
};

export { arenaData, mazeData, warehouseData };
export type { MapData, FlagLocationData, FloorGrid } from "./MapLoader";

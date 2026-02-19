"use client";

import type { MapData, WallData } from "../game/maps/MapLoader";

interface MinimapPreviewProps {
  mapData: MapData;
  className?: string;
  size?: number;
}

function gridToWorldX(gx: number, mapWidth: number): number {
  return gx - mapWidth / 2 + 0.5;
}
function gridToWorldZ(gy: number, mapHeight: number): number {
  return gy - mapHeight / 2 + 0.5;
}

/**
 * Renders a top-down minimap of a map (floor + walls).
 * Uses SVG with viewBox in world coords; Y is flipped so north (negative Z) is up.
 */
export default function MinimapPreview({
  mapData,
  className = "",
  size = 120,
}: MinimapPreviewProps) {
  const halfWidth = mapData.width / 2;
  const halfHeight = mapData.height / 2;

  const viewBox = `${-halfWidth} ${-halfHeight} ${mapData.width} ${mapData.height}`;

  // Boundary walls: grid-aligned 1×1 cells along each edge (matching server)
  const boundaryCells: { x: number; y: number }[] = [];
  for (let gx = 0; gx < mapData.width; gx++) {
    boundaryCells.push({ x: gx, y: 0 }); // North
    boundaryCells.push({ x: gx, y: mapData.height - 1 }); // South
  }
  for (let gy = 0; gy < mapData.height; gy++) {
    boundaryCells.push({ x: 0, y: gy }); // West
    boundaryCells.push({ x: mapData.width - 1, y: gy }); // East
  }
  // Deduplicate corners (they appear in both north/south and west/east)
  const boundarySet = new Set(boundaryCells.map((c) => `${c.x},${c.y}`));
  const uniqueBoundaryCells = Array.from(boundarySet).map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  });

  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      className={className}
      style={{ display: "block" }}
    >
      <g transform="scale(1, -1)">
        {/* Floor */}
        <rect
          x={-halfWidth}
          y={-halfHeight}
          width={mapData.width}
          height={mapData.height}
          fill="rgba(0.08, 0.08, 0.14, 0.95)"
          stroke="rgba(80, 80, 110, 0.6)"
          strokeWidth={0.4}
        />
        {/* Boundary walls: one cell each, same as interior walls */}
        {uniqueBoundaryCells.map((c, i) => {
          const wx = gridToWorldX(c.x, mapData.width);
          const wz = gridToWorldZ(c.y, mapData.height);
          return (
            <rect
              key={`b-${i}`}
              x={wx - 0.5}
              y={wz - 0.5}
              width={1}
              height={1}
              fill="rgb(0.35, 0.32, 0.45)"
              stroke="rgba(200, 200, 255, 0.7)"
              strokeWidth={0.6}
            />
          );
        })}
        {/* Grid walls: one cell each */}
        {mapData.walls.map((w: WallData, i: number) => {
          const wx = gridToWorldX(w.x, mapData.width);
          const wz = gridToWorldZ(w.y, mapData.height);
          const fill =
            w.height >= 2 ? "rgb(0.45, 0.42, 0.58)" : "rgb(0.38, 0.45, 0.55)";
          return (
            <rect
              key={i}
              x={wx - 0.5}
              y={wz - 0.5}
              width={1}
              height={1}
              fill={fill}
              stroke="rgba(200, 200, 255, 0.7)"
              strokeWidth={0.6}
            />
          );
        })}
      </g>
    </svg>
  );
}

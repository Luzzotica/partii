"use client";

import type {
  MapData,
  WallData,
  FlagLocationData,
} from "../game/maps/MapLoader";

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

function isInteriorCell(
  gx: number,
  gy: number,
  width: number,
  height: number,
): boolean {
  return gx >= 1 && gx < width - 1 && gy >= 1 && gy < height - 1;
}

const FLAG_TEAM_COLORS: Record<number, string> = {
  1: "#e04040",
  2: "#4070f0",
  3: "#33c060",
  4: "#e0d830",
};

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

  const grid =
    mapData.floorGrid ??
    Array(mapData.height)
      .fill(null)
      .map(() => Array(mapData.width).fill(1));

  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      className={className}
      style={{ display: "block" }}
    >
      <g transform="scale(1, -1)">
        {/* Floor cells (per-cell for holes) */}
        {grid.map((row: number[], gy: number) =>
          row.map((solid: number, gx: number) => {
            const wx = gridToWorldX(gx, mapData.width);
            const wz = gridToWorldZ(gy, mapData.height);
            const isHole = solid === 0;
            return (
              <rect
                key={`f-${gx}-${gy}`}
                x={wx - 0.5}
                y={wz - 0.5}
                width={1}
                height={1}
                fill={isHole ? "#111111" : "#e8e8e8"}
                stroke="#bbb"
                strokeWidth={0.1}
              />
            );
          }),
        )}
        {/* Boundary walls - filled, high contrast */}
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
              fill="#8880b3"
              stroke="#7a7a8a"
              strokeWidth={0.15}
            />
          );
        })}
        {/* Interior walls - solid fills, short (cyan-gray) vs tall (brown) */}
        {mapData.walls
          .filter((w) =>
            isInteriorCell(w.x, w.y, mapData.width, mapData.height),
          )
          .map((w: WallData, i: number) => {
            const wx = gridToWorldX(w.x, mapData.width);
            const wz = gridToWorldZ(w.y, mapData.height);
            const fill = w.height >= 2 ? "#d98c58" : "#5a99e6";
            return (
              <rect
                key={i}
                x={wx - 0.5}
                y={wz - 0.5}
                width={1}
                height={1}
                fill={fill}
                stroke="#8a8a9a"
                strokeWidth={0.15}
              />
            );
          })}
        {/* Spawn points - filled circles */}
        {mapData.spawnPoints.map((s, i) => (
          <circle
            key={`s-${i}`}
            cx={s.x}
            cy={s.y}
            r={0.4}
            fill="#28e666"
            stroke="#fff"
            strokeWidth={0.12}
          />
        ))}
        {/* Flag locations - filled, team colored */}
        {(mapData.flagLocations ?? []).map((f: FlagLocationData, i: number) => (
          <rect
            key={`fl-${i}`}
            x={f.x - 0.4}
            y={f.y - 0.4}
            width={0.8}
            height={0.8}
            fill={FLAG_TEAM_COLORS[f.team ?? 1] ?? FLAG_TEAM_COLORS[1]}
            stroke="#fff"
            strokeWidth={0.12}
          />
        ))}
      </g>
    </svg>
  );
}

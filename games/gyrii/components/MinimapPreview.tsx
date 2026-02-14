"use client";

import type { MapData, WallData } from "../game/maps/MapLoader";

interface MinimapPreviewProps {
  mapData: MapData;
  className?: string;
  size?: number;
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
  const halfDepth = mapData.depth / 2;

  // World bounds: -halfWidth..halfWidth, -halfDepth..halfDepth
  const viewBox = `${-halfWidth} ${-halfDepth} ${mapData.width} ${mapData.depth}`;

  const walls: WallData[] = [
    // Boundary walls (same logic as MapLoader)
    {
      x: 0,
      z: -halfDepth,
      width: mapData.width,
      depth: 1,
      height: 2,
    },
    {
      x: 0,
      z: halfDepth,
      width: mapData.width,
      depth: 1,
      height: 2,
    },
    {
      x: -halfWidth,
      z: 0,
      width: 1,
      depth: mapData.depth,
      height: 2,
    },
    {
      x: halfWidth,
      z: 0,
      width: 1,
      depth: mapData.depth,
      height: 2,
    },
    ...mapData.walls,
  ];

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
          y={-halfDepth}
          width={mapData.width}
          height={mapData.depth}
          fill="rgba(0.08, 0.08, 0.14, 0.95)"
          stroke="rgba(80, 80, 110, 0.6)"
          strokeWidth={0.4}
        />
        {/* Walls: high-contrast fills and stroke so they read clearly */}
        {walls.map((w, i) => {
          const isBoundary =
            i < 4 ||
            w.x === 0 ||
            w.z === 0 ||
            Math.abs(w.x) === halfWidth ||
            Math.abs(w.z) === halfDepth;
          const fill = isBoundary
            ? "rgb(0.35, 0.32, 0.45)"
            : w.height >= 2
              ? "rgb(0.45, 0.42, 0.58)"
              : "rgb(0.38, 0.45, 0.55)";
          return (
            <rect
              key={i}
              x={w.x - w.width / 2}
              y={w.z - w.depth / 2}
              width={w.width}
              height={w.depth}
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

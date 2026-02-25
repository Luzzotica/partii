"use client";

import { memo, useMemo } from "react";
import { useGyriiStore } from "../store/gameStore";
import { maps } from "../game/maps";
import type { MapData, WallData } from "../game/maps/MapLoader";

const MINIMAP_SIZE = 140;
/** Show enemies on minimap for this long after they fire (micros). */
const FIRING_REVEAL_MICROS = 600_000; // 600ms

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

/** Static minimap content. White background; only holes, walls, allies, local player drawn. */
const MinimapStatic = memo(function MinimapStatic(props: {
  mapData: MapData;
  allies: { x: number; z: number; id: string }[];
  myPos: { x: number; z: number };
}) {
  const { mapData, allies, myPos } = props;
  const halfWidth = mapData.width / 2;
  const halfHeight = mapData.height / 2;

  const interiorWalls = useMemo(
    () =>
      mapData.walls.filter((w) =>
        isInteriorCell(w.x, w.y, mapData.width, mapData.height),
      ),
    [mapData.walls, mapData.width, mapData.height],
  );

  const grid = useMemo(
    () =>
      mapData.floorGrid ??
      Array(mapData.height)
        .fill(null)
        .map(() => Array(mapData.width).fill(1)),
    [mapData.floorGrid, mapData.width, mapData.height],
  );

  const holeCells = useMemo(() => {
    const cells: { gx: number; gy: number }[] = [];
    grid.forEach((row: number[], gy: number) =>
      row.forEach((solid: number, gx: number) => {
        if (solid === 0) cells.push({ gx, gy });
      }),
    );
    return cells;
  }, [grid]);

  return (
    <>
      {/* Background: solid fill so elements are easy to see */}
      <rect
        x={-halfWidth}
        y={-halfHeight}
        width={mapData.width}
        height={mapData.height}
        fill="#e8e8e8"
      />
      {/* Map boundary: single rect */}
      <rect
        x={-halfWidth}
        y={-halfHeight}
        width={mapData.width}
        height={mapData.height}
        fill="none"
        stroke="#666"
        strokeWidth={0.2}
      />
      {/* Holes only */}
      {holeCells.map(({ gx, gy }) => {
        const wx = gridToWorldX(gx, mapData.width);
        const wz = gridToWorldZ(gy, mapData.height);
        return (
          <rect
            key={`h-${gx}-${gy}`}
            x={wx - 0.5}
            y={wz - 0.5}
            width={1}
            height={1}
            fill="#333"
          />
        );
      })}
      {/* Interior walls (low + tall) */}
      {interiorWalls.map((w: WallData, i: number) => {
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
      {/* Allies - green dots */}
      {allies.map(({ x, z, id }) => (
        <circle
          key={id}
          cx={x}
          cy={z}
          r={0.35}
          fill="#22c55e"
          stroke="rgba(34,197,94,0.8)"
          strokeWidth={0.3}
        />
      ))}
      {/* Local player - triangle (2x size) */}
      <polygon
        points={`${myPos.x},${myPos.z + 1} ${myPos.x - 0.8},${myPos.z - 0.7} ${myPos.x + 0.8},${myPos.z - 0.7}`}
        fill="#0ea5e9"
        stroke="#0369a1"
        strokeWidth={0.25}
      />
    </>
  );
});

/** Enemy firing dots; opacity from store updates (no tick). */
function MinimapEnemyDots(props: {
  players: Map<
    string,
    {
      position?: { x: number; z: number };
      lastShotAt?: number | string;
      team?: number;
      isAlive?: boolean;
    }
  >;
  localPlayerId: string;
  myTeam: number;
  gameMode: string;
}) {
  const { players, localPlayerId, myTeam, gameMode } = props;
  const isTeamMode =
    gameMode === "teamDeathmatch" || gameMode === "captureTheFlag";

  const nowMicros = Date.now() * 1000;
  const enemiesFiring: { x: number; z: number; id: string; opacity: number }[] =
    [];

  for (const [id, p] of players) {
    if (id === localPlayerId) continue;
    if (p.isAlive === false) continue;
    if (isTeamMode && p.team === myTeam) continue;
    const pos = p.position ?? { x: 0, y: 0.5, z: 0 };
    const lastShot = Number(p.lastShotAt ?? 0);
    if (lastShot > 0 && nowMicros - lastShot < FIRING_REVEAL_MICROS) {
      const elapsed = nowMicros - lastShot;
      const opacity = Math.max(0, 1 - elapsed / FIRING_REVEAL_MICROS);
      if (opacity > 0.02) {
        enemiesFiring.push({ x: pos.x, z: pos.z, id, opacity });
      }
    }
  }

  return (
    <>
      {enemiesFiring.map(({ x, z, id, opacity }) => (
        <circle
          key={id}
          cx={x}
          cy={z}
          r={0.8}
          fill="#ff4444"
          fillOpacity={opacity}
          stroke="rgba(255,100,100,0.9)"
          strokeOpacity={opacity}
          strokeWidth={0.35}
        />
      ))}
    </>
  );
}

/**
 * In-game minimap. Re-renders only when store updates (players, lobby).
 * White background; holes, walls, boundary, allies, enemies (when firing) drawn.
 */
export default function GameMinimap() {
  const { localPlayer, players, currentLobby } = useGyriiStore();

  const mapId = (currentLobby?.mapId ?? "arena").toString().toLowerCase();
  const mapData = useMemo(() => {
    if (currentLobby?.isCustomMap && currentLobby?.mapJson) {
      try {
        return JSON.parse(currentLobby.mapJson) as MapData;
      } catch {
        return (maps as Record<string, MapData>)[mapId] ?? maps.arena;
      }
    }
    return (maps as Record<string, MapData>)[mapId] ?? maps.arena;
  }, [currentLobby?.isCustomMap, currentLobby?.mapJson, mapId]);
  const gameMode = currentLobby?.gameMode ?? "freeForAll";

  if (!localPlayer || !mapData) return null;

  const halfWidth = mapData.width / 2;
  const halfHeight = mapData.height / 2;
  const viewBox = `${-halfWidth} ${-halfHeight} ${mapData.width} ${mapData.height}`;

  const myTeam = localPlayer.team;
  const isTeamMode =
    gameMode === "teamDeathmatch" || gameMode === "captureTheFlag";

  const allies = useMemo(() => {
    const result: { x: number; z: number; id: string }[] = [];
    for (const [id, p] of players) {
      if (id === localPlayer.id) continue;
      if (p.isAlive === false) continue;
      if (isTeamMode && p.team === myTeam) {
        const pos = p.position ?? { x: 0, y: 0.5, z: 0 };
        result.push({ x: pos.x, z: pos.z, id });
      }
    }
    return result;
  }, [players, localPlayer.id, myTeam, isTeamMode]);

  const myPos = localPlayer.position ?? { x: 0, y: 0.5, z: 0 };

  return (
    <div className="bg-gray-200 rounded-lg p-1.5 border border-gray-400">
      <svg
        viewBox={viewBox}
        width={MINIMAP_SIZE}
        height={MINIMAP_SIZE}
        className="block bg-white"
      >
        <g transform="scale(1, -1)">
          <MinimapStatic mapData={mapData} allies={allies} myPos={myPos} />
          <MinimapEnemyDots
            players={players}
            localPlayerId={localPlayer.id}
            myTeam={myTeam}
            gameMode={gameMode}
          />
        </g>
      </svg>
    </div>
  );
}

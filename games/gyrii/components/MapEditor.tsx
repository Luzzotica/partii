"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth-context";
import type {
  MapData,
  WallData,
  SpawnPointData,
  FlagLocationData,
  FloorGrid,
} from "../game/maps/MapLoader";

function gridToWorldX(gx: number, mapWidth: number): number {
  return gx - mapWidth / 2 + 0.5;
}
function gridToWorldZ(gy: number, mapHeight: number): number {
  return gy - mapHeight / 2 + 0.5;
}

const DEFAULT_WIDTH = 24;
const DEFAULT_HEIGHT = 24;

function createFullFloorGrid(w: number, h: number): FloorGrid {
  return Array(h)
    .fill(null)
    .map(() => Array(w).fill(1));
}

function createEmptyMap(
  name: string,
  description: string,
  width: number,
  height: number,
): MapData {
  return {
    name,
    description,
    width,
    height,
    groundColor: [0.05, 0.05, 0.1],
    floorGrid: createFullFloorGrid(width, height),
    walls: [],
    spawnPoints: [],
    flagLocations: [],
    teleporters: [],
    launchers: [],
  };
}

type Tool = "wall" | "floorHole" | "spawn" | "flag" | "remove";

const FLAG_TEAM_COLORS: Record<number, string> = {
  1: "#e04040",
  2: "#4070f0",
  3: "#33c060",
  4: "#e0d830",
};

function isInteriorCell(
  gx: number,
  gy: number,
  width: number,
  height: number,
): boolean {
  return gx >= 1 && gx < width - 1 && gy >= 1 && gy < height - 1;
}

export default function MapEditor() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const duplicateId = searchParams.get("duplicate");

  const [mapData, setMapData] = useState<MapData>(() =>
    createEmptyMap("New Map", "", DEFAULT_WIDTH, DEFAULT_HEIGHT),
  );
  const [tool, setTool] = useState<Tool>("wall");
  const [wallHeight, setWallHeight] = useState<1 | 2>(1);
  const [flagTeam, setFlagTeam] = useState<1 | 2 | 3 | 4>(1);
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragAction, setDragAction] = useState<"add" | "remove" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mapId, setMapId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");

  useEffect(() => {
    const id = editId ?? duplicateId;
    if (!id) {
      setLoadState("idle");
      return;
    }
    setLoadState("loading");
    fetch(`/api/gyrii/maps/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load map");
        return r.json();
      })
      .then((data: MapData) => {
        if (duplicateId) {
          setMapData({
            ...data,
            name: `Copy of ${(data.name ?? "Map").slice(0, 80)}`,
            description: data.description ?? "",
          });
          setMapId(null);
        } else {
          setMapData(data);
          setMapId(id);
        }
        setLoadState("loaded");
      })
      .catch(() => setLoadState("error"));
  }, [editId, duplicateId]);

  const setWalls = useCallback((fn: (w: WallData[]) => WallData[]) => {
    setMapData((m) => ({ ...m, walls: fn(m.walls) }));
  }, []);

  const setFloorGrid = useCallback((fn: (g: FloorGrid) => FloorGrid) => {
    setMapData((m) => ({
      ...m,
      floorGrid: fn(m.floorGrid ?? createFullFloorGrid(m.width, m.height)),
    }));
  }, []);

  const setSpawnPoints = useCallback(
    (fn: (s: SpawnPointData[]) => SpawnPointData[]) => {
      setMapData((m) => ({ ...m, spawnPoints: fn(m.spawnPoints) }));
    },
    [],
  );

  const setFlagLocations = useCallback(
    (fn: (f: FlagLocationData[]) => FlagLocationData[]) => {
      setMapData((m) => ({ ...m, flagLocations: fn(m.flagLocations ?? []) }));
    },
    [],
  );

  const getMirroredCells = useCallback(
    (gx: number, gy: number): [number, number][] => {
      const cells: [number, number][] = [[gx, gy]];
      const mx = mapData.width - 1 - gx;
      const my = mapData.height - 1 - gy;
      if (mirrorX && mx !== gx) cells.push([mx, gy]);
      if (mirrorY && my !== gy) cells.push([gx, my]);
      if (mirrorX && mirrorY && (mx !== gx || my !== gy)) cells.push([mx, my]);
      return cells;
    },
    [mapData.width, mapData.height, mirrorX, mirrorY],
  );

  const applyDragCell = useCallback(
    (gx: number, gy: number, action: "add" | "remove") => {
      const cells = getMirroredCells(gx, gy);
      for (const [cx, cy] of cells) {
        if (!isInteriorCell(cx, cy, mapData.width, mapData.height)) continue;
        if (tool === "wall") {
          const hasWall = mapData.walls.some((w) => w.x === cx && w.y === cy);
          if (action === "add" && !hasWall) {
            setWalls((w) => [...w, { x: cx, y: cy, height: wallHeight }]);
          } else if (action === "remove" && hasWall) {
            setWalls((w) => w.filter((ww) => !(ww.x === cx && ww.y === cy)));
          }
        } else if (tool === "floorHole") {
          setFloorGrid((g) => {
            const val = g[cy]?.[cx] ?? 1;
            const want = action === "add" ? 0 : 1;
            if (val === want) return g;
            const next = g.map((row) => [...row]);
            next[cy]![cx] = want;
            return next;
          });
        }
      }
    },
    [mapData, tool, wallHeight, setWalls, setFloorGrid, getMirroredCells],
  );

  const handleCellDown = useCallback(
    (gx: number, gy: number) => {
      if (gx < 0 || gx >= mapData.width || gy < 0 || gy >= mapData.height)
        return;
      const interior = isInteriorCell(gx, gy, mapData.width, mapData.height);

      if (tool === "remove") {
        const wx = gx - mapData.width / 2 + 0.5;
        const wy = gy - mapData.height / 2 + 0.5;
        const spawnIdx = mapData.spawnPoints.findIndex(
          (s) => Math.abs(s.x - wx) < 0.6 && Math.abs(s.y - wy) < 0.6,
        );
        const flagIdx = (mapData.flagLocations ?? []).findIndex(
          (f) => Math.abs(f.x - wx) < 0.6 && Math.abs(f.y - wy) < 0.6,
        );
        if (spawnIdx >= 0)
          setSpawnPoints((s) => s.filter((_, i) => i !== spawnIdx));
        if (flagIdx >= 0)
          setFlagLocations((f) => f.filter((_, i) => i !== flagIdx));
        return;
      }

      if (!interior) return;

      if (tool === "wall" || tool === "floorHole") {
        const hasWall = mapData.walls.some((w) => w.x === gx && w.y === gy);
        const isHole =
          (mapData.floorGrid ??
            createFullFloorGrid(mapData.width, mapData.height))[gy]?.[gx] === 0;
        const action =
          tool === "wall"
            ? hasWall
              ? "remove"
              : "add"
            : isHole
              ? "remove"
              : "add";
        setDragging(true);
        setDragAction(action);
        applyDragCell(gx, gy, action);
      } else if (tool === "spawn") {
        const cells = getMirroredCells(gx, gy);
        setSpawnPoints((s) => [
          ...s,
          ...cells
            .filter(([cx, cy]) =>
              isInteriorCell(cx, cy, mapData.width, mapData.height),
            )
            .map(([cx, cy]) => ({
              x: cx - mapData.width / 2 + 0.5,
              y: cy - mapData.height / 2 + 0.5,
            })),
        ]);
      } else if (tool === "flag") {
        // Flags: no mirroring (one per team only)
        const wx = gx - mapData.width / 2 + 0.5;
        const wy = gy - mapData.height / 2 + 0.5;
        setFlagLocations((f) => [
          ...f.filter((flag) => flag.team !== flagTeam),
          { x: wx, y: wy, team: flagTeam },
        ]);
      }
    },
    [
      mapData,
      tool,
      wallHeight,
      flagTeam,
      setWalls,
      setFloorGrid,
      setSpawnPoints,
      setFlagLocations,
      applyDragCell,
      getMirroredCells,
    ],
  );

  const handleCellEnter = useCallback(
    (gx: number, gy: number) => {
      if (!dragging || !dragAction) return;
      if (
        (tool === "wall" || tool === "floorHole") &&
        isInteriorCell(gx, gy, mapData.width, mapData.height)
      ) {
        applyDragCell(gx, gy, dragAction);
      }
    },
    [dragging, dragAction, tool, mapData.width, mapData.height, applyDragCell],
  );

  const handleDragEnd = useCallback(() => {
    setDragging(false);
    setDragAction(null);
  }, []);

  const handleSave = async () => {
    if (!user) {
      setSaveError("You must be logged in to save maps");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/gyrii/maps" + (mapId ? `/${mapId}` : ""), {
        method: mapId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mapData.name,
          description: mapData.description,
          mapJson: {
            ...mapData,
            walls: mapData.walls.filter((w) =>
              isInteriorCell(w.x, w.y, mapData.width, mapData.height),
            ),
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to save");
      }
      const data = await res.json();
      if (data.id) setMapId(data.id);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const halfWidth = mapData.width / 2;
  const halfHeight = mapData.height / 2;
  const viewBox = `${-halfWidth} ${-halfHeight} ${mapData.width} ${mapData.height}`;

  // Boundary walls (matching MinimapPreview)
  const boundaryCells: { x: number; y: number }[] = [];
  for (let gx = 0; gx < mapData.width; gx++) {
    boundaryCells.push({ x: gx, y: 0 });
    boundaryCells.push({ x: gx, y: mapData.height - 1 });
  }
  for (let gy = 0; gy < mapData.height; gy++) {
    boundaryCells.push({ x: 0, y: gy });
    boundaryCells.push({ x: mapData.width - 1, y: gy });
  }
  const boundarySet = new Set(boundaryCells.map((c) => `${c.x},${c.y}`));
  const uniqueBoundaryCells = Array.from(boundarySet).map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  });

  const grid =
    mapData.floorGrid ?? createFullFloorGrid(mapData.width, mapData.height);

  if (loadState === "loading") {
    return (
      <main className="min-h-screen bg-gray-950 text-gray-100 p-4 flex items-center justify-center">
        <div className="text-cyan-400">Loading map...</div>
      </main>
    );
  }

  if (loadState === "error") {
    return (
      <main className="min-h-screen bg-gray-950 text-gray-100 p-4">
        <div className="max-w-xl mx-auto text-center">
          <p className="text-red-400 mb-4">Failed to load map.</p>
          <Link
            href="/arcade/gyrii/maps"
            className="text-cyan-400 hover:text-cyan-300"
          >
            ← Back to My Maps
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col bg-gray-950 text-gray-100">
      <div className="flex-none flex justify-between items-center px-4 py-2 border-b border-gray-700">
        <Link
          href="/arcade/gyrii/maps"
          className="text-cyan-400 hover:text-cyan-300 text-sm"
        >
          ← Back to My Maps
        </Link>
        <h1 className="text-lg font-bold text-cyan-400">Map Editor</h1>
        <div className="w-20" />
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-none w-56 bg-gray-900/95 border-r border-gray-700 p-4 overflow-y-auto">
          <h2 className="text-sm font-semibold text-gray-300 mb-2">Map info</h2>
          <input
            type="text"
            placeholder="Map name"
            value={mapData.name}
            onChange={(e) =>
              setMapData((m) => ({ ...m, name: e.target.value }))
            }
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm mb-2"
          />
          <input
            type="text"
            placeholder="Description"
            value={mapData.description}
            onChange={(e) =>
              setMapData((m) => ({ ...m, description: e.target.value }))
            }
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm mb-2"
          />
          <div className="flex gap-2 mb-1">
            <label className="text-xs text-gray-400">W:</label>
            <input
              type="number"
              min={8}
              max={64}
              step={2}
              value={mapData.width}
              onChange={(e) => {
                let w = Math.max(
                  8,
                  Math.min(64, parseInt(e.target.value, 10) || 8),
                );
                if (w % 2 !== 0) w += 1;
                setMapData((m) => ({
                  ...m,
                  width: w,
                  height: m.height,
                  floorGrid: createFullFloorGrid(w, m.height),
                }));
              }}
              className="w-14 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-sm"
            />
            <label className="text-xs text-gray-400">H:</label>
            <input
              type="number"
              min={8}
              max={64}
              step={2}
              value={mapData.height}
              onChange={(e) => {
                let h = Math.max(
                  8,
                  Math.min(64, parseInt(e.target.value, 10) || 8),
                );
                if (h % 2 !== 0) h += 1;
                setMapData((m) => ({
                  ...m,
                  height: h,
                  floorGrid: createFullFloorGrid(m.width, h),
                }));
              }}
              className="w-14 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-sm"
            />
          </div>
          <p className="text-[10px] text-gray-500 mb-4">Even numbers only</p>

          <h2 className="text-sm font-semibold text-gray-300 mb-2">Tools</h2>
          <div className="flex flex-wrap gap-2 mb-2">
            {(["wall", "floorHole", "spawn", "flag", "remove"] as const).map(
              (t) => (
                <button
                  key={t}
                  onClick={() => setTool(t)}
                  className={`px-2 py-1 rounded text-xs ${
                    tool === t
                      ? "bg-cyan-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  {t === "floorHole"
                    ? "Hole"
                    : t === "remove"
                      ? "Remove"
                      : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ),
            )}
          </div>
          <p className="text-gray-500 text-[11px] mt-2 mb-1">
            {tool === "remove"
              ? "Click spawn or flag to remove."
              : "Click inside map to place."}
          </p>
          {tool === "flag" && (
            <div className="mb-2">
              <label className="text-xs text-gray-400 block mb-1">
                Flag team:
              </label>
              <div className="flex flex-wrap gap-1">
                {([1, 2, 3, 4] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setFlagTeam(t)}
                    className={`px-2 py-1 rounded text-xs border ${
                      flagTeam === t
                        ? "ring-1 ring-white"
                        : "border-transparent"
                    }`}
                    style={{
                      backgroundColor: FLAG_TEAM_COLORS[t],
                      color: t === 4 ? "#1a1a1a" : "white",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {tool === "wall" && (
            <div className="mb-2">
              <label className="text-xs text-gray-400">Height: </label>
              <button
                onClick={() => setWallHeight(1)}
                className={`px-2 py-0.5 rounded text-xs mr-1 ${wallHeight === 1 ? "bg-cyan-600" : "bg-gray-700"}`}
              >
                Low
              </button>
              <button
                onClick={() => setWallHeight(2)}
                className={`px-2 py-0.5 rounded text-xs ${wallHeight === 2 ? "bg-cyan-600" : "bg-gray-700"}`}
              >
                Tall
              </button>
            </div>
          )}

          <h2 className="text-sm font-semibold text-gray-300 mt-4 mb-2">
            Mirror
          </h2>
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setMirrorX((v) => !v)}
              className={`flex-1 px-2 py-1 rounded text-xs ${
                mirrorX
                  ? "bg-cyan-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              Mirror X
            </button>
            <button
              onClick={() => setMirrorY((v) => !v)}
              className={`flex-1 px-2 py-1 rounded text-xs ${
                mirrorY
                  ? "bg-cyan-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              Mirror Y
            </button>
          </div>
          <p className="text-[10px] text-gray-500 mb-2">
            {mirrorX && mirrorY
              ? "Mirroring left↔right & top↔bottom"
              : mirrorX
                ? "Mirroring left↔right"
                : mirrorY
                  ? "Mirroring top↔bottom"
                  : "Off — edits apply to one cell only"}
          </p>

          <button
            onClick={handleSave}
            disabled={saving || !user}
            className="w-full mt-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded font-semibold text-sm"
          >
            {saving ? "Saving..." : "Save map"}
          </button>
          {saveError && (
            <p className="text-red-400 text-xs mt-2">{saveError}</p>
          )}

          <h2 className="text-sm font-semibold text-gray-300 mt-6 mb-2">
            Legend
          </h2>
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-4 h-4 rounded"
                style={{ background: "#e8e8e8", border: "1px solid #bbb" }}
              />
              <span className="text-gray-300">Floor</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-4 h-4 rounded"
                style={{ background: "#111111", border: "1px solid #555" }}
              />
              <span className="text-gray-300">Hole</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-4 h-4 rounded"
                style={{ background: "#8880b3" }}
              />
              <span className="text-gray-300">Boundary wall</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-4 h-4 rounded"
                style={{ background: "#5a99e6" }}
              />
              <span className="text-gray-300">Low wall</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-4 h-4 rounded"
                style={{ background: "#d98c58" }}
              />
              <span className="text-gray-300">Tall wall</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-4 h-4 rounded-full"
                style={{ background: "#28e666", border: "1px solid #fff" }}
              />
              <span className="text-gray-300">Spawn point</span>
            </div>
            {([1, 2, 3, 4] as const).map((t) => (
              <div key={t} className="flex items-center gap-2">
                <span
                  className="inline-block w-4 h-4 rounded"
                  style={{
                    background: FLAG_TEAM_COLORS[t],
                    border: "1px solid #fff",
                  }}
                />
                <span className="text-gray-300">Flag team {t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* WYSIWYG editable canvas - same visual style as MinimapPreview */}
        <div className="flex-1 min-w-0 flex items-center justify-center p-4 bg-gray-950">
          <svg
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            className="max-w-full max-h-full w-auto h-auto cursor-crosshair select-none"
            style={{ background: "#0d0d16" }}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
          >
            <g transform="scale(1, -1)">
              {/* Floor cells - only draw floor for non-wall, non-boundary cells */}
              {grid.map((row, gy) =>
                row.map((solid, gx) => {
                  const isBoundary =
                    gx === 0 ||
                    gx === mapData.width - 1 ||
                    gy === 0 ||
                    gy === mapData.height - 1;
                  const isWall = mapData.walls.some(
                    (w) => w.x === gx && w.y === gy,
                  );
                  if (isBoundary || isWall) return null;
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
                      strokeWidth={0.04}
                    />
                  );
                }),
              )}
              {/* Boundary walls - solid fill */}
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
                    stroke="#6a6a7a"
                    strokeWidth={0.08}
                  />
                );
              })}
              {/* Interior walls - bold solid fills */}
              {mapData.walls
                .filter((w) =>
                  isInteriorCell(w.x, w.y, mapData.width, mapData.height),
                )
                .map((w, i) => {
                  const wx = gridToWorldX(w.x, mapData.width);
                  const wz = gridToWorldZ(w.y, mapData.height);
                  const fill = w.height >= 2 ? "#d98c58" : "#5a99e6";
                  return (
                    <rect
                      key={`w-${i}`}
                      x={wx - 0.5}
                      y={wz - 0.5}
                      width={1}
                      height={1}
                      fill={fill}
                      stroke="#9a9aaa"
                      strokeWidth={0.08}
                    />
                  );
                })}
              {/* Spawn points - solid filled circles */}
              {mapData.spawnPoints.map((s, i) => (
                <circle
                  key={`s-${i}`}
                  cx={s.x}
                  cy={s.y}
                  r={0.42}
                  fill="#28e666"
                  stroke="#fff"
                  strokeWidth={0.1}
                />
              ))}
              {/* Flag locations - solid filled, team colored */}
              {(mapData.flagLocations ?? []).map((f, i) => (
                <rect
                  key={`fl-${i}`}
                  x={f.x - 0.45}
                  y={f.y - 0.45}
                  width={0.9}
                  height={0.9}
                  fill={FLAG_TEAM_COLORS[f.team ?? 1] ?? FLAG_TEAM_COLORS[1]}
                  stroke="#fff"
                  strokeWidth={0.1}
                />
              ))}
              {/* Interaction layer - drag to paint */}
              {grid.map((_, gy) =>
                Array.from({ length: mapData.width }, (_, gx) => {
                  const wx = gridToWorldX(gx, mapData.width);
                  const wz = gridToWorldZ(gy, mapData.height);
                  return (
                    <rect
                      key={`c-${gx}-${gy}`}
                      x={wx - 0.5}
                      y={wz - 0.5}
                      width={1}
                      height={1}
                      fill="transparent"
                      style={{ cursor: "pointer" }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleCellDown(gx, gy);
                      }}
                      onMouseEnter={(e) => {
                        handleCellEnter(gx, gy);
                        if (!dragging) {
                          (e.currentTarget as SVGElement).setAttribute(
                            "fill",
                            "rgba(100, 200, 255, 0.15)",
                          );
                        }
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as SVGElement).setAttribute(
                          "fill",
                          "transparent",
                        );
                      }}
                      onMouseUp={handleDragEnd}
                    />
                  );
                }),
              )}
            </g>
          </svg>
        </div>
      </div>
    </main>
  );
}

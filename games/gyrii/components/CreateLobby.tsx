"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth-context";
import { useGyriiStore } from "../store/gameStore";
import { useGyriiConnection } from "../hooks/useGyriiConnection";
import { maps } from "../game/maps";
import MinimapPreview from "./MinimapPreview";

type CustomMapMeta = {
  id: string;
  creatorId: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

type GameModeId = "freeForAll" | "teamDeathmatch" | "captureTheFlag";

const GAME_MODES: { id: GameModeId; name: string; description: string }[] = [
  {
    id: "freeForAll",
    name: "Free For All",
    description: "Every player for themselves",
  },
  {
    id: "teamDeathmatch",
    name: "Team Deathmatch",
    description: "Two teams battle it out",
  },
  {
    id: "captureTheFlag",
    name: "Capture The Flag",
    description: "Capture the enemy flag",
  },
];
const ENABLED_GAME_MODES: GameModeId[] = [
  "freeForAll",
  "teamDeathmatch",
  "captureTheFlag",
];

const MAPS: { id: string; name: string; description: string }[] = [
  { id: "arena", name: "Arena", description: "Open arena with corner pillars" },
  { id: "maze", name: "Maze", description: "Labyrinthine corridors" },
  {
    id: "warehouse",
    name: "Warehouse",
    description: "Industrial shelving and crates",
  },
];

interface CreateLobbyProps {
  onBack: () => void;
  isConnected: boolean;
}

export default function CreateLobby({ onBack, isConnected }: CreateLobbyProps) {
  const { user } = useAuth();
  const { setGameState } = useGyriiStore();
  const { createLobby } = useGyriiConnection();
  const isConnecting = useGyriiStore((s) => s.isConnecting);

  const [lobbyName, setLobbyName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [gameMode, setGameMode] = useState<GameModeId>("freeForAll");
  const [mapSource, setMapSource] = useState<"builtin" | "custom">("builtin");
  const [mapPool, setMapPool] = useState<string[]>([
    "arena",
    "maze",
    "warehouse",
  ]);
  const [selectedCustomMapId, setSelectedCustomMapId] = useState<string | null>(
    null,
  );
  const [customMaps, setCustomMaps] = useState<CustomMapMeta[]>([]);
  const [customMapsLoading, setCustomMapsLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [scoreLimit, setScoreLimit] = useState(25);
  const [flagLimit, setFlagLimit] = useState(3);

  useEffect(() => {
    if (!user) {
      setCustomMaps([]);
      return;
    }
    setCustomMapsLoading(true);
    fetch("/api/gyrii/maps")
      .then((r) => (r.ok ? r.json() : { maps: [] }))
      .then((data) => setCustomMaps(data.maps ?? []))
      .catch(() => setCustomMaps([]))
      .finally(() => setCustomMapsLoading(false));
  }, [user]);

  const handleCreate = async () => {
    if (!lobbyName.trim() || isConnecting || !isConnected) return;
    if (
      mapSource === "custom" &&
      (!selectedCustomMapId ||
        !customMaps.some((m) => m.id === selectedCustomMapId))
    ) {
      return;
    }

    try {
      const mapIdMap: Record<string, "Arena" | "Maze" | "Warehouse"> = {
        arena: "Arena",
        maze: "Maze",
        warehouse: "Warehouse",
      };
      const gameModeMap: Record<
        string,
        "FreeForAll" | "TeamDeathmatch" | "CaptureTheFlag"
      > = {
        freeForAll: "FreeForAll",
        teamDeathmatch: "TeamDeathmatch",
        captureTheFlag: "CaptureTheFlag",
      };

      const name = lobbyName.trim();
      const isCtf = gameMode === "captureTheFlag";
      const hostPlayerName = useGyriiStore.getState().playerName;

      let mapId: "Arena" | "Maze" | "Warehouse" | "Custom";
      let mapPoolTags: ("Arena" | "Maze" | "Warehouse")[];
      let customMapJson: string | undefined;

      if (mapSource === "custom" && selectedCustomMapId) {
        const res = await fetch(`/api/gyrii/maps/${selectedCustomMapId}`);
        if (!res.ok) throw new Error("Failed to load map");
        const mapData = await res.json();
        customMapJson = JSON.stringify(mapData);
        mapId = "Custom";
        mapPoolTags = [];
      } else {
        const selectedPool = mapPool.length > 0 ? mapPool : ["arena"];
        mapPoolTags = selectedPool.map((m) => mapIdMap[m]).filter(Boolean) as (
          | "Arena"
          | "Maze"
          | "Warehouse"
        )[];
        const primaryMap = selectedPool[0] ?? "arena";
        mapId = mapIdMap[primaryMap] || "Arena";
      }

      await createLobby(
        name,
        hostPlayerName,
        mapId,
        mapPoolTags,
        maxPlayers,
        gameModeMap[gameMode] || "FreeForAll",
        isCtf ? 25 : scoreLimit,
        isCtf ? flagLimit : 3,
        password,
        customMapJson,
      );

      let attempts = 0;
      const maxAttempts = 25;
      const checkForLobby = () => {
        attempts++;
        const lobby = useGyriiStore.getState().currentLobby;
        if (lobby && lobby.name === name) {
          setGameState("playing");
          setLobbyName("");
          setMaxPlayers(8);
          setGameMode("freeForAll");
          setMapPool(["arena", "maze", "warehouse"]);
          setPassword("");
          onBack();
        } else if (attempts < maxAttempts) {
          setTimeout(checkForLobby, 200);
        } else {
          console.warn("Timed out waiting for lobby to be set");
        }
      };

      setTimeout(checkForLobby, 300);
    } catch (error) {
      console.error("Failed to create lobby:", error);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {!isConnected && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-300 mb-4">
          Connection lost. Reconnecting...
        </div>
      )}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-pink-400">Create Lobby</h2>
        <button onClick={onBack} className="text-gray-400 hover:text-white">
          ← Back
        </button>
      </div>

      <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-pink-500/30 space-y-4 overflow-y-auto flex-1">
        <div>
          <label className="block text-xs text-gray-400 mb-2">LOBBY NAME</label>
          <input
            type="text"
            value={lobbyName}
            onChange={(e) => setLobbyName(e.target.value)}
            maxLength={30}
            placeholder="My Awesome Lobby"
            className="w-full bg-gray-900 border border-pink-500/50 rounded px-3 py-2 text-pink-300 focus:outline-none focus:border-pink-400"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-2">GAME MODE</label>
          <div className="grid grid-cols-3 gap-2">
            {GAME_MODES.map((mode) => {
              const isEnabled = ENABLED_GAME_MODES.includes(mode.id);
              const isSelected = gameMode === mode.id;
              return (
                <button
                  key={mode.id}
                  onClick={() => {
                    if (!isEnabled) return;
                    setGameMode(mode.id);
                  }}
                  disabled={!isEnabled}
                  className={`px-3 py-2 rounded text-left transition-all ${
                    isSelected
                      ? "bg-pink-600 text-white"
                      : isEnabled
                        ? "bg-gray-800 text-gray-400 hover:bg-gray-700"
                        : "bg-gray-900 text-gray-600 opacity-70 cursor-not-allowed"
                  }`}
                  title={isEnabled ? mode.description : "Temporarily disabled"}
                >
                  <div className="text-sm font-semibold">{mode.name}</div>
                  <div className="text-[10px] opacity-70">
                    {mode.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-2">MAP</label>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setMapSource("builtin")}
              className={`px-3 py-1.5 rounded text-sm ${
                mapSource === "builtin"
                  ? "bg-cyan-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              Built-in
            </button>
            <button
              onClick={() => setMapSource("custom")}
              disabled={!user}
              className={`px-3 py-1.5 rounded text-sm ${
                mapSource === "custom"
                  ? "bg-cyan-600 text-white"
                  : user
                    ? "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    : "bg-gray-900 text-gray-600 opacity-70 cursor-not-allowed"
              }`}
              title={!user ? "Sign in to use custom maps" : undefined}
            >
              Custom
            </button>
          </div>

          {mapSource === "builtin" ? (
            <>
              <p className="text-[11px] text-gray-500 mb-2">
                Map pool (for next rounds)
              </p>
              <div className="overflow-x-auto pb-1">
                <div className="flex gap-3 min-w-max">
                  {MAPS.map((map) => {
                    const selected = mapPool.includes(map.id);
                    return (
                      <button
                        key={`pool-${map.id}`}
                        onClick={() => {
                          setMapPool((prev) => {
                            const has = prev.includes(map.id);
                            if (has) {
                              if (prev.length === 1) return prev;
                              return prev.filter((m) => m !== map.id);
                            }
                            return [...prev, map.id];
                          });
                        }}
                        className={`rounded text-left transition-all border ${
                          selected
                            ? "bg-cyan-600/90 text-white border-cyan-300/80"
                            : "bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700"
                        }`}
                        style={{ minWidth: 220, maxWidth: 220 }}
                      >
                        <div className="p-2">
                          <div className="text-sm font-semibold">
                            {map.name}
                          </div>
                          <div className="text-[10px] opacity-70">
                            {map.description}
                          </div>
                          <div className="mt-2 rounded border border-white/20 bg-black/30 p-1">
                            <MinimapPreview
                              mapData={maps[map.id] ?? maps.arena}
                              size={160}
                              className="rounded"
                            />
                          </div>
                          <div className="text-[10px] mt-2 opacity-80">
                            {selected ? "Included" : "Excluded"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                At least one map must stay selected.
              </p>
            </>
          ) : (
            <div className="space-y-2">
              {!user ? (
                <p className="text-sm text-gray-500">
                  Sign in to create and use custom maps.
                </p>
              ) : customMapsLoading ? (
                <p className="text-sm text-gray-500">Loading custom maps...</p>
              ) : customMaps.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No custom maps yet.{" "}
                  <Link
                    href="/arcade/gyrii/maps"
                    className="text-cyan-400 hover:underline"
                  >
                    Create one
                  </Link>
                  .
                </p>
              ) : (
                <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                  {customMaps.map((m) => (
                    <button
                      key={m.id}
                      onClick={() =>
                        setSelectedCustomMapId(
                          selectedCustomMapId === m.id ? null : m.id,
                        )
                      }
                      className={`rounded text-left p-3 border transition-all ${
                        selectedCustomMapId === m.id
                          ? "bg-cyan-600/90 text-white border-cyan-300/80"
                          : "bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700"
                      }`}
                    >
                      <div className="font-semibold">{m.name}</div>
                      {m.description && (
                        <div className="text-xs opacity-80 mt-0.5">
                          {m.description}
                        </div>
                      )}
                      <div className="text-[10px] mt-1 opacity-70">
                        {m.isPublic ? "Public" : "Private"}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {(gameMode === "freeForAll" || gameMode === "teamDeathmatch") && (
          <div>
            <label className="block text-xs text-gray-400 mb-2">
              KILLS TO WIN
            </label>
            <div className="flex gap-2 flex-wrap">
              {[3, 5, 10, 15, 25, 35, 50].map((num) => (
                <button
                  key={num}
                  onClick={() => setScoreLimit(num)}
                  className={`px-4 py-2 rounded ${
                    scoreLimit === num
                      ? "bg-pink-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        )}

        {gameMode === "captureTheFlag" && (
          <div>
            <label className="block text-xs text-gray-400 mb-2">
              FLAGS TO CAPTURE
            </label>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3, 5, 7].map((num) => (
                <button
                  key={num}
                  onClick={() => setFlagLimit(num)}
                  className={`px-4 py-2 rounded ${
                    flagLimit === num
                      ? "bg-pink-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-400 mb-2">
            MAX PLAYERS
          </label>
          <div className="flex gap-2 flex-wrap">
            {[2, 4, 6, 8, 12, 16].map((num) => (
              <button
                key={num}
                onClick={() => setMaxPlayers(num)}
                className={`px-4 py-2 rounded ${
                  maxPlayers === num
                    ? "bg-pink-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {num}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-2">
            PASSWORD
            <span className="text-gray-500 ml-1">(optional)</span>
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={30}
            placeholder="Leave empty for public lobby"
            className="w-full bg-gray-900 border border-pink-500/50 rounded px-3 py-2 text-pink-300 focus:outline-none focus:border-pink-400"
          />
          {password && (
            <p className="text-xs text-pink-400/70 mt-1">
              This lobby will be private - players will need the password to
              join
            </p>
          )}
        </div>

        <button
          onClick={handleCreate}
          disabled={
            !lobbyName.trim() ||
            !isConnected ||
            (mapSource === "custom" && !selectedCustomMapId)
          }
          className="w-full py-3 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-bold transition-all"
        >
          CREATE LOBBY
        </button>
      </div>
    </div>
  );
}

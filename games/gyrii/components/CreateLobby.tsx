"use client";

import { useState } from "react";
import { useGyriiStore } from "../store/gameStore";
import { useSpacetimeDB } from "../hooks/useSpacetimeDB";
import { maps } from "../game/maps";
import MinimapPreview from "./MinimapPreview";

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
  const { setGameState } = useGyriiStore();
  const { createLobby } = useSpacetimeDB();
  const isConnecting = useGyriiStore((s) => s.isConnecting);

  const [lobbyName, setLobbyName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [gameMode, setGameMode] = useState<GameModeId>("freeForAll");
  const [mapId, setMapId] = useState("arena");
  const [password, setPassword] = useState("");

  const handleCreate = async () => {
    if (!lobbyName.trim() || isConnecting || !isConnected) return;

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
      await createLobby(
        name,
        mapIdMap[mapId] || "Arena",
        maxPlayers,
        gameModeMap[gameMode] || "FreeForAll",
        password,
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
          setMapId("arena");
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
            {GAME_MODES.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setGameMode(mode.id)}
                className={`px-3 py-2 rounded text-left transition-all ${
                  gameMode === mode.id
                    ? "bg-pink-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                <div className="text-sm font-semibold">{mode.name}</div>
                <div className="text-[10px] opacity-70">{mode.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-2">MAP</label>
          <div className="flex gap-3 items-start">
            <div className="rounded border border-pink-500/40 bg-gray-900/80 p-1 shrink-0">
              <MinimapPreview
                mapData={maps[mapId] ?? maps.arena}
                size={100}
                className="rounded"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 flex-1">
              {MAPS.map((map) => (
                <button
                  key={map.id}
                  onClick={() => setMapId(map.id)}
                  className={`px-3 py-2 rounded text-left transition-all ${
                    mapId === map.id
                      ? "bg-pink-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  <div className="text-sm font-semibold">{map.name}</div>
                  <div className="text-[10px] opacity-70">
                    {map.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

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
          disabled={!lobbyName.trim() || !isConnected}
          className="w-full py-3 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-bold transition-all"
        >
          CREATE LOBBY
        </button>
      </div>
    </div>
  );
}

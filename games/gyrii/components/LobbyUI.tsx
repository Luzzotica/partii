"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth-context";
import { createClient } from "@/lib/supabase/client";
import { useGyriiStore } from "../store/gameStore";
import MarbleDesigner from "./MarbleDesigner";
import CreateLobby from "./CreateLobby";
import { useGyriiConnection } from "../hooks/useGyriiConnection";

type GyriiLeaderboardEntry = {
  rank: number;
  display_name: string;
  matches_played: number;
  kills: number;
  deaths: number;
  kdr: number;
};

type GyriiPersonalStats = {
  totals: {
    matches_played: number;
    kills: number;
    deaths: number;
    assists: number;
    damage_dealt: number;
    damage_taken: number;
    kdr: number;
  };
};

const GAME_MODE_LABELS: Record<string, string> = {
  freeForAll: "Free For All",
  teamDeathmatch: "Team Deathmatch",
  captureTheFlag: "Capture The Flag",
};

const MAP_LABELS: Record<string, string> = {
  arena: "Arena",
  maze: "Maze",
  warehouse: "Warehouse",
  custom: "Custom",
};

export default function LobbyUI() {
  const [rightPanelView, setRightPanelView] = useState<"lobbies" | "create">(
    "lobbies",
  );
  const { user, loading: authLoading } = useAuth();
  const supabase = createClient();
  const {
    playerName,
    setPlayerName,
    marbleConfig,
    setMarbleConfig,
    setPlayerColor,
    availableLobbies,
    setGameState,
    currentLobby,
    setCurrentLobby,
  } = useGyriiStore();

  const { joinLobby, refreshLobbies } = useGyriiConnection();
  const isConnected = useGyriiStore((s) => s.isConnected);
  const [isGuest, setIsGuest] = useState(true);
  const [displayNameLoading, setDisplayNameLoading] = useState(true);
  const [selectedLobbyId, setSelectedLobbyId] = useState<string | null>(null);
  const [joiningLobbyId, setJoiningLobbyId] = useState<string | null>(null);
  const [joinPassword, setJoinPassword] = useState("");
  const [customMapConfirmPending, setCustomMapConfirmPending] = useState<{
    lobbyId: string;
    hasPassword: boolean;
    password: string;
  } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [leaderboard, setLeaderboard] = useState<GyriiLeaderboardEntry[]>([]);
  const [personalStats, setPersonalStats] = useState<GyriiPersonalStats | null>(
    null,
  );

  // Refresh lobby list when mounting on lobby screen
  useEffect(() => {
    if (isConnected) refreshLobbies();
  }, [isConnected, refreshLobbies]);

  // Fetch user's display name and marble config if logged in; randomize marble for guests
  useEffect(() => {
    const fetchUserData = async () => {
      if (authLoading) return;

      if (user) {
        setDisplayNameLoading(true);
        try {
          const { data } = await supabase
            .from("profiles")
            .select("display_name, gyrii_marble_config")
            .eq("id", user.id)
            .single();

          // Same fallback chain as UserMenu:
          // profiles.display_name > user_metadata.display_name > full_name > name > email
          const displayName =
            data?.display_name?.trim() ||
            user.user_metadata?.display_name ||
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email?.split("@")[0] ||
            "Player";
          setPlayerName(displayName);
          setIsGuest(false);

          if (data?.gyrii_marble_config) {
            const cfg = data.gyrii_marble_config as {
              designId: number;
              mainColor: { r: number; g: number; b: number };
              secondaryColor: { r: number; g: number; b: number };
            };
            setMarbleConfig({
              designId: (cfg.designId ??
                0) as import("../store/gameStore").MarbleDesignId,
              mainColor: cfg.mainColor ?? { r: 0, g: 255, b: 255 },
              secondaryColor: cfg.secondaryColor ?? { r: 255, g: 0, b: 128 },
            });
            setPlayerColor(cfg.mainColor ?? { r: 0, g: 255, b: 255 });
          }
        } catch (error) {
          console.error("Failed to fetch user data:", error);
          setPlayerName("Guest");
          setIsGuest(true);
        } finally {
          setDisplayNameLoading(false);
        }
      } else {
        if (!playerName || playerName === "Player") {
          setPlayerName("Guest");
        }
        setIsGuest(true);
        setDisplayNameLoading(false);
        // Randomize marble for guests (once per mount)
        const { randomMarbleConfig } = await import("./MarbleDesigner");
        const next = randomMarbleConfig();
        setMarbleConfig(next);
        setPlayerColor(next.mainColor);
      }
    };

    fetchUserData();
  }, [
    user,
    authLoading,
    supabase,
    setPlayerName,
    setMarbleConfig,
    setPlayerColor,
  ]);

  useEffect(() => {
    let isMounted = true;

    const loadStats = async () => {
      setStatsLoading(true);
      try {
        const [leaderboardRes, personalRes] = await Promise.all([
          fetch("/api/gyrii/stats?limit=5"),
          user ? fetch("/api/gyrii/stats/personal") : Promise.resolve(null),
        ]);

        if (leaderboardRes?.ok) {
          const data = (await leaderboardRes.json()) as {
            players?: GyriiLeaderboardEntry[];
          };
          if (isMounted) {
            setLeaderboard(data.players ?? []);
          }
        }

        if (personalRes?.ok) {
          const data = (await personalRes.json()) as GyriiPersonalStats;
          if (isMounted) {
            setPersonalStats(data);
          }
        } else if (isMounted) {
          setPersonalStats(null);
        }
      } catch (error) {
        console.error("Failed to load gyrii stats:", error);
      } finally {
        if (isMounted) {
          setStatsLoading(false);
        }
      }
    };

    loadStats();
    return () => {
      isMounted = false;
    };
  }, [user]);

  const handleSelectLobby = (lobbyId: string, hasPassword: boolean) => {
    if (hasPassword) {
      setJoiningLobbyId(lobbyId);
      setSelectedLobbyId(null);
      setJoinPassword("");
    } else {
      setSelectedLobbyId(lobbyId);
      setJoiningLobbyId(null);
    }
  };

  const doJoinLobby = async (lobbyId: string, password: string) => {
    try {
      await joinLobby(parseInt(lobbyId), playerName, password);
      setJoiningLobbyId(null);
      setJoinPassword("");
      setSelectedLobbyId(null);
      setCustomMapConfirmPending(null);
      let attempts = 0;
      const checkForLobby = () => {
        attempts++;
        const current = useGyriiStore.getState().currentLobby;
        if (current && current.id === lobbyId) {
          setGameState("playing");
        } else if (attempts < 25) {
          setTimeout(checkForLobby, 200);
        }
      };
      setTimeout(checkForLobby, 300);
    } catch (error) {
      console.error("Failed to join lobby:", error);
    }
  };

  const handleJoinSelected = async () => {
    const lobbyId = selectedLobbyId || joiningLobbyId;
    if (!lobbyId) return;
    const lobby = availableLobbies.find((l) => l.id === lobbyId);
    if (!lobby) return;
    if (lobby.hasPassword && !joinPassword.trim()) {
      setJoiningLobbyId(lobbyId);
      setJoinPassword("");
      return;
    }
    if (lobby.isCustomMap) {
      setCustomMapConfirmPending({
        lobbyId,
        hasPassword: lobby.hasPassword,
        password: lobby.hasPassword ? joinPassword : "",
      });
      return;
    }
    await doJoinLobby(lobbyId, lobby.hasPassword ? joinPassword : "");
  };

  const handleConfirmJoin = async () => {
    if (!joiningLobbyId) return;
    const lobby = availableLobbies.find((l) => l.id === joiningLobbyId);
    if (!lobby || !joinPassword.trim()) return;
    if (lobby.isCustomMap) {
      setCustomMapConfirmPending({
        lobbyId: joiningLobbyId,
        hasPassword: true,
        password: joinPassword,
      });
      setJoiningLobbyId(null);
      setJoinPassword("");
      return;
    }
    await doJoinLobby(joiningLobbyId, joinPassword);
  };

  const handleCustomMapConfirmContinue = async () => {
    if (!customMapConfirmPending) return;
    await doJoinLobby(
      customMapConfirmPending.lobbyId,
      customMapConfirmPending.password,
    );
  };

  return (
    <div className="absolute inset-0 overflow-y-auto bg-gradient-to-br from-black/90 via-purple-900/20 to-black/90 backdrop-blur-sm">
      <div className="w-full px-4 pt-16 pb-24 min-h-full">
        {/* Title */}
        <h1 className="text-5xl font-bold text-center mb-1">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-pink-500 to-yellow-400">
            GYRII
          </span>
        </h1>
        <p className="text-center text-gray-400 mb-2">Neon Ball Shooter</p>
        <div className="text-center mb-4">
          <div className="inline-block bg-black/30 backdrop-blur-sm rounded-lg px-4 py-2 text-xs text-gray-400">
            WASD - Move | Mouse - Aim | LMB - Shoot | RMB - Grenade | Space -
            Secondary
          </div>
        </div>
        <p className="text-center mb-4">
          <Link
            href="/arcade/gyrii/maps"
            className="inline-block py-2 px-4 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-400 text-sm font-medium border border-cyan-500/50"
          >
            My Maps
          </Link>
        </p>

        <div className="flex gap-6 flex-col lg:flex-row">
          {/* Left 1/3: Player Name + Marble Designer */}
          <div className="w-full lg:w-1/3 min-w-0 flex flex-col gap-4">
            {/* Player Name - above marble */}
            <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-cyan-500/30 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs text-gray-400">
                  PLAYER NAME
                </label>
                {isGuest && (
                  <span className="text-xs text-yellow-400/70 bg-yellow-400/10 px-2 py-0.5 rounded">
                    Guest
                  </span>
                )}
                {!isGuest && (
                  <span className="text-xs text-green-400/70 bg-green-400/10 px-2 py-0.5 rounded">
                    Logged In
                  </span>
                )}
              </div>
              {displayNameLoading ? (
                <div className="w-full bg-gray-900 border border-cyan-500/50 rounded px-3 py-2 text-cyan-300/50 animate-pulse">
                  Loading...
                </div>
              ) : (
                <input
                  type="text"
                  value={playerName}
                  onChange={
                    isGuest ? (e) => setPlayerName(e.target.value) : undefined
                  }
                  readOnly={!isGuest}
                  maxLength={20}
                  className={`w-full bg-gray-900 border border-cyan-500/50 rounded px-3 py-2 text-cyan-300 focus:outline-none focus:border-cyan-400 ${!isGuest ? "cursor-default" : ""}`}
                  placeholder={isGuest ? "Enter your name" : "Display name"}
                />
              )}
              {!isGuest && user && (
                <p className="text-xs text-gray-500 mt-1">
                  Using your profile display name
                </p>
              )}
              {isGuest && (
                <p className="text-xs text-yellow-400/70 mt-1">
                  Playing as guest - sign in to use your account name
                </p>
              )}
            </div>
            <MarbleDesigner />
            <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-cyan-500/30">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-cyan-300">
                  Gyrii Stats
                </h3>
                {statsLoading && (
                  <span className="text-xs text-gray-400 animate-pulse">
                    Loading...
                  </span>
                )}
              </div>
              {user && personalStats ? (
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div className="bg-gray-900/70 rounded px-2 py-1">
                    <div className="text-gray-400">Matches</div>
                    <div className="text-white">
                      {personalStats.totals.matches_played}
                    </div>
                  </div>
                  <div className="bg-gray-900/70 rounded px-2 py-1">
                    <div className="text-gray-400">K/D</div>
                    <div className="text-white">
                      {personalStats.totals.kdr.toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-gray-900/70 rounded px-2 py-1">
                    <div className="text-gray-400">Kills</div>
                    <div className="text-white">
                      {personalStats.totals.kills}
                    </div>
                  </div>
                  <div className="bg-gray-900/70 rounded px-2 py-1">
                    <div className="text-gray-400">Deaths</div>
                    <div className="text-white">
                      {personalStats.totals.deaths}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mb-3">
                  Sign in to save and view your personal Gyrii history.
                </p>
              )}

              <div className="text-xs text-gray-400 mb-1">Top Players</div>
              <div className="space-y-1">
                {leaderboard.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    No tracked matches yet.
                  </p>
                ) : (
                  leaderboard.map((entry) => (
                    <div
                      key={`${entry.rank}-${entry.display_name}`}
                      className="flex items-center justify-between bg-gray-900/60 rounded px-2 py-1 text-xs"
                    >
                      <div className="text-cyan-300 truncate pr-2">
                        #{entry.rank} {entry.display_name}
                      </div>
                      <div className="text-gray-300">
                        {entry.kills}/{entry.deaths} ({entry.kdr.toFixed(2)})
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right 2/3: Lobby list or Create Lobby */}
          <div className="flex-1 lg:flex-[2] min-w-0 flex flex-col">
            {rightPanelView === "lobbies" ? (
              <>
                {!isConnected && (
                  <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-300 mb-4">
                    Waiting for server connection... You can design your marble
                    while connecting.
                  </div>
                )}
                <div className="bg-black/50 backdrop-blur-sm rounded-lg border border-cyan-500/30 overflow-hidden">
                  {availableLobbies.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">
                      No lobbies available. Create one!
                    </div>
                  ) : (
                    <div className="divide-y divide-cyan-500/20">
                      {availableLobbies.map((lobby) => (
                        <div
                          key={lobby.id}
                          onClick={() =>
                            handleSelectLobby(lobby.id, lobby.hasPassword)
                          }
                          className={`p-4 hover:bg-cyan-500/10 cursor-pointer transition-colors ${
                            selectedLobbyId === lobby.id
                              ? "bg-cyan-500/20 border-l-2 border-l-cyan-400"
                              : ""
                          }`}
                        >
                          <div className="flex justify-between items-center">
                            <div>
                              <div className="text-lg font-semibold text-white flex items-center gap-2">
                                {lobby.hasPassword && (
                                  <span
                                    className="text-yellow-400 text-sm"
                                    title="Password protected"
                                  >
                                    🔒
                                  </span>
                                )}
                                {lobby.isCustomMap && (
                                  <span
                                    className="text-amber-400 text-sm"
                                    title="Custom map - content not reviewed"
                                  >
                                    🗺️
                                  </span>
                                )}
                                {lobby.name}
                              </div>
                              <div className="text-sm text-gray-400">
                                {GAME_MODE_LABELS[lobby.gameMode] ||
                                  lobby.gameMode}{" "}
                                •{" "}
                                {lobby.isCustomMap
                                  ? "Custom"
                                  : MAP_LABELS[lobby.mapId] || lobby.mapId}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-cyan-400">
                                {lobby.playerCount}/{lobby.maxPlayers}
                              </div>
                              <div className="text-xs text-gray-500">
                                {lobby.gameState}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Bottom: Create Lobby (left) and Join (right, grayed when no selection) */}
                <div className="flex justify-between items-center gap-4 mt-4">
                  <button
                    onClick={() => setRightPanelView("create")}
                    disabled={!isConnected}
                    className="py-3 px-6 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg text-white font-bold transition-all"
                  >
                    Create Lobby
                  </button>
                  <button
                    onClick={handleJoinSelected}
                    disabled={!isConnected || !selectedLobbyId}
                    className="py-3 px-6 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-700 rounded-lg text-white font-semibold transition-all"
                  >
                    Join
                  </button>
                </div>
              </>
            ) : (
              <CreateLobby
                onBack={() => setRightPanelView("lobbies")}
                isConnected={isConnected}
              />
            )}
          </div>
        </div>

        {/* Custom map warning modal */}
        {customMapConfirmPending && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/70 z-50">
            <div className="bg-gray-900 border border-amber-500/50 rounded-lg p-6 max-w-sm w-full mx-4 space-y-4">
              <h3 className="text-lg font-bold text-amber-400">Custom Map</h3>
              <p className="text-sm text-gray-400">
                This lobby uses a player-created map. Content has not been
                reviewed. Continue?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setCustomMapConfirmPending(null)}
                  className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCustomMapConfirmContinue}
                  className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 rounded text-white font-semibold transition-all"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Password prompt modal */}
        {joiningLobbyId && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/70 z-50">
            <div className="bg-gray-900 border border-cyan-500/50 rounded-lg p-6 max-w-sm w-full mx-4 space-y-4">
              <h3 className="text-lg font-bold text-cyan-400">
                Enter Password
              </h3>
              <p className="text-sm text-gray-400">
                This lobby is password protected.
              </p>
              <input
                type="password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                placeholder="Lobby password"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && joinPassword) {
                    handleConfirmJoin();
                  }
                }}
                className="w-full bg-gray-800 border border-cyan-500/50 rounded px-3 py-2 text-cyan-300 focus:outline-none focus:border-cyan-400"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setJoiningLobbyId(null);
                    setJoinPassword("");
                  }}
                  className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmJoin}
                  disabled={!joinPassword}
                  className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white font-semibold transition-all"
                >
                  Join
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

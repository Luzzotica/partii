"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useGameStore } from "@/games/hexii/store/gameStore";
import type { HexColor } from "@/games/hexii/store/gameStore";
import { audioManager } from "@/games/hexii/game/audio/AudioManager";
import { musicManager } from "@/lib/audio/MusicManager";
import { OptionsMenu } from "@/games/hexii/components/OptionsMenu";
import { Leaderboard } from "@/games/hexii/components/Leaderboard";
import { UserMenu } from "@/components/auth/UserMenu";
import { DiscordLink } from "@/components/ui/DiscordLink";
import { YouTubeLink } from "@/components/ui/YouTubeLink";
import { usePresence, useHighScores } from "@/lib/supabase/hooks";
import { useAuth } from "@/lib/supabase/auth-context";

// Dynamically import Game component to prevent SSR issues with Phaser
const Game = dynamic(
  () =>
    import("@/games/hexii/components/Game").then((mod) => ({
      default: mod.Game,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="w-screen min-h-screen flex justify-center items-start overflow-y-auto overflow-x-hidden font-orbitron">
        Loading game...
      </div>
    ),
  },
);

interface HexPosition {
  left: number;
  top: number;
}

function MainMenu({
  onStart,
  refreshKey,
}: {
  onStart: (color: HexColor) => void;
  refreshKey?: number;
}) {
  const [selectedColor, setSelectedColor] = useState<HexColor>("RED");
  const [hexPositions, setHexPositions] = useState<HexPosition[]>([]);
  const [showOptions, setShowOptions] = useState(false);
  const [personalBest, setPersonalBest] = useState<number | null>(null);
  const { currentGamePlayers } = usePresence("hexii");
  const { user } = useAuth();
  const { getPersonalBest } = useHighScores("hexii");

  useEffect(() => {
    // Generate random positions only on client side
    setHexPositions(
      Array.from({ length: 12 }, () => ({
        left: Math.random() * 100,
        top: Math.random() * 100,
      })),
    );

    // Start title music
    musicManager.play("/music/title-theme.mp3");

    // Fetch personal best score
    if (user) {
      getPersonalBest().then((pb) => {
        if (pb) {
          setPersonalBest(pb.score);
        } else {
          setPersonalBest(null);
        }
      });
    } else {
      setPersonalBest(null);
    }
  }, [user, refreshKey, getPersonalBest]);

  const handleColorSelect = (color: HexColor) => {
    audioManager.playSFX("ui-click");
    setSelectedColor(color);
  };

  const handleStartGame = () => {
    audioManager.playSFX("ui-click");
    musicManager.play("/music/gameplay.mp3");
    onStart(selectedColor);
  };

  const handleOptions = () => {
    audioManager.playSFX("ui-click");
    setShowOptions(true);
  };

  const handleHover = () => {
    audioManager.playSFX("ui-hover");
  };

  const colors: { color: HexColor; name: string; desc: string }[] = [
    { color: "RED", name: "Damage", desc: "+5% Global Damage" },
    { color: "GREEN", name: "Growth", desc: "+10 Max HP" },
    { color: "YELLOW", name: "Speed", desc: "+5% Move Speed" },
    { color: "BLUE", name: "Shield", desc: "+10 Max Shield" },
  ];

  const colorClasses: Record<HexColor, string> = {
    RED: "text-[#ff4757]",
    GREEN: "text-[#2ed573]",
    YELLOW: "text-[#ffa502]",
    BLUE: "text-[#3742fa]",
    CYAN: "text-[#00d2d3]",
    ORANGE: "text-[#ff6348]",
  };

  const hexAnimationDurations = [
    "animate-[float_18s_ease-in-out_infinite]",
    "animate-[float_22s_ease-in-out_infinite]",
    "animate-[float_16s_ease-in-out_infinite]",
    "animate-[float_24s_ease-in-out_infinite]",
    "animate-[float_20s_ease-in-out_infinite]",
    "animate-[float_26s_ease-in-out_infinite]",
    "animate-[float_15s_ease-in-out_infinite]",
    "animate-[float_23s_ease-in-out_infinite]",
    "animate-[float_19s_ease-in-out_infinite]",
    "animate-[float_21s_ease-in-out_infinite]",
    "animate-[float_17s_ease-in-out_infinite]",
    "animate-[float_25s_ease-in-out_infinite]",
  ];

  const hexColors = [
    "text-[rgba(255,71,87,0.05)]",
    "text-[rgba(46,213,115,0.05)]",
    "text-[rgba(255,165,2,0.05)]",
    "text-[rgba(55,66,250,0.05)]",
    "text-white/[0.03]",
    "text-white/[0.03]",
    "text-[rgba(255,71,87,0.05)]",
    "text-[rgba(46,213,115,0.05)]",
    "text-white/[0.03]",
    "text-[rgba(55,66,250,0.05)]",
    "text-white/[0.03]",
    "text-[rgba(255,165,2,0.05)]",
  ];

  return (
    <div className="relative w-full min-h-screen bg-[radial-gradient(ellipse_at_30%_20%,rgba(55,66,250,0.15)_0%,transparent_50%),radial-gradient(ellipse_at_70%_80%,rgba(255,71,87,0.1)_0%,transparent_50%),linear-gradient(180deg,#0a0a14_0%,#1a1a2e_50%,#0a0a14_100%)] flex justify-center items-start overflow-visible">
      <div className="absolute top-5 left-5 right-5 z-20 flex justify-between items-center">
        <Link
          href="/arcade"
          className="font-orbitron inline-block text-white/60 no-underline text-sm tracking-wider transition-colors hover:text-white/90"
        >
          ← Back to Arcade
        </Link>
        <div className="flex items-center gap-4">
          <DiscordLink />
          <YouTubeLink />
          <UserMenu />
        </div>
      </div>
      {currentGamePlayers > 0 && (
        <div className="fixed bottom-5 right-5 z-20 flex items-center gap-2 rounded-lg bg-black/70 px-3 py-2 border border-white/10">
          <span className="w-2 h-2 rounded-full bg-[#2ed573] shadow-[0_0_8px_#2ed573] animate-pulse" />
          <span className="font-orbitron text-xs text-white/80 tracking-wide">
            {currentGamePlayers} playing
          </span>
        </div>
      )}
      <div className="relative z-10 text-center px-4 md:px-10 pt-24 md:pt-32 pb-10 w-full max-w-[1200px]">
        <h1 className="font-orbitron text-4xl md:text-6xl lg:text-8xl xl:text-9xl font-black tracking-[10px] md:tracking-[15px] lg:tracking-[20px] mb-2 bg-gradient-to-r from-white via-[#a8a8ff] to-white bg-clip-text text-transparent drop-shadow-[0_0_40px_rgba(100,100,255,0.5)]">
          <span className="inline-block mx-2 md:mx-5 animate-[rotate_10s_linear_infinite]">
            ⬡
          </span>
          HEXII
          <span className="inline-block mx-2 md:mx-5 animate-[rotate_10s_linear_infinite]">
            ⬡
          </span>
        </h1>
        <p className="font-orbitron text-sm md:text-base text-white/60 tracking-[2px] md:tracking-[4px] mb-4 uppercase">
          Prove that Hexagons are the Bestagons.
        </p>

        {personalBest !== null && (
          <div className="font-orbitron text-xs md:text-sm text-white/50 tracking-wide mb-4 flex items-center justify-center gap-2">
            Your Best:{" "}
            <span className="text-[#ffa502] font-bold text-sm md:text-base">
              {personalBest.toLocaleString()}
            </span>
          </div>
        )}

        <div className="mb-8 md:mb-12">
          <h2 className="font-orbitron text-xs md:text-sm tracking-[3px] md:tracking-[6px] text-white/50 mb-6">
            SELECT YOUR CORE
          </h2>
          <div className="flex flex-wrap justify-center gap-4 md:gap-4">
            {colors.map(({ color, name, desc }) => {
              const glowColors: Record<HexColor, string> = {
                RED: "drop-shadow-[0_0_20px_rgba(255,71,87,0.8),0_0_40px_rgba(255,71,87,0.4)]",
                GREEN:
                  "drop-shadow-[0_0_20px_rgba(46,213,115,0.8),0_0_40px_rgba(46,213,115,0.4)]",
                YELLOW:
                  "drop-shadow-[0_0_20px_rgba(255,165,2,0.8),0_0_40px_rgba(255,165,2,0.4)]",
                BLUE: "drop-shadow-[0_0_20px_rgba(55,66,250,0.8),0_0_40px_rgba(55,66,250,0.4)]",
                CYAN: "drop-shadow-[0_0_20px_rgba(0,210,211,0.8),0_0_40px_rgba(0,210,211,0.4)]",
                ORANGE:
                  "drop-shadow-[0_0_20px_rgba(255,99,72,0.8),0_0_40px_rgba(255,99,72,0.4)]",
              };
              return (
                <button
                  key={color}
                  className={`bg-white/5 border-2 rounded-xl p-4 md:p-5 w-[120px] md:w-[140px] cursor-pointer transition-all hover:bg-white/10 hover:-translate-y-1 ${colorClasses[color]} ${selectedColor === color ? "border-current bg-white/15 -translate-y-1 shadow-[0_10px_30px_rgba(0,0,0,0.3)]" : "border-white/10"}`}
                  onClick={() => handleColorSelect(color)}
                  onMouseEnter={handleHover}
                >
                  <div
                    className={`text-3xl md:text-5xl mb-3 ${glowColors[color]}`}
                  >
                    ⬢
                  </div>
                  <div className="font-orbitron text-xs md:text-sm font-bold tracking-wide mb-2">
                    {name}
                  </div>
                  <div className="font-orbitron text-[10px] text-white/50 tracking-wide">
                    {desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-4 items-center">
          <button
            className="font-orbitron text-sm md:text-lg font-bold tracking-[3px] md:tracking-[6px] px-8 md:px-15 py-4 md:py-5 bg-gradient-to-r from-[#ff4757] to-[#ff6b81] border-none rounded-lg text-white cursor-pointer transition-all hover:bg-gradient-to-r hover:from-[#ff6b81] hover:to-[#ff4757] hover:-translate-y-1 hover:shadow-[0_15px_50px_rgba(255,71,87,0.5)] active:translate-y-0 shadow-[0_10px_40px_rgba(255,71,87,0.4)] min-h-[44px]"
            onClick={handleStartGame}
            onMouseEnter={handleHover}
          >
            START GAME
          </button>
          <button
            className="font-orbitron text-xs md:text-sm font-semibold tracking-[2px] md:tracking-[4px] px-8 md:px-10 py-3 md:py-3.5 bg-white/5 border border-white/20 rounded-lg text-white/70 cursor-pointer transition-all hover:bg-white/10 hover:border-white/40 hover:text-white/90 hover:-translate-y-0.5 active:translate-y-0 min-h-[44px]"
            onClick={handleOptions}
            onMouseEnter={handleHover}
          >
            OPTIONS
          </button>
        </div>

        <div className="font-orbitron mt-8 md:mt-10 text-xs text-white/40 tracking-wide">
          <p>
            <strong className="text-white/70">WASD</strong> to move •{" "}
            <strong className="text-white/70">MOUSE</strong> to aim
          </p>
        </div>

        <Leaderboard refreshKey={refreshKey} />
      </div>

      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        {hexPositions.map((pos, i) => (
          <div
            key={i}
            className={`absolute text-[60px] ${hexColors[i]} ${hexAnimationDurations[i]}`}
            style={{
              animationDelay: `${i * 0.3}s`,
              left: `${pos.left}%`,
              top: `${pos.top}%`,
            }}
          >
            ⬡
          </div>
        ))}
      </div>

      {showOptions && <OptionsMenu onClose={() => setShowOptions(false)} />}
    </div>
  );
}

export default function HexiiPage() {
  const [gameStarted, setGameStarted] = useState(false);
  const [menuRefreshKey, setMenuRefreshKey] = useState(0);
  const initializeShip = useGameStore((state) => state.initializeShip);
  const setConstructionMode = useGameStore(
    (state) => state.setConstructionMode,
  );

  const handleStart = (color: HexColor) => {
    initializeShip(color);
    setGameStarted(true);
  };

  // Cleanup: fade out music when leaving the page
  useEffect(() => {
    return () => {
      musicManager.stop();
    };
  }, []);

  // Add keyboard listener for testing construction mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "c" || e.key === "C") {
        const state = useGameStore.getState();
        if (!state.isConstructionMode && gameStarted) {
          setConstructionMode(true, {
            type: "MODULE",
            color: ["RED", "GREEN", "YELLOW", "BLUE"][
              Math.floor(Math.random() * 4)
            ] as HexColor,
            health: 100,
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gameStarted, setConstructionMode]);

  const handleReturnToMenu = () => {
    musicManager.play("/music/title-theme.mp3");
    useGameStore.getState().reset();
    setGameStarted(false);
    setMenuRefreshKey((prev) => prev + 1); // Trigger refresh of menu data
  };

  // Cleanup: fade out music when leaving the page
  useEffect(() => {
    return () => {
      musicManager.stop();
    };
  }, []);

  return (
    <div className="w-screen min-h-screen flex justify-center items-start overflow-y-auto overflow-x-hidden font-orbitron">
      {!gameStarted ? (
        <MainMenu onStart={handleStart} refreshKey={menuRefreshKey} />
      ) : (
        <Game onReturnToMenu={handleReturnToMenu} />
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { isMobileDevice } from "@/lib/utils/mobile-detector";
import { GameHeader } from "@/components/game/GameHeader";
import { Leaderboard } from "@/games/rocket-to-heaven/components/Leaderboard";
import { usePresence, useHighScores } from "@/lib/supabase/hooks";
import { useAuth } from "@/lib/supabase/auth-context";
import { audioManager } from "@/games/rocket-to-heaven/game/audio/AudioManager";
import { musicManager } from "@/lib/audio/MusicManager";

// Dynamically import the game component to avoid SSR issues with Phaser
const Game = dynamic(
  () =>
    import("@/games/rocket-to-heaven/components/Game").then((mod) => mod.Game),
  { ssr: false },
);

export default function RocketToHeavenPage() {
  const [gameStarted, setGameStarted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [personalBest, setPersonalBest] = useState<number | null>(null);
  const [isMounted, setIsMounted] = useState(false); // Track if component is mounted (client-side only)
  const { currentGamePlayers } = usePresence("rocket-to-heaven");
  const { user } = useAuth();
  const { getPersonalBest } = useHighScores("rocket-to-heaven");

  useEffect(() => {
    setIsMobile(isMobileDevice());
    setIsMounted(true); // Mark as mounted on client
  }, []);

  // Play menu music when on the menu
  useEffect(() => {
    if (!gameStarted) {
      musicManager.play("/music/rocket-to-heaven/menu.mp3");
    }
  }, [gameStarted]);

  // Cleanup: fade out music when leaving the page
  useEffect(() => {
    return () => {
      musicManager.stop();
    };
  }, []);

  useEffect(() => {
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

  const handleReturnToMenu = () => {
    setGameStarted(false);
    setRefreshKey((k) => k + 1);
    // Menu music will start via the useEffect when gameStarted becomes false
  };

  const handleStartGame = () => {
    audioManager.playSFX("ui-click");
    setGameStarted(true);
  };

  const handleStartHover = () => {
    audioManager.playSFX("ui-hover");
  };

  if (gameStarted) {
    return <Game onReturnToMenu={handleReturnToMenu} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900/30 flex flex-col items-center p-6 overflow-hidden relative">
      <GameHeader />
      {currentGamePlayers > 0 && (
        <div className="fixed bottom-5 right-5 z-20 flex items-center gap-2 rounded-lg bg-black/70 px-3 py-2 border border-white/10">
          <span className="w-2 h-2 rounded-full bg-[#2ed573] shadow-[0_0_8px_#2ed573] animate-pulse" />
          <span className="text-sm text-white/80">
            {currentGamePlayers} playing
          </span>
        </div>
      )}

      {/* Light rays background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="absolute top-0 left-1/2 h-full w-24 bg-gradient-to-b from-amber-400/10 to-transparent"
            style={{
              transform: `translateX(-50%) rotate(${i * 45 - 180}deg)`,
              transformOrigin: "center top",
            }}
          />
        ))}
      </div>

      {/* Floating particles - only render on client to avoid hydration mismatch */}
      {isMounted && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 bg-amber-400/40 rounded-full animate-float"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 5}s`,
                animationDuration: `${5 + Math.random() * 5}s`,
              }}
            />
          ))}
        </div>
      )}

      <div className="relative z-10 max-w-2xl text-center pt-16">
        {/* Icon */}
        <div className="text-8xl mb-6">
          <span className="inline-block">🚀</span>
          <span className="inline-block">♿</span>
        </div>

        {/* Title */}
        <h1 className="text-5xl md:text-6xl font-bold mb-4 bg-gradient-to-r from-blue-200 via-blue-400 to-blue-200 bg-clip-text text-transparent">
          Rocket to Heaven
        </h1>
        <p className="text-xl text-blue-200/80 italic mb-2">
          From the Depths to the Heights
        </p>
        <a
          href="https://www.churchofjesuschrist.org/study/scriptures/ot/ps/130?lang=eng"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-200/50 hover:text-blue-200/70 mb-4 transition-colors no-underline inline-block"
        >
          Psalm 130
        </a>

        {personalBest !== null && (
          <div className="text-sm text-white/50 tracking-wide mb-6 flex items-center justify-center gap-2">
            Your Best:{" "}
            <span className="text-blue-400 font-bold text-base">
              {personalBest.toLocaleString()} ft
            </span>
          </div>
        )}

        {/* Description */}
        <div className="bg-black/30 backdrop-blur-sm rounded-2xl p-6 mb-8 border border-blue-200/20 text-left">
          <p className="text-white/80 leading-relaxed mb-4">
            A vertical climb where your burdens become your salvation. Use
            falling blocks of <strong className="text-red-400">Debt</strong>,
            <strong className="text-purple-400"> Grief</strong>, and
            <strong className="text-slate-300"> Fear</strong> as stepping stones
            to escape the rising lava of Despair.
          </p>
          <p className="text-blue-200/70 text-sm">
            Collect <strong className="text-amber-400">Grace</strong> orbs for
            double jumps. Reach 10,000 feet to enter Heaven.
          </p>
        </div>

        {/* Controls */}
        <div className="bg-black/20 rounded-xl p-4 mb-8 border border-white/10">
          <h3 className="text-blue-200/80 font-medium mb-3 uppercase tracking-wider text-sm">
            Controls
          </h3>
          {isMobile ? (
            <div className="grid grid-cols-2 gap-4 text-sm text-white/60">
              <div className="text-left">
                <div className="text-blue-300/80 font-medium">Left Side</div>
                <div>Joystick to move</div>
              </div>
              <div className="text-left">
                <div className="text-blue-300/80 font-medium">Right Side</div>
                <div>Tap to jump</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 text-sm text-white/60">
              <div className="text-left">
                <div className="text-blue-300/80 font-medium">Movement</div>
                <div>A / D or ← / →</div>
              </div>
              <div className="text-left">
                <div className="text-blue-300/80 font-medium">Jump</div>
                <div>Space or W</div>
              </div>
            </div>
          )}
        </div>

        {/* Start button */}
        <button
          onClick={handleStartGame}
          onMouseEnter={handleStartHover}
          className="w-full max-w-xs py-4 px-8 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold text-xl hover:from-blue-400 hover:to-blue-500 transition-all shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 hover:scale-105"
        >
          Begin Ascension
        </button>

        {/* Leaderboard */}
        <Leaderboard refreshKey={refreshKey} />

        {/* Inspiration credit */}
        <div className="mt-8 text-center">
          <a
            href="https://www.linkedin.com/in/james-wogan-%E2%9C%9D%EF%B8%8F%F0%9F%92%AA%F0%9F%8F%BB-25278652/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-blue-200/50 hover:text-blue-200/80 text-sm transition-colors no-underline"
          >
            Inspired by{" "}
            <span className="font-bold text-blue-400">James Wogan</span>
          </a>
        </div>
      </div>
    </div>
  );
}

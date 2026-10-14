"use client";

import { useEffect, useRef, useCallback } from "react";
import * as Phaser from "phaser";
import { GAME_CONFIG } from "../game/config";
import { MainScene } from "../game/scenes/MainScene";
import { HUD } from "./HUD";
import { PauseMenu } from "./PauseMenu";
import { DeathScreen } from "./DeathScreen";
import { VictoryScreen } from "./VictoryScreen";
import { Joystick } from "./Joystick";
import { JumpButton } from "./JumpButton";
import { useGameStore } from "../store/gameStore";
import { isMobileDevice } from "@/lib/utils/mobile-detector";
import { audioManager } from "../game/audio/AudioManager";
import { musicManager } from "@/lib/audio/MusicManager";
import { useGameSession } from "@/lib/supabase/hooks";

interface GameProps {
  onReturnToMenu: () => void;
}

export function Game({ onReturnToMenu }: GameProps) {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const showPauseMenu = useGameStore((state) => state.showPauseMenu);
  const isDead = useGameStore((state) => state.isDead);
  const hasWon = useGameStore((state) => state.hasWon);
  const togglePauseMenu = useGameStore((state) => state.togglePauseMenu);
  const maxHeight = useGameStore((state) => state.maxHeight);

  // Analytics tracking
  const { startSession, endSession } = useGameSession("rocket-to-heaven");
  const sessionStartedRef = useRef(false);

  // Get the MainScene from Phaser game
  const getMainScene = useCallback((): MainScene | null => {
    if (!gameRef.current) return null;
    return gameRef.current.scene.getScene("MainScene") as MainScene | null;
  }, []);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    // Start analytics session
    if (!sessionStartedRef.current) {
      sessionStartedRef.current = true;
      startSession();
    }

    // Create Phaser game instance
    gameRef.current = new Phaser.Game({
      ...GAME_CONFIG,
      parent: containerRef.current,
    });

    // Start gameplay music
    musicManager.play("/music/rocket-to-heaven/gameplay.mp3");

    // Handle window resize
    const handleResize = () => {
      if (gameRef.current) {
        gameRef.current.scale.resize(window.innerWidth, window.innerHeight);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
      // Music cleanup handled by page component
    };
  }, [startSession]);

  // Handle ESC key for pause menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        togglePauseMenu();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePauseMenu]);

  // Crossfade to death music when player dies
  useEffect(() => {
    if (isDead) {
      musicManager.play("/music/rocket-to-heaven/death.mp3");
    }
  }, [isDead]);

  // End session when player dies or wins
  useEffect(() => {
    if ((isDead || hasWon) && sessionStartedRef.current) {
      // Use maxHeight as the score (final altitude reached)
      // Rocket to Heaven doesn't have waves or levels, so pass 0 for those
      endSession(maxHeight, 0, 0);
      sessionStartedRef.current = false;
    }
  }, [isDead, hasWon, maxHeight, endSession]);

  // Handle return to menu - end session if still active
  const handleReturnToMenuWithSession = useCallback(() => {
    if (sessionStartedRef.current) {
      const currentMaxHeight = useGameStore.getState().maxHeight;
      endSession(currentMaxHeight, 0, 0);
      sessionStartedRef.current = false;
    }
    onReturnToMenu();
  }, [onReturnToMenu, endSession]);

  // Keep gameplay music playing even after reaching heaven (no victory music transition)
  // The gameplay music continues for both before and after heaven states

  const handleContinue = useCallback(() => {
    // Start a new session for the continued game
    if (!sessionStartedRef.current) {
      sessionStartedRef.current = true;
      startSession();
    }

    // Restart the game scene
    const scene = getMainScene();
    if (scene) {
      scene.scene.restart();
    } else if (gameRef.current) {
      // If scene doesn't exist, restart the whole game
      gameRef.current.destroy(true);
      gameRef.current = new Phaser.Game({
        ...GAME_CONFIG,
        parent: containerRef.current!,
      });
      musicManager.play("/music/rocket-to-heaven/gameplay.mp3");
    }
  }, [getMainScene, startSession]);

  const isMobile = isMobileDevice();

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      {/* Phaser game container */}
      <div
        ref={containerRef}
        id="game-container"
        className="w-full h-full [&_canvas]:block"
      />

      {/* React UI overlays */}
      <HUD />

      {showPauseMenu && <PauseMenu onQuit={handleReturnToMenuWithSession} />}

      {hasWon && (
        <VictoryScreen
          onReturnToMenu={handleReturnToMenuWithSession}
          onContinue={handleContinue}
        />
      )}

      {isDead && (
        <DeathScreen
          onReturnToMenu={handleReturnToMenuWithSession}
          maxHeight={maxHeight}
        />
      )}

      {/* Mobile controls */}
      {isMobile && (
        <>
          {!showPauseMenu && !isDead && !hasWon && (
            <button
              type="button"
              aria-label="Pause"
              onClick={() => {
                audioManager.playSFX("ui-click");
                togglePauseMenu();
              }}
              className="fixed left-1/2 z-30 -translate-x-1/2 rounded-full border border-white/20 bg-black/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white/80"
              style={{ top: "calc(11rem + env(safe-area-inset-top))" }}
            >
              Pause
            </button>
          )}
          <Joystick />
          <JumpButton />
        </>
      )}
    </div>
  );
}

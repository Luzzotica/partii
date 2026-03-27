"use client";

import { useEffect } from "react";
import { GameHeader } from "@/components/game/GameHeader";
import { usePresence, useGameSession } from "@/lib/supabase/hooks";

interface EmbeddedItchGameProps {
  gameId: string;
  title: string;
  embedSrc: string;
  itchPageUrl: string;
}

export function EmbeddedItchGame({
  gameId,
  title,
  embedSrc,
  itchPageUrl,
}: EmbeddedItchGameProps) {
  const { currentGamePlayers } = usePresence(gameId);
  const { startSession, endSession } = useGameSession(gameId);

  useEffect(() => {
    void startSession();
    return () => {
      void endSession(0, 0, 0);
    };
  }, [startSession, endSession]);

  return (
    <div className="min-h-screen bg-[#0a0a14] flex flex-col relative">
      <GameHeader />
      {currentGamePlayers > 0 && (
        <div className="fixed bottom-5 right-5 z-20 flex items-center gap-2 rounded-lg bg-black/70 px-3 py-2 border border-white/10">
          <span className="w-2 h-2 rounded-full bg-[#2ed573] shadow-[0_0_8px_#2ed573] animate-pulse" />
          <span className="text-sm text-white/80">
            {currentGamePlayers} playing
          </span>
        </div>
      )}

      <div className="flex flex-col flex-1 pt-20 px-4 pb-8">
        <h1 className="font-orbitron text-center text-xl md:text-2xl font-bold tracking-[4px] text-white/90 mb-6">
          {title}
        </h1>
        <div className="w-full max-w-[1280px] mx-auto flex flex-col gap-4 flex-1 min-h-0">
          <div className="relative w-full rounded-xl overflow-hidden border border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.5)] bg-black aspect-[1280/740] max-h-[min(78vh,calc(100vw*740/1280))]">
            <iframe
              title={title}
              src={embedSrc}
              className="absolute inset-0 w-full h-full border-0"
              allowFullScreen
            />
          </div>
          <p className="text-center">
            <a
              href={itchPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-orbitron text-sm text-white/50 hover:text-white/80 transition-colors"
            >
              Play on itch.io →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

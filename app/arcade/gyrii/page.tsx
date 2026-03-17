"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { DiscordLink } from "@/components/ui/DiscordLink";
import dynamic from "next/dynamic";
import { useGyriiStore } from "@/games/gyrii/store/gameStore";
import {
  activateGyriiConnection,
  deactivateGyriiConnection,
} from "@/games/gyrii/hooks/useGyriiConnection";
import { UserMenu } from "@/components/auth/UserMenu";
import { usePresence } from "@/lib/supabase/hooks";
import LobbyUI from "@/games/gyrii/components/LobbyUI";
import SpawnLoadoutScreen from "@/games/gyrii/components/SpawnLoadoutScreen";
import ConnectionIndicator from "@/games/gyrii/components/ConnectionIndicator";

// Dynamically import the game (Babylon) - only loads when user has joined a lobby
const GyriiGame = dynamic(() => import("@/games/gyrii/components/Game"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-screen bg-black">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-pink-500 mb-8">
          GYRII
        </h1>
        <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-cyan-400 text-xl font-bold">Loading game...</p>
        <p className="text-gray-400 mt-2">Preparing arena...</p>
      </div>
    </div>
  ),
});

const LoadingSpinner = () => (
  <div className="flex items-center justify-center w-full h-screen bg-black">
    <div className="text-center">
      <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
      <p className="text-cyan-400 text-xl font-bold">Initializing...</p>
    </div>
  </div>
);

export default function GyriiPage() {
  const [mounted, setMounted] = useState(false);
  const currentLobby = useGyriiStore((state) => state.currentLobby);
  const localPlayer = useGyriiStore((state) => state.localPlayer);
  const roundEndedBanner = useGyriiStore((state) => state.roundEndedBanner);
  const { currentGamePlayers } = usePresence("gyrii");

  useEffect(() => {
    setMounted(true);
  }, []);

  // Only connect while on the Gyrii page; disconnect when leaving
  useEffect(() => {
    activateGyriiConnection();
    return () => deactivateGyriiConnection();
  }, []);

  if (!mounted) {
    return <LoadingSpinner />;
  }

  // Top nav bar (same as Hexii): Back link, presence, UserMenu
  const TopNav = () => (
    <div className="absolute top-5 left-5 right-5 z-50 flex justify-between items-center">
      <Link
        href="/arcade"
        className="font-orbitron inline-block text-white/60 no-underline text-sm tracking-wider transition-colors hover:text-white/90"
      >
        ← Back to Arcade
      </Link>
      <div className="flex items-center gap-4">
        <DiscordLink />
        {currentGamePlayers > 0 && (
          <div className="font-orbitron flex items-center gap-2 text-xs text-white/60 tracking-wide">
            <span className="w-2 h-2 rounded-full bg-[#2ed573] shadow-[0_0_8px_#2ed573] animate-pulse" />
            {currentGamePlayers} playing
          </div>
        )}
        <UserMenu />
      </div>
    </div>
  );

  // Lobby UI first - no Babylon until user creates or joins a lobby
  if (!currentLobby) {
    return (
      <main className="relative w-full h-screen overflow-hidden bg-black">
        <TopNav />
        <LobbyUI />
        <ConnectionIndicator />
      </main>
    );
  }

  // In lobby: load Babylon scene immediately, overlay spawn UI when waiting to spawn
  // (same overlay appears after death - player sees fights/sounds while choosing loadout)
  return (
    <main className="relative w-full h-screen overflow-hidden bg-black">
      <Suspense fallback={<LoadingSpinner />}>
        <GyriiGame key={`${currentLobby.id}:${currentLobby.mapId}`} />
      </Suspense>
      {!roundEndedBanner &&
        currentLobby.gameState !== "ended" &&
        (!localPlayer || localPlayer.isAlive === false) && (
          <SpawnLoadoutScreen />
        )}
    </main>
  );
}

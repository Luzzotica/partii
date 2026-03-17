"use client";

import Link from "next/link";
import { UserMenu } from "@/components/auth/UserMenu";
import { DiscordLink } from "@/components/ui/DiscordLink";

interface GameHeaderProps {
  playerCount?: number;
  className?: string;
}

export function GameHeader({ playerCount, className = "" }: GameHeaderProps) {
  return (
    <div
      className={`absolute top-5 left-5 right-5 z-20 flex justify-between items-center ${className}`}
    >
      <Link
        href="/arcade"
        className="font-orbitron inline-block text-white/60 no-underline text-sm tracking-wider transition-colors hover:text-white/90"
      >
        ← Back to Arcade
      </Link>
      <div className="flex items-center gap-4">
        <DiscordLink />
        {playerCount !== undefined && playerCount > 0 && (
          <div className="font-orbitron flex items-center gap-2 text-xs text-white/60 tracking-wide">
            <span className="w-2 h-2 rounded-full bg-[#2ed573] shadow-[0_0_8px_#2ed573] animate-pulse" />
            {playerCount} playing
          </div>
        )}
        <UserMenu />
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { UserMenu } from "@/components/auth/UserMenu";
import { DiscordLink } from "@/components/ui/DiscordLink";
import { YouTubeLink } from "@/components/ui/YouTubeLink";

interface GameHeaderProps {
  className?: string;
}

export function GameHeader({ className = "" }: GameHeaderProps) {
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
        <YouTubeLink />
        <UserMenu />
      </div>
    </div>
  );
}

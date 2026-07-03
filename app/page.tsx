"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { UserMenu } from "@/components/auth/UserMenu";
import { DiscordLink } from "@/components/ui/DiscordLink";
import { YouTubeLink } from "@/components/ui/YouTubeLink";
import { usePresence } from "@/lib/supabase/hooks";

interface HexPosition {
  left: number;
  top: number;
}

export default function Home() {
  const [hexPositions, setHexPositions] = useState<HexPosition[]>([]);
  const { totalOnline } = usePresence();

  useEffect(() => {
    // Generate random positions only on client side
    setHexPositions(
      Array.from({ length: 20 }, () => ({
        left: Math.random() * 100,
        top: Math.random() * 100,
      })),
    );
  }, []);

  return (
    <div className="relative w-full min-h-screen flex justify-center items-center overflow-hidden bg-gradient-to-b from-[#0a0a14] via-[#1a1a2e] to-[#0a0a14]">
      {/* Header with auth */}
      <div className="absolute top-5 right-5 z-20 flex items-center gap-4">
        <DiscordLink />
        <YouTubeLink />
        <UserMenu />
      </div>

      {/* Background gradient overlays */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(55,66,250,0.15),transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_80%,rgba(255,71,87,0.1),transparent_50%)]" />

      <div className="relative z-10 text-center px-10 py-10 max-w-3xl">
        <h1 className="text-8xl font-black tracking-wider mb-12 pb-2 bg-gradient-to-r from-white via-[#a8a8ff] to-white bg-clip-text text-transparent drop-shadow-[0_0_40px_rgba(100,100,255,0.5)] leading-tight">
          Sterling Long
        </h1>

        <div className="mb-10">
          <p className="text-2xl text-white/80 tracking-wide mb-1">
            Learn more.
          </p>
          <p className="text-2xl text-white/80 tracking-wide mb-1">
            Scream more.
          </p>
          <p className="text-2xl text-white/80 tracking-wide">Live more.</p>
        </div>

        <p className="text-lg text-white/50 leading-relaxed mb-12 max-w-2xl mx-auto">
          Games that teach or get you screaming.
        </p>

        <div className="flex flex-col items-center gap-4">
          <Link
            href="/arcade"
            className="text-lg font-bold tracking-widest px-16 py-5 bg-gradient-to-r from-[#ff4757] to-[#ff6b81] rounded-lg text-white no-underline transition-all duration-300 inline-block shadow-[0_10px_40px_rgba(255,71,87,0.4)] hover:bg-gradient-to-r hover:from-[#ff6b81] hover:to-[#ff4757] hover:-translate-y-1 hover:shadow-[0_15px_50px_rgba(255,71,87,0.5)]"
          >
            Enter Arcade
          </Link>
          {totalOnline > 0 && (
            <div className="flex items-center gap-2 text-sm text-white/60">
              <span className="w-2 h-2 rounded-full bg-[#2ed573] shadow-[0_0_8px_#2ed573] animate-pulse" />
              {totalOnline} online
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-4 text-xs text-white/35">
        <Link href="/docs" className="hover:text-white/70 transition-colors">Docs</Link>
        <span aria-hidden>·</span>
        <Link href="/changelog" className="hover:text-white/70 transition-colors">Changelog</Link>
        <span aria-hidden>·</span>
        <Link href="/privacy" className="hover:text-white/70 transition-colors">Privacy</Link>
      </footer>

      {/* Floating hexagons */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {hexPositions.map((pos, i) => (
          <div
            key={i}
            className="absolute text-6xl text-white/[0.03] animate-[float_20s_ease-in-out_infinite]"
            style={{
              animationDelay: `${i * 0.2}s`,
              left: `${pos.left}%`,
              top: `${pos.top}%`,
            }}
          >
            ⬡
          </div>
        ))}
      </div>
    </div>
  );
}

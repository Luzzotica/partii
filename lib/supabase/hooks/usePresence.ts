"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "../client";
import { useAuth } from "../auth-context";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface PresenceState {
  user_id: string;
  game_id: string | null;
  online_at: string;
  user_name?: string;
}

interface PresenceData {
  totalOnline: number;
  playersInGame: Map<string, number>; // game_id -> count
  currentGamePlayers: number;
}

export function usePresence(gameId?: string) {
  const { user } = useAuth();
  const [presence, setPresence] = useState<PresenceData>({
    totalOnline: 0,
    playersInGame: new Map(),
    currentGamePlayers: 0,
  });
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabase = createClient();

  const updatePresence = useCallback(
    (presenceState: Record<string, PresenceState[]>) => {
      const allUsers = Object.values(presenceState).flat();
      const playersInGame = new Map<string, number>();

      allUsers.forEach((p) => {
        if (p.game_id) {
          playersInGame.set(p.game_id, (playersInGame.get(p.game_id) || 0) + 1);
        }
      });

      setPresence({
        totalOnline: allUsers.length,
        playersInGame,
        currentGamePlayers: gameId ? playersInGame.get(gameId) || 0 : 0,
      });
    },
    [gameId],
  );

  useEffect(() => {
    const channel = supabase.channel("online-users", {
      config: {
        presence: {
          key:
            user?.id ??
            `anon-${(Math.random() as number).toString(36).slice(2)}`,
        },
      },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceState>();
        updatePresence(state);
      })
      .on("presence", { event: "join" }, ({ newPresences }) => {
        console.log("User joined:", newPresences);
      })
      .on("presence", { event: "leave" }, ({ leftPresences }) => {
        console.log("User left:", leftPresences);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: user?.id || "anonymous",
            game_id: gameId || null,
            online_at: new Date().toISOString(),
            user_name:
              user?.user_metadata?.full_name || user?.email?.split("@")[0],
          });
        }
      });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [user, gameId, supabase, updatePresence]);

  const setCurrentGame = useCallback(
    async (newGameId: string | null) => {
      if (channelRef.current) {
        await channelRef.current.track({
          user_id: user?.id || "anonymous",
          game_id: newGameId,
          online_at: new Date().toISOString(),
          user_name:
            user?.user_metadata?.full_name || user?.email?.split("@")[0],
        });
      }
    },
    [user],
  );

  return {
    ...presence,
    setCurrentGame,
  };
}

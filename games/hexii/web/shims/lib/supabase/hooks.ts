import { useCallback, useRef } from "react";
import { BOARD, GAME, api, fetchBoard, partiiErrorMessage } from "../../../src/partii";
import { ensureGuest } from "../../../src/player";

export interface LeaderboardEntry {
  rank: number;
  display_name: string;
  best_score: number;
  best_wave: number;
  best_level: number;
  total_plays: number;
}

export interface PersonalBest {
  score: number;
  wave: number;
  level: number;
  play_time_seconds: number;
  achieved_at: string;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toEntry(entry: {
  rank: number;
  display_name: string;
  score: number;
  meta?: Record<string, unknown>;
}): LeaderboardEntry {
  const meta = entry.meta ?? {};
  return {
    rank: entry.rank,
    display_name: entry.display_name,
    best_score: entry.score,
    best_wave: num(meta.wave),
    best_level: num(meta.level),
    total_plays: 0,
  };
}

function toPersonalBest(
  me: { score: number; meta: Record<string, unknown>; achieved_at: number } | null,
): PersonalBest | null {
  if (!me) return null;
  return {
    score: me.score,
    wave: num(me.meta.wave),
    level: num(me.meta.level),
    play_time_seconds: num(me.meta.play_time_seconds),
    achieved_at: new Date(me.achieved_at).toISOString(),
  };
}

/** All-time score board. The menu has its own today / week / all-time tabs. */
export function useHighScores(_gameId: string) {
  const getLeaderboard = useCallback(async (limit = 10): Promise<LeaderboardEntry[]> => {
    try {
      const page = await fetchBoard("all", limit);
      return page.entries.map(toEntry);
    } catch {
      return [];
    }
  }, []);

  const readMe = useCallback(async () => {
    try {
      await ensureGuest();
      const page = await fetchBoard("all", 1);
      return page.me;
    } catch {
      return null;
    }
  }, []);

  const getPersonalBest = useCallback(async () => toPersonalBest(await readMe()), [readMe]);

  const getUserRank = useCallback(async () => (await readMe())?.rank ?? null, [readMe]);

  const getPersonalStats = useCallback(async () => null, []);

  const submitScore = useCallback(
    async (
      score: number,
      wave?: number,
      level?: number,
      playTimeSeconds?: number,
      _sessionId?: string,
    ) => {
      const points = Math.round(score);
      if (!Number.isFinite(points) || points <= 0) {
        return { success: false as const, error: "No score to save" };
      }
      try {
        await ensureGuest();
        await api.leaderboardSubmit(GAME, BOARD, {
          score: points,
          meta: {
            wave: Math.max(0, Math.round(wave ?? 0)),
            level: Math.max(0, Math.round(level ?? 0)),
            play_time_seconds: Math.max(0, Math.round(playTimeSeconds ?? 0)),
          },
        });
        return { success: true as const, error: null };
      } catch (err) {
        return { success: false as const, error: partiiErrorMessage(err) };
      }
    },
    [],
  );

  return {
    submitScore,
    getLeaderboard,
    getPersonalBest,
    getPersonalStats,
    getUserRank,
    loading: false,
    error: null as string | null,
  };
}

export function useGameSession(_gameId: string) {
  const startTimeRef = useRef<number | null>(null);

  const startSession = useCallback(async () => {
    startTimeRef.current = Date.now();
    return null;
  }, []);

  const endSession = useCallback(
    async (_finalScore: number, _finalWave: number, _finalLevel: number) => {},
    [],
  );

  const getPlayTimeSeconds = useCallback(() => {
    if (!startTimeRef.current) return 0;
    return Math.floor((Date.now() - startTimeRef.current) / 1000);
  }, []);

  return { startSession, endSession, getPlayTimeSeconds };
}

export function usePresence(_gameId?: string) {
  return {
    totalOnline: 0,
    playersInGame: new Map<string, number>(),
    currentGamePlayers: 0,
  };
}

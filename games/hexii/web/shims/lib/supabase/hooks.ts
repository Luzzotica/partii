import { useCallback, useRef } from "react";

/**
 * Score stub. The shared death and menu screens keep their leaderboard UI.
 * Rows stay empty until the partii leaderboards API is wired in.
 */

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

export function useHighScores(_gameId: string) {
  const getLeaderboard = useCallback(
    async (_limit = 10): Promise<LeaderboardEntry[]> => [],
    [],
  );

  const getPersonalBest = useCallback(
    async (): Promise<PersonalBest | null> => null,
    [],
  );
  const getUserRank = useCallback(async () => null, []);
  const getPersonalStats = useCallback(async () => null, []);

  const submitScore = useCallback(
    async (
      _score: number,
      _wave?: number,
      _level?: number,
      _playTimeSeconds?: number,
      _sessionId?: string,
    ) => ({ success: false as const, error: "Leaderboard is not connected yet" }),
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

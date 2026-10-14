import { useCallback } from "react";
import { useGameStore } from "../../../../store/gameStore";
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

function runMeta(playTimeSeconds?: number): Record<string, string | number | boolean> {
  const state = useGameStore.getState();
  const meta: Record<string, string | number | boolean> = {
    play_time_seconds: Math.max(0, Math.round(playTimeSeconds ?? state.playTimeSeconds)),
    reached_heaven: state.hasReachedHeaven,
  };
  if (state.hasWon && !state.isDead) meta.cause = "victory";
  else if (state.deathCause) meta.cause = state.deathCause;
  if (state.killerBlockLabel) meta.killer_block = state.killerBlockLabel;
  return meta;
}

function toEntry(entry: { rank: number; display_name: string; score: number }): LeaderboardEntry {
  return {
    rank: entry.rank,
    display_name: entry.display_name,
    best_score: entry.score,
    best_wave: 0,
    best_level: 0,
    total_plays: 0,
  };
}

function toPersonalBest(me: {
  score: number;
  meta: Record<string, unknown>;
  achieved_at: number;
} | null): PersonalBest | null {
  if (!me) return null;
  const seconds = me.meta.play_time_seconds;
  return {
    score: me.score,
    wave: 0,
    level: 0,
    play_time_seconds: typeof seconds === "number" ? seconds : 0,
    achieved_at: new Date(me.achieved_at).toISOString(),
  };
}

/** All-time altitude board. The menu has its own today / week / all-time tabs. */
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
      _wave?: number,
      _level?: number,
      playTimeSeconds?: number,
      _sessionId?: string,
    ) => {
      const feet = Math.round(score);
      if (!Number.isFinite(feet) || feet <= 0) {
        return { success: false as const, error: "No altitude to save" };
      }
      try {
        await ensureGuest();
        await api.leaderboardSubmit(GAME, BOARD, { score: feet, meta: runMeta(playTimeSeconds) });
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
  const startSession = useCallback(async () => null, []);
  const endSession = useCallback(
    async (_finalScore: number, _finalWave: number, _finalLevel: number) => {},
    [],
  );
  return { startSession, endSession };
}

export function usePresence(_gameId?: string) {
  return {
    totalOnline: 0,
    playersInGame: new Map<string, number>(),
    currentGamePlayers: 0,
  };
}

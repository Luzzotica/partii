import { createClient, PartiiError } from "../../../../platform/sdk/ts/src/client";

export type BoardPeriod = "daily" | "weekly" | "all";

export interface BoardEntry {
  rank: number;
  player_id: string;
  display_name: string;
  score: number;
  achieved_at: number;
}

export interface BoardMe {
  score: number;
  rank: number | null;
  meta: Record<string, unknown>;
  achieved_at: number;
  plays: number;
}

export interface BoardPage {
  entries: BoardEntry[];
  me: BoardMe | null;
  players: number;
  total_plays: number;
  resets_at: number | null;
}

export const GAME = "rocket-to-heaven";
export const BOARD = "altitude";

const DEVICE_KEY = "rocket-to-heaven.device";
const TOKEN_KEY = "rocket-to-heaven.token";

export const api = createClient({
  base: __PARTII_API__,
  key: __PARTII_KEY__,
});

export function deviceId(): string {
  const saved = localStorage.getItem(DEVICE_KEY);
  if (saved && /^[A-Za-z0-9_-]{8,80}$/.test(saved)) return saved;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(DEVICE_KEY, id);
  return id;
}

export function savedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function rememberToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  api.setPlayerToken(token);
}

export function forgetToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  api.setPlayerToken(undefined);
}

export function fetchBoard(period: BoardPeriod, limit: number): Promise<BoardPage> {
  return api.leaderboardGet(GAME, BOARD, { period, limit }) as Promise<BoardPage>;
}

export function partiiErrorMessage(err: unknown): string {
  if (err instanceof PartiiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

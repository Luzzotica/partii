// Leaderboards: a player submits a score once per run (player token); each
// board keeps the player's best for today, this week and all time (UTC;
// weeks start Monday). Anyone with the game's key reads the top N, plus
// their own best and rank when a player token comes along. Boards appear on
// first submit, higher-is-better; a developer can flip one to lower-is-better
// (race times) and remove a cheater's scores. A guest's scores merge into the
// account it signs in to; deleting a player deletes their scores.

import type { Env } from "../index";
import { allowed } from "../limits";
import { ApiError, bad, notFound, now, ownGame, type Caller } from "./core";
import type { Handlers } from "./index";
import { optionalPlayer } from "./ugc";

export const BOARD_LIMITS = { metaBytes: 1024, top: 100, keepPeriodDays: 60 };
const DAY_MS = 86_400_000;
const BOARD = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const PERIODS = { daily: "d", weekly: "w", all: "all" } as const;
type Period = keyof typeof PERIODS;

const dayOf = (t: number) => Math.floor(t / DAY_MS);
/** Day 0 (1970-01-01) was a Thursday; +3 puts week boundaries on Mondays. */
const weekOf = (t: number) => Math.floor((dayOf(t) + 3) / 7);

export function periodKey(p: Period, t = now()): string {
  return p === "all" ? "all" : p === "daily" ? `d${dayOf(t)}` : `w${weekOf(t)}`;
}

/** When the period ends (ms), for "resets in…" on screen. */
function periodEnds(p: Period, t = now()): number | null {
  if (p === "all") return null;
  if (p === "daily") return (dayOf(t) + 1) * DAY_MS;
  return ((weekOf(t) + 1) * 7 - 3) * DAY_MS;
}

function period(q: Record<string, string>): Period {
  const p = (q.period ?? "all") as Period;
  if (!(p in PERIODS)) throw bad("period must be daily, weekly or all");
  return p;
}

function board(name: string) {
  if (!BOARD.test(name)) throw bad("a board name is 1–40 chars of a-z, 0-9, _ and -, e.g. score or altitude");
  return name;
}

/** Flat metadata: short strings, numbers, bools. */
function cleanMeta(v: unknown): string {
  if (v === undefined || v === null) return "{}";
  if (typeof v !== "object" || Array.isArray(v)) throw bad("meta must be a flat object");
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) throw bad(`meta key ${JSON.stringify(k).slice(0, 50)} isn't a plain name`);
    const ok = (typeof x === "string" && x.length <= 200) || (typeof x === "number" && Number.isFinite(x)) || typeof x === "boolean";
    if (!ok) throw bad(`meta.${k} must be a short string, a number or a bool`);
  }
  const s = JSON.stringify(v);
  if (s.length > BOARD_LIMITS.metaBytes) throw bad(`meta is over ${BOARD_LIMITS.metaBytes} bytes`);
  return s;
}

async function keyGame(env: Env, caller: Caller, game: string) {
  const g = await env.DB.prepare("SELECT project_id FROM games WHERE id = ?").bind(game).first<{ project_id: string }>();
  if (!g || g.project_id !== caller.project) throw notFound(`game ${game}`, "use the publishable key of the game's project");
}

async function boardRow(env: Env, game: string, name: string) {
  return env.DB.prepare("SELECT * FROM leaderboards WHERE game_id = ? AND board = ?").bind(game, name).first<{ higher_is_better: number; plays: number; created_at: number }>();
}

/** 1 + how many players are ahead (a tie goes to whoever got there first). */
function rankSql(higher: boolean) {
  const cmp = higher ? ">" : "<";
  return `SELECT 1 + COUNT(*) AS rank FROM scores s JOIN players p ON p.id = s.player_id AND p.deleted_at IS NULL
    WHERE s.game_id = ? AND s.board = ? AND s.period = ? AND (s.score ${cmp} ? OR (s.score = ? AND s.achieved_at < ?))`;
}

interface ScoreRow {
  player_id: string;
  display_name: string;
  score: number;
  meta: string;
  achieved_at: number;
  plays: number;
}

async function mine(env: Env, game: string, name: string, key: string, player: string, higher: boolean) {
  const r = await env.DB.prepare("SELECT score, meta, achieved_at, plays FROM scores WHERE game_id = ? AND board = ? AND period = ? AND player_id = ?").bind(game, name, key, player).first<ScoreRow>();
  if (!r) return null;
  const rank = await env.DB.prepare(rankSql(higher)).bind(game, name, key, r.score, r.score, r.achieved_at).first<{ rank: number }>();
  return { score: r.score, rank: rank?.rank ?? null, meta: JSON.parse(r.meta), achieved_at: r.achieved_at, plays: r.plays };
}

/** A guest signing in to an account: its scores join the account's (the better of each). */
export async function mergeScores(env: Env, guest: string, into: string) {
  const rows = await env.DB.prepare(
    "SELECT s.*, COALESCE(l.higher_is_better, 1) AS higher FROM scores s LEFT JOIN leaderboards l ON l.game_id = s.game_id AND l.board = s.board WHERE s.player_id = ?",
  )
    .bind(guest)
    .all<ScoreRow & { game_id: string; board: string; period: string; higher: number }>();
  if (!rows.results.length) return;
  const stmts = rows.results.map((g) => {
    const better = g.higher === 1 ? "excluded.score > scores.score" : "excluded.score < scores.score";
    return env.DB.prepare(
      `INSERT INTO scores (game_id, board, period, player_id, score, meta, achieved_at, plays) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO UPDATE SET plays = scores.plays + excluded.plays,
         meta = CASE WHEN ${better} THEN excluded.meta ELSE scores.meta END,
         achieved_at = CASE WHEN ${better} THEN excluded.achieved_at ELSE scores.achieved_at END,
         score = CASE WHEN ${better} THEN excluded.score ELSE scores.score END`,
    ).bind(g.game_id, g.board, g.period, into, g.score, g.meta, g.achieved_at, g.plays);
  });
  stmts.push(env.DB.prepare("DELETE FROM scores WHERE player_id = ?").bind(guest));
  await env.DB.batch(stmts);
}

export async function deleteScoresOf(env: Env, player: string) {
  await env.DB.prepare("DELETE FROM scores WHERE player_id = ?").bind(player).run();
}

export const leaderboardHandlers: Handlers = {
  async leaderboardSubmit({ env, caller, params, body, dryRun }) {
    await keyGame(env, caller, params.game);
    const name = board(params.board);
    const player = caller.player!.id;
    if (typeof body.score !== "number" || !Number.isFinite(body.score) || Math.abs(body.score) > 1e15) throw bad("score must be a finite number");
    const meta = cleanMeta(body.meta);
    if (!(await allowed(env, "scores", `scores:${params.game}:${player}`))) throw new ApiError(429, "rate_limited", "too many scores from this player", "submit once per run");
    if (dryRun) return { dry_run: true };
    const t = now();
    const game = params.game;
    await env.DB.prepare("INSERT INTO leaderboards (game_id, board, higher_is_better, plays, created_at) VALUES (?, ?, 1, 1, ?) ON CONFLICT DO UPDATE SET plays = plays + 1")
      .bind(game, name, t)
      .run();
    const b = (await boardRow(env, game, name))!;
    const higher = b.higher_is_better === 1;
    const better = higher ? "excluded.score > scores.score" : "excluded.score < scores.score";
    const upsert = env.DB.prepare(
      `INSERT INTO scores (game_id, board, period, player_id, score, meta, achieved_at, plays) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT DO UPDATE SET plays = scores.plays + 1,
         meta = CASE WHEN ${better} THEN excluded.meta ELSE scores.meta END,
         achieved_at = CASE WHEN ${better} THEN excluded.achieved_at ELSE scores.achieved_at END,
         score = CASE WHEN ${better} THEN excluded.score ELSE scores.score END`,
    );
    const periods = Object.keys(PERIODS) as Period[];
    const before = await env.DB.prepare(`SELECT period, score FROM scores WHERE game_id = ? AND board = ? AND player_id = ? AND period IN (${periods.map(() => "?").join(",")})`)
      .bind(game, name, player, ...periods.map((p) => periodKey(p, t)))
      .all<{ period: string; score: number }>();
    const had = new Map(before.results.map((r) => [r.period, r.score]));
    const stmts = periods.map((p) => upsert.bind(game, name, periodKey(p, t), player, body.score, meta, t));
    // Now and then, drop old days and weeks.
    if (Math.random() < 0.02) {
      const old = t - BOARD_LIMITS.keepPeriodDays * DAY_MS;
      stmts.push(
        env.DB.prepare("DELETE FROM scores WHERE game_id = ? AND ((period LIKE 'd%' AND CAST(substr(period, 2) AS INTEGER) < ?) OR (period LIKE 'w%' AND CAST(substr(period, 2) AS INTEGER) < ?))").bind(game, dayOf(old), weekOf(old)),
      );
    }
    await env.DB.batch(stmts);
    const best: Record<string, unknown> = {};
    for (const p of periods) {
      const prev = had.get(periodKey(p, t));
      const improved = prev === undefined || (higher ? body.score > prev : body.score < prev);
      best[p] = { ...(await mine(env, game, name, periodKey(p, t), player, higher)), improved };
    }
    return { board: name, score: body.score, best };
  },

  async leaderboardGet({ env, req, caller, params, query }) {
    await keyGame(env, caller, params.game);
    const name = board(params.board);
    const p = period(query);
    const limit = query.limit ? Number(query.limit) : 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > BOARD_LIMITS.top) throw bad(`limit must be 1–${BOARD_LIMITS.top}`);
    const b = await boardRow(env, params.game, name);
    const higher = b ? b.higher_is_better === 1 : true;
    const key = periodKey(p);
    const r = await env.DB.prepare(
      `SELECT s.player_id, p.display_name, s.score, s.meta, s.achieved_at FROM scores s JOIN players p ON p.id = s.player_id AND p.deleted_at IS NULL
       WHERE s.game_id = ? AND s.board = ? AND s.period = ? ORDER BY s.score ${higher ? "DESC" : "ASC"}, s.achieved_at ASC LIMIT ?`,
    )
      .bind(params.game, name, key, limit)
      .all<ScoreRow>();
    const player = await optionalPlayer(env, req);
    const players = await env.DB.prepare("SELECT COUNT(*) AS n FROM scores WHERE game_id = ? AND board = ? AND period = ?").bind(params.game, name, key).first<{ n: number }>();
    return {
      board: name,
      period: p,
      higher_is_better: higher,
      resets_at: periodEnds(p),
      players: players?.n ?? 0,
      total_plays: b?.plays ?? 0,
      entries: r.results.map((x, i) => ({ rank: i + 1, player_id: x.player_id, display_name: x.display_name, score: x.score, meta: JSON.parse(x.meta), achieved_at: x.achieved_at })),
      me: player ? await mine(env, params.game, name, key, player, higher) : null,
    };
  },

  async leaderboardsList({ env, caller, params }) {
    await ownGame(env, caller, params.game);
    const r = await env.DB.prepare("SELECT board, higher_is_better, plays, created_at FROM leaderboards WHERE game_id = ? ORDER BY board").bind(params.game).all<{ board: string; higher_is_better: number; plays: number; created_at: number }>();
    return { boards: r.results.map((b) => ({ board: b.board, higher_is_better: b.higher_is_better === 1, plays: b.plays, created_at: b.created_at })) };
  },

  async leaderboardConfig({ env, caller, params, body, dryRun }) {
    await ownGame(env, caller, params.game);
    const name = board(params.board);
    if (typeof body.higher_is_better !== "boolean") throw bad("higher_is_better must be true or false", "false for times: the lowest wins");
    if (dryRun) return { dry_run: true };
    await env.DB.prepare("INSERT INTO leaderboards (game_id, board, higher_is_better, plays, created_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT DO UPDATE SET higher_is_better = excluded.higher_is_better")
      .bind(params.game, name, body.higher_is_better ? 1 : 0, now())
      .run();
    return { board: name, higher_is_better: body.higher_is_better, hint: "set this before players submit: kept bests were chosen the old way" };
  },

  async leaderboardRemovePlayer({ env, caller, params, dryRun }) {
    await ownGame(env, caller, params.game);
    const name = board(params.board);
    if (dryRun) return { dry_run: true };
    const r = await env.DB.prepare("DELETE FROM scores WHERE game_id = ? AND board = ? AND player_id = ?").bind(params.game, name, params.player).run();
    return { removed: r.meta.changes ?? 0 };
  },
};

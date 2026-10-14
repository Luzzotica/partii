-- Leaderboards (src/api/leaderboards.ts): each player's best score per board
-- and period. period is 'all', 'd<day>' (UTC day number) or 'w<week>' (weeks
-- starting Monday, UTC).
CREATE TABLE leaderboards (
  game_id TEXT NOT NULL,
  board TEXT NOT NULL,
  higher_is_better INTEGER NOT NULL DEFAULT 1,
  plays INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, board)
);

CREATE TABLE scores (
  game_id TEXT NOT NULL,
  board TEXT NOT NULL,
  period TEXT NOT NULL,
  player_id TEXT NOT NULL,
  score REAL NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  achieved_at INTEGER NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, board, period, player_id)
);
CREATE INDEX scores_rank ON scores(game_id, board, period, score, achieved_at);
CREATE INDEX scores_player ON scores(player_id);

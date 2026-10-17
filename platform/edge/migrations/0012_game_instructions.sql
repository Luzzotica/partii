-- How to install and play, per game and platform (src/api/instructions.ts).
-- Platforms without a row use partii's defaults.
CREATE TABLE game_instructions (
  game_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  markdown TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, platform)
);

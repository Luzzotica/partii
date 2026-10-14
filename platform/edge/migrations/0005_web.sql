-- Web hosting for games (src/api/web.ts): <game>.partii.games. Files live in
-- R2 by hash; a deploy's manifest (path -> hash) is web/<game>/deploys/<id>.json.
CREATE TABLE web_deploys (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  status TEXT NOT NULL,            -- uploading | ready
  files INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  options TEXT NOT NULL DEFAULT '{}',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  finished_at INTEGER
);
CREATE INDEX web_deploys_game ON web_deploys(game_id, created_at);

-- The live deploy per game.
CREATE TABLE web_sites (
  game_id TEXT PRIMARY KEY,
  deploy_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Blobs known to be stored, per game.
CREATE TABLE web_blobs (
  game_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, sha256)
);

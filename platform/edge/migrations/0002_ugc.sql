-- Player content (UGC): public levels, worlds and replays (src/api/ugc.ts).

-- Stored files, content addressed per game (R2 key ugc/<game>/<sha256>).
-- A row is written when an upload starts; hidden_at is set by moderation.
CREATE TABLE ugc_blobs (
  game_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  kind TEXT NOT NULL,              -- file | thumbnail
  size INTEGER NOT NULL,
  uploader_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  hidden_at INTEGER,
  PRIMARY KEY (game_id, sha256)
);
CREATE INDEX ugc_blobs_uploader ON ugc_blobs(uploader_id, created_at);

CREATE TABLE ugc_items (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- level | world | replay
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]', -- JSON array
  visibility TEXT NOT NULL,        -- public | unlisted
  share_code TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL,        -- the latest version
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  client_version TEXT NOT NULL,
  thumbnail_sha256 TEXT,
  up INTEGER NOT NULL DEFAULT 0,
  down INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  hidden_at INTEGER,
  hidden_reason TEXT,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ugc_items_new ON ugc_items(game_id, created_at);
CREATE INDEX ugc_items_top ON ugc_items(game_id, score, created_at);
CREATE INDEX ugc_items_played ON ugc_items(game_id, plays, created_at);
CREATE INDEX ugc_items_author ON ugc_items(author_id, game_id);

CREATE TABLE ugc_versions (
  item_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  author_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  client_version TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  refs TEXT NOT NULL DEFAULT '[]', -- JSON array of sha256 (what a World pins)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, version)
);
CREATE INDEX ugc_versions_sha ON ugc_versions(sha256);
CREATE INDEX ugc_versions_author ON ugc_versions(author_id, created_at);

CREATE TABLE ugc_votes (
  item_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  value INTEGER NOT NULL,          -- 1 | -1
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, player_id)
);
CREATE INDEX ugc_votes_player ON ugc_votes(player_id, updated_at);

-- One row per player per item: "plays" counts players, not launches.
CREATE TABLE ugc_plays (
  item_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, player_id)
);

CREATE TABLE ugc_reports (
  item_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  PRIMARY KEY (item_id, player_id)
);
CREATE INDEX ugc_reports_player ON ugc_reports(player_id, created_at);

-- Search over titles, descriptions and tags.
CREATE VIRTUAL TABLE ugc_search USING fts5(item_id UNINDEXED, title, description, tags);

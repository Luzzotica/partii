-- Patch notes (src/api/notes.ts): one markdown post per game version, shown
-- publicly on the store at /games/<game>/updates/<version>.
CREATE TABLE game_notes (
  game_id TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, version)
);
CREATE INDEX game_notes_recent ON game_notes (game_id, published_at DESC);

-- Steam keys (src/api/steamkeys.ts): a developer's pool of Steamworks keys per
-- game. A partii purchase (or grant/code) takes the next free key, so the buyer
-- can activate the game on Steam. Keys are AES-GCM encrypted with SECRETS_KEY;
-- key_hash (sha256 of the normalized key) dedupes uploads.
CREATE TABLE steam_keys (
  game_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_enc TEXT NOT NULL,
  iv TEXT NOT NULL,
  last5 TEXT NOT NULL,
  batch TEXT NOT NULL DEFAULT '',
  added_at INTEGER NOT NULL,
  player_id TEXT,
  source TEXT,
  ref TEXT,
  assigned_at INTEGER,
  revoked_at INTEGER,
  revoked_reason TEXT,
  PRIMARY KEY (game_id, key_hash)
);
CREATE INDEX steam_keys_free ON steam_keys (game_id, added_at) WHERE player_id IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX steam_keys_player ON steam_keys (game_id, player_id) WHERE player_id IS NOT NULL;
CREATE INDEX steam_keys_ref ON steam_keys (ref) WHERE ref IS NOT NULL;

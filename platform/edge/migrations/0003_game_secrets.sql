-- Per-game secrets and config (src/api/secrets.ts). Secret values are
-- AES-GCM encrypted with the platform's SECRETS_KEY, bound to game and name;
-- they are never returned by the API. Config values (secret = 0) are plain.
CREATE TABLE game_secrets (
  game_id TEXT NOT NULL,
  name TEXT NOT NULL,
  secret INTEGER NOT NULL,
  value TEXT NOT NULL,             -- base64 ciphertext (secret) or the value (config)
  iv TEXT,
  last4 TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (game_id, name)
);

-- "Sign in through Steam" (OpenID 2.0) logins in flight (src/api/steam.ts).
-- `id` travels in the browser URL; the game polls with a separate secret
-- whose hash is kept here.
CREATE TABLE steam_openid (
  id TEXT PRIMARY KEY,
  poll_hash TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  game_id TEXT,
  guest_id TEXT,
  steam_id TEXT,
  status TEXT NOT NULL,            -- pending | done | used
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX steam_openid_expiry ON steam_openid(expires_at);

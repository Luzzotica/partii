-- partii platform records (D1). The live path (sessions, rooms, relay) never
-- waits on these tables.

CREATE TABLE developers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE dev_tokens (
  id TEXT PRIMARY KEY,
  developer_id TEXT NOT NULL REFERENCES developers(id),
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  developer_id TEXT NOT NULL REFERENCES developers(id),
  name TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'free',
  created_at INTEGER NOT NULL
);

CREATE TABLE keys (
  project_id TEXT NOT NULL REFERENCES projects(id),
  key_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (project_id, key_id)
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  sale TEXT,
  demo TEXT,
  platforms TEXT NOT NULL DEFAULT '[]',
  store TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE builds (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  platform TEXT NOT NULL,
  version TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'stable',
  filename TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX builds_game ON builds(game_id, platform, channel, created_at);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  test_developer_id TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_player ON identities(player_id);

CREATE TABLE email_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE entitlements (
  player_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT 'full',
  source TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (player_id, game_id, sku)
);
CREATE INDEX entitlements_game ON entitlements(game_id);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  game_id TEXT NOT NULL,
  store TEXT NOT NULL,
  ref TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL,
  test INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX purchases_game ON purchases(game_id, created_at);

CREATE TABLE codes (
  code TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  redeemed_by TEXT,
  redeemed_at INTEGER
);
CREATE INDEX codes_game ON codes(game_id);

CREATE TABLE saves (
  player_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  rev INTEGER NOT NULL,
  size INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, game_id, slot)
);

CREATE TABLE content (
  game_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, channel)
);

CREATE TABLE timings (
  project_id TEXT NOT NULL,
  metrics TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX timings_project ON timings(project_id, created_at);

-- Analytics (src/api/analytics.ts): game events, sessions, active devices and
-- error groups. No IPs are stored; a device is the game's install id.
-- `day` is days since the Unix epoch (UTC).

-- Raw events, kept 90 days.
CREATE TABLE events (
  game_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  day INTEGER NOT NULL,
  name TEXT NOT NULL,
  device TEXT NOT NULL,
  player_id TEXT,
  session TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  build TEXT NOT NULL DEFAULT '',
  owned INTEGER,                   -- 1 full, 0 demo, NULL unknown
  props TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX events_game_name_day ON events(game_id, name, day);
CREATE INDEX events_game_at ON events(game_id, at);

-- Each device once, with the day it was first seen (new vs returning, retention).
CREATE TABLE analytics_devices (
  game_id TEXT NOT NULL,
  device TEXT NOT NULL,
  first_day INTEGER NOT NULL,
  last_day INTEGER NOT NULL,
  PRIMARY KEY (game_id, device)
);
CREATE INDEX analytics_devices_first ON analytics_devices(game_id, first_day);

-- A device active on a day (DAU/WAU/MAU), with what it ran that day.
CREATE TABLE analytics_active (
  game_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  device TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  owned INTEGER,
  country TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (game_id, day, device)
);
CREATE INDEX analytics_active_device ON analytics_active(game_id, device, day);

-- Sessions (one per launch): from their first event to session_end.
CREATE TABLE analytics_sessions (
  game_id TEXT NOT NULL,
  session TEXT NOT NULL,
  device TEXT NOT NULL,
  day INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  secs REAL,                       -- from session_end; else last_at - started_at
  platform TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  owned INTEGER,
  PRIMARY KEY (game_id, session)
);
CREATE INDEX analytics_sessions_day ON analytics_sessions(game_id, day);

-- Errors grouped by fingerprint.
CREATE TABLE error_groups (
  game_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  top_frame TEXT NOT NULL DEFAULT '',
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  count INTEGER NOT NULL,
  devices INTEGER NOT NULL DEFAULT 0,
  versions TEXT NOT NULL DEFAULT '[]',
  platforms TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',   -- open | fixed | ignored
  status_at INTEGER,
  PRIMARY KEY (game_id, fingerprint)
);
CREATE INDEX error_groups_seen ON error_groups(game_id, last_seen);

-- The latest few reports of each group.
CREATE TABLE error_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  at INTEGER NOT NULL,
  device TEXT NOT NULL,
  player_id TEXT,
  session TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  build TEXT NOT NULL DEFAULT '',
  backtrace TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX error_samples_group ON error_samples(game_id, fingerprint, id);

-- Distinct devices per group (the group's device count).
CREATE TABLE error_devices (
  game_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  device TEXT NOT NULL,
  PRIMARY KEY (game_id, fingerprint, device)
);

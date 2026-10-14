-- Deleting a player unlinks their statistics (players.ts playersDelete).
CREATE INDEX events_player ON events(player_id) WHERE player_id IS NOT NULL;
CREATE INDEX error_samples_player ON error_samples(player_id) WHERE player_id IS NOT NULL;

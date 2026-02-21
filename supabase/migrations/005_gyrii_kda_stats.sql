-- =============================================
-- GYRII KDA STATS
-- =============================================

CREATE TABLE IF NOT EXISTS public.game_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

INSERT INTO public.game_types (id, name)
VALUES ('gyrii', 'Gyrii')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.gyrii_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type_id TEXT NOT NULL REFERENCES public.game_types(id) ON DELETE RESTRICT,
  lobby_id BIGINT,
  map_id TEXT NOT NULL,
  game_mode TEXT NOT NULL,
  score_limit INTEGER,
  flag_limit INTEGER,
  started_at_ms BIGINT NOT NULL,
  ended_at_ms BIGINT NOT NULL,
  winner_team INTEGER,
  winning_player_identity TEXT,
  metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.gyrii_match_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.gyrii_matches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_identity TEXT NOT NULL,
  player_name TEXT NOT NULL,
  team INTEGER,
  kills INTEGER DEFAULT 0 NOT NULL,
  deaths INTEGER DEFAULT 0 NOT NULL,
  damage_dealt INTEGER DEFAULT 0 NOT NULL,
  damage_taken INTEGER DEFAULT 0 NOT NULL,
  assists INTEGER DEFAULT 0 NOT NULL,
  placement INTEGER,
  metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_gyrii_matches_game_type ON public.gyrii_matches(game_type_id);
CREATE INDEX idx_gyrii_matches_started_at_ms ON public.gyrii_matches(started_at_ms DESC);
CREATE INDEX idx_gyrii_matches_ended_at_ms ON public.gyrii_matches(ended_at_ms DESC);
CREATE INDEX idx_gyrii_matches_lobby_id ON public.gyrii_matches(lobby_id);

CREATE INDEX idx_gyrii_match_players_match_id ON public.gyrii_match_players(match_id);
CREATE INDEX idx_gyrii_match_players_user_id ON public.gyrii_match_players(user_id);
CREATE INDEX idx_gyrii_match_players_kda ON public.gyrii_match_players(kills DESC, deaths ASC);

ALTER TABLE public.gyrii_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gyrii_match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Game types are viewable by everyone"
  ON public.game_types FOR SELECT
  USING (true);

CREATE POLICY "Gyrii matches are viewable by everyone"
  ON public.gyrii_matches FOR SELECT
  USING (true);

CREATE POLICY "Gyrii match players are viewable by everyone"
  ON public.gyrii_match_players FOR SELECT
  USING (true);

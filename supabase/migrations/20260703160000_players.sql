-- =============================================
-- PLAYER IDENTITY
--
-- Persistent game-player accounts, per project — deliberately SEPARATE from
-- auth.users (that's the developer/member graph: projects, courses, billing).
-- A player is a master record; identities are provider logins linked to it
-- (PlayFab model): anon device, Steam, Game Center, Sign in with Apple,
-- Google, Discord. The same provider subject in two different projects is two
-- different players — hence project_id denormalized onto identities for the
-- uniqueness constraint.
-- =============================================

CREATE TABLE IF NOT EXISTS public.players (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  display_name TEXT,
  banned       BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_project ON public.players (project_id);

CREATE TABLE IF NOT EXISTS public.player_identities (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  project_id UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- 'anon' | 'steam' | 'gamecenter' | 'apple' | 'google' | 'discord' | 'dev'
  provider   TEXT        NOT NULL,
  -- Provider-stable subject: device uuid, steamid64, GC teamPlayerID,
  -- SIWA sub, Google sub, Discord snowflake.
  subject    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, provider, subject)
);

CREATE INDEX IF NOT EXISTS idx_player_identities_player ON public.player_identities (player_id);

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_identities ENABLE ROW LEVEL SECURITY;
-- No policies: service-role access only (the API routes).

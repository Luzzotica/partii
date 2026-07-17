-- =============================================
-- PLAYER PRESENCE (online / in-game)
--
-- Games heartbeat while a player is connected. Rows older than the stale
-- window are treated as offline. Studio and dashboards can subscribe to
-- postgres_changes for live counts; game clients poll GET /api/presence
-- (or heartbeat response) for totals.
-- =============================================

CREATE TABLE IF NOT EXISTS public.player_presence (
  project_id  UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  player_id   UUID        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  -- Freeform game / mode tag (same convention as feedback.game_id).
  game_id     TEXT,
  -- online  = app open / lobby
  -- playing = actively in a match or gameplay session
  status      TEXT        NOT NULL DEFAULT 'online'
                CHECK (status IN ('online', 'playing')),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_presence_project_seen
  ON public.player_presence (project_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_player_presence_project_game
  ON public.player_presence (project_id, game_id)
  WHERE game_id IS NOT NULL;

ALTER TABLE public.player_presence ENABLE ROW LEVEL SECURITY;

-- Studio owners can read presence for their projects (Realtime + dashboard).
CREATE POLICY "Owners can read project presence"
  ON public.player_presence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = player_presence.project_id
        AND p.user_id = auth.uid()
    )
  );

-- All writes go through the service-role API (no client INSERT/UPDATE/DELETE).

-- Live counts for the developer dashboard.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.player_presence;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

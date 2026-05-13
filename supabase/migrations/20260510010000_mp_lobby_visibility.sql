-- Add a public/private visibility flag to mp_lobbies. Defaults to 'private'
-- so existing creation paths don't accidentally publish lobbies.
ALTER TABLE public.mp_lobbies
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('public', 'private'));

CREATE INDEX IF NOT EXISTS idx_mp_lobbies_public_listing
  ON public.mp_lobbies (game_id, visibility, status, created_at DESC);

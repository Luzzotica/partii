-- =============================================
-- PLAYER CONTENT — save/share replays, levels, saves.
--
-- Owned by PLAYERS (not developers — the old game_content table keyed to
-- profiles is deprecated). Stored in the private 'player-content' bucket;
-- all access mediated by the API (signed URLs for big blobs, proxy for small
-- JSON). Sharing: visibility public|unlisted + an 8-char share_code.
-- =============================================

CREATE TABLE IF NOT EXISTS public.player_content (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_player_id UUID        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  -- Optional customer-side namespace (multi-game projects).
  game_id         TEXT,
  -- 'level' | 'replay' | 'save' | free-form
  content_type    TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  description     TEXT,
  visibility      TEXT        NOT NULL DEFAULT 'private'
                              CHECK (visibility IN ('private', 'unlisted', 'public')),
  share_code      TEXT        UNIQUE,
  -- 'pending' = upload-url minted, awaiting finalize; excluded from listings.
  status          TEXT        NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'ready')),
  size_bytes      BIGINT      NOT NULL DEFAULT 0,
  content_mime    TEXT        NOT NULL DEFAULT 'application/json',
  storage_path    TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_content_browse
  ON public.player_content (project_id, visibility, content_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_content_owner
  ON public.player_content (owner_player_id, created_at DESC);

ALTER TABLE public.player_content ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only (the API routes).

-- Private bucket: 10 MB per object, any content type (replays can be binary).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('player-content', 'player-content', false, 10485760, NULL)
ON CONFLICT (id) DO NOTHING;

-- Per-plan content quotas (materialized on plan change like the other caps).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS max_content_items  INTEGER NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS max_storage_bytes  BIGINT  NOT NULL DEFAULT 104857600; -- 100 MB free

COMMENT ON COLUMN public.projects.max_storage_bytes IS
  'Total player-content bytes allowed (pending declared sizes count too, so '
  'unfinalized uploads can''t be used to reserve unbounded space).';

-- =============================================
-- GENERIC GAME CONTENT
-- =============================================
-- A game-agnostic content storage system for user-generated content
-- (levels, maps, configs, etc.) across any game on the platform.
-- All reads/writes go through API routes using the admin client.

CREATE TABLE IF NOT EXISTS public.game_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'level',
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  storage_path TEXT NOT NULL,
  is_public BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_game_content_creator ON public.game_content(creator_id);
CREATE INDEX idx_game_content_game_public ON public.game_content(game_id, is_public) WHERE is_public = TRUE;

ALTER TABLE public.game_content ENABLE ROW LEVEL SECURITY;

-- No permissive policies: direct client access denied. API uses admin client.

-- Storage bucket for content JSON files (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'game-content',
  'game-content',
  false,
  524288,  -- 512 KB max per file
  ARRAY['application/json']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- No storage policies: direct client access denied. API uses admin client.

CREATE TRIGGER set_game_content_updated_at
  BEFORE UPDATE ON public.game_content
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

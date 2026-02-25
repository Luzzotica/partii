-- =============================================
-- GYRII CUSTOM MAPS
-- =============================================
-- Maps table and storage bucket for player-created maps.
-- Data is locked: RLS denies all direct client access.
-- All reads/writes go through API routes using the admin client.

CREATE TABLE IF NOT EXISTS public.gyrii_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  storage_path TEXT NOT NULL,
  is_public BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_gyrii_maps_creator ON public.gyrii_maps(creator_id);
CREATE INDEX idx_gyrii_maps_is_public ON public.gyrii_maps(is_public) WHERE is_public = TRUE;

ALTER TABLE public.gyrii_maps ENABLE ROW LEVEL SECURITY;

-- No permissive policies: direct client access denied. API uses admin client.

-- Storage bucket for map JSON files (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gyrii-maps',
  'gyrii-maps',
  false,
  524288,  -- 512 KB max per file
  ARRAY['application/json']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- No storage policies: direct client access denied. API uses admin client.

CREATE TRIGGER set_gyrii_maps_updated_at
  BEFORE UPDATE ON public.gyrii_maps
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

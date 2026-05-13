-- =============================================
-- COVER IMAGES — add to offers, create public storage bucket
-- =============================================

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('cover-images', 'cover-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Anyone can read (it's a public bucket); only service-role writes via the
-- admin upload API. No additional storage RLS policies needed for reads since
-- public buckets are world-readable; writes from anon/auth are blocked by
-- default unless explicit INSERT policies exist.

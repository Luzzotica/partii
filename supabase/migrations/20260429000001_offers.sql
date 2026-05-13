-- =============================================
-- OFFERS — separate priced products from courses
-- =============================================
-- An "offer" is the thing money is charged for. An offer can grant access to
-- zero or more courses via offer_courses. Stripe Product + Price IDs are
-- managed automatically by the API layer (see lib/stripe/syncOffer.ts).
-- Courses no longer carry pricing; they're pure content.

ALTER TABLE public.courses DROP COLUMN IF EXISTS stripe_price_id;

CREATE TABLE IF NOT EXISTS public.offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offers_published
  ON public.offers(is_published) WHERE is_published = TRUE;

CREATE TRIGGER set_offers_updated_at
  BEFORE UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.offer_courses (
  offer_id UUID NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (offer_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_offer_courses_course ON public.offer_courses(course_id);

-- Track which offer (if any) drove an enrollment, for analytics + revoke flows
ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS offer_id UUID REFERENCES public.offers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_enrollments_offer ON public.enrollments(offer_id) WHERE offer_id IS NOT NULL;

-- =============================================
-- RLS
-- =============================================
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "offers_select_published" ON public.offers FOR SELECT
  USING (is_published OR public.is_admin());

CREATE POLICY "offer_courses_select_visible" ON public.offer_courses FOR SELECT
  USING (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.offers o WHERE o.id = offer_courses.offer_id AND o.is_published)
  );

-- All writes via service-role admin client; no permissive write policies.

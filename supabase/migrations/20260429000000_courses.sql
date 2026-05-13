-- =============================================
-- MEMBER AREA / COURSES
-- =============================================
-- Course delivery: courses → modules → lessons (Tiptap content + Mux video).
-- Enrollments grant access (manual / stripe / free / coupon). Per-user
-- progress tracked at the lesson level (manual completion + Mux watch %).
-- All admin writes go through the service-role admin client; client-side
-- code is constrained by the RLS policies below.

-- ---------- profiles.is_admin ----------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_is_admin
  ON public.profiles(is_admin) WHERE is_admin = TRUE;

-- Helper: is the current auth.uid() an admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    FALSE
  );
$$;

-- ---------- courses ----------
CREATE TABLE IF NOT EXISTS public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  cover_image_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  is_free BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_price_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_courses_published
  ON public.courses(is_published) WHERE is_published = TRUE;

CREATE TRIGGER set_courses_updated_at
  BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------- modules ----------
CREATE TABLE IF NOT EXISTS public.modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (course_id, position)
);

CREATE INDEX IF NOT EXISTS idx_modules_course ON public.modules(course_id, position);

CREATE TRIGGER set_modules_updated_at
  BEFORE UPDATE ON public.modules
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------- lessons ----------
CREATE TABLE IF NOT EXISTS public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- Tiptap document
  mux_asset_id TEXT,
  mux_playback_id TEXT,
  mux_upload_id TEXT,
  video_duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (module_id, position)
);

CREATE INDEX IF NOT EXISTS idx_lessons_module ON public.lessons(module_id, position);
CREATE INDEX IF NOT EXISTS idx_lessons_mux_upload ON public.lessons(mux_upload_id) WHERE mux_upload_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lessons_mux_asset  ON public.lessons(mux_asset_id)  WHERE mux_asset_id  IS NOT NULL;

CREATE TRIGGER set_lessons_updated_at
  BEFORE UPDATE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------- enrollments ----------
CREATE TABLE IF NOT EXISTS public.enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('manual','stripe','free','coupon')),
  granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  stripe_checkout_id TEXT,
  coupon_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_user   ON public.enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON public.enrollments(course_id);

-- ---------- lesson_progress ----------
CREATE TABLE IF NOT EXISTS public.lesson_progress (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  watch_seconds INTEGER NOT NULL DEFAULT 0,
  watch_percent INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_course ON public.lesson_progress(user_id, course_id);

CREATE TRIGGER set_lesson_progress_updated_at
  BEFORE UPDATE ON public.lesson_progress
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------- coupons ----------
CREATE TABLE IF NOT EXISTS public.coupons (
  code TEXT PRIMARY KEY,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
  max_redemptions INTEGER,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- email_log ----------
CREATE TABLE IF NOT EXISTS public.email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,         -- 'access_granted' | 'broadcast' | ...
  subject TEXT NOT NULL,
  to_email TEXT NOT NULL,
  status TEXT NOT NULL,       -- 'sent' | 'failed'
  resend_id TEXT,
  error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_log_user   ON public.email_log(user_id);
CREATE INDEX IF NOT EXISTS idx_email_log_course ON public.email_log(course_id);

-- =============================================
-- RLS
-- =============================================
ALTER TABLE public.courses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_log      ENABLE ROW LEVEL SECURITY;

-- courses: published OR enrolled OR admin can read; only admin writes
CREATE POLICY "courses_select_visible" ON public.courses FOR SELECT
  USING (
    is_published
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.course_id = courses.id AND e.user_id = auth.uid()
    )
  );

-- modules / lessons: visible if parent course is visible to the user
CREATE POLICY "modules_select_visible" ON public.modules FOR SELECT
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = modules.course_id
        AND (
          c.is_published
          OR EXISTS (
            SELECT 1 FROM public.enrollments e
            WHERE e.course_id = c.id AND e.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "lessons_select_visible" ON public.lessons FOR SELECT
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.modules m
      JOIN public.courses c ON c.id = m.course_id
      WHERE m.id = lessons.module_id
        AND (
          c.is_published
          OR EXISTS (
            SELECT 1 FROM public.enrollments e
            WHERE e.course_id = c.id AND e.user_id = auth.uid()
          )
        )
    )
  );

-- enrollments: user reads own; admin reads all. Writes are admin-only via API.
CREATE POLICY "enrollments_select_own" ON public.enrollments FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

-- lesson_progress: user reads/writes own row; admin reads all
CREATE POLICY "lesson_progress_select_own" ON public.lesson_progress FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "lesson_progress_insert_own" ON public.lesson_progress FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.user_id = auth.uid() AND e.course_id = lesson_progress.course_id
    )
  );

CREATE POLICY "lesson_progress_update_own" ON public.lesson_progress FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- coupons + email_log: admin-only. (No permissive policies = denied to clients;
-- API uses the service-role admin client.)

-- All write paths to courses/modules/lessons/enrollments/coupons/email_log go
-- through API routes using the service-role admin client, so no INSERT/UPDATE/
-- DELETE policies are needed for those tables.

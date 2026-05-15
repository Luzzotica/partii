-- =============================================
-- PROJECTS
-- Replaces the standalone `developers` auth system with
-- arcade Supabase auth. API keys now belong to projects,
-- and projects belong directly to auth.users.
-- =============================================

-- ─────────────────────────────────────────────
-- projects
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects (user_id);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- api_keys: add project_id, backfill, drop developer_id
-- ─────────────────────────────────────────────
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

-- Backfill: for each existing api_key, look up its developer's email in
-- auth.users. If the user exists, create a "default" project for them and
-- point the key at it. Otherwise drop the orphaned key.
DO $$
DECLARE
  k RECORD;
  matched_user UUID;
  new_project UUID;
BEGIN
  FOR k IN
    SELECT ak.id AS api_key_id, d.email AS dev_email
      FROM public.api_keys ak
      JOIN public.developers d ON d.id = ak.developer_id
     WHERE ak.project_id IS NULL
  LOOP
    SELECT id INTO matched_user FROM auth.users WHERE email = k.dev_email LIMIT 1;
    IF matched_user IS NULL THEN
      DELETE FROM public.api_keys WHERE id = k.api_key_id;
      CONTINUE;
    END IF;

    SELECT id INTO new_project
      FROM public.projects
     WHERE user_id = matched_user AND slug = 'default'
     LIMIT 1;

    IF new_project IS NULL THEN
      INSERT INTO public.projects (user_id, name, slug)
        VALUES (matched_user, 'Default', 'default')
        RETURNING id INTO new_project;
    END IF;

    UPDATE public.api_keys SET project_id = new_project WHERE id = k.api_key_id;
  END LOOP;
END $$;

-- Any keys we couldn't map are gone; enforce NOT NULL going forward.
ALTER TABLE public.api_keys
  ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE public.api_keys
  DROP COLUMN IF EXISTS developer_id;

CREATE INDEX IF NOT EXISTS idx_api_keys_project_id ON public.api_keys (project_id);

-- ─────────────────────────────────────────────
-- Drop the legacy developer auth system.
-- ─────────────────────────────────────────────
DROP TABLE IF EXISTS public.developer_games;
DROP TABLE IF EXISTS public.developer_sessions;
DROP TABLE IF EXISTS public.developers;

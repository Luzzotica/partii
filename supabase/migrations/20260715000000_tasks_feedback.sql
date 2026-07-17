-- =============================================
-- TASKS, MILESTONES & PLAYER FEEDBACK
--
-- Per-project (per-game) task manager for the developer dashboard, plus
-- player-submitted feedback from inside games. Tasks with milestone_id NULL
-- form the Inbox. Feedback rows carry a 1-5 star rating (analytics) and/or
-- freeform text (inbox candidates); converting feedback to a task is an
-- explicit developer action — anonymous players never write tasks directly.
-- Triage state lives on feedback.status; a task only exists once triaged.
-- =============================================

CREATE TABLE IF NOT EXISTS public.milestones (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  target_date DATE,
  state       TEXT        NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'done', 'archived')),
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestones_project ON public.milestones (project_id, sort_order);

CREATE TABLE IF NOT EXISTS public.feedback (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Freeform game identifier, same convention as game_sessions.game_id.
  game_id    TEXT,
  player_id  UUID        REFERENCES public.players(id) ON DELETE SET NULL,
  rating     SMALLINT    CHECK (rating BETWEEN 1 AND 5),
  text       TEXT,
  -- Where in the game: route/level/area tag supplied by the game client.
  context    TEXT,
  match_id   TEXT,
  status     TEXT        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'dismissed', 'converted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (rating IS NOT NULL OR text IS NOT NULL)
);

-- Inbox queue: only text feedback is triageable.
CREATE INDEX IF NOT EXISTS idx_feedback_inbox ON public.feedback (project_id, created_at DESC) WHERE text IS NOT NULL;
-- Ratings analytics: per game over time.
CREATE INDEX IF NOT EXISTS idx_feedback_ratings ON public.feedback (project_id, game_id, created_at) WHERE rating IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tasks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- NULL milestone = Inbox.
  milestone_id UUID        REFERENCES public.milestones(id) ON DELETE SET NULL,
  title        TEXT        NOT NULL,
  description  TEXT,
  -- Freeform route/level/area tag.
  context      TEXT,
  status       TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  source       TEXT        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'feedback')),
  feedback_id  UUID        REFERENCES public.feedback(id) ON DELETE SET NULL,
  sort_order   INT         NOT NULL DEFAULT 0,
  done_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_board ON public.tasks (project_id, status, milestone_id, sort_order);

ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
-- No policies: service-role access only (the API routes).

-- =============================================
-- PLAYER ROLES + IN-GAME TASK REPORTS
--
-- players.role: per-project player roles ('player' default, 'admin'). Admins
-- see dev functionality inside the prod game builds — e.g. the ⌥D debug
-- reporter that files tasks (with a screenshot) straight into the project's
-- task inbox. Server-enforced: /api/tasks/report checks role='admin'.
-- Roles are granted from the developer dashboard (PlayersPanel).
--
-- tasks.screenshot_path: private-bucket object attached to a task by the
-- debug reporter. tasks.source gains 'debug' for those rows.
-- =============================================

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player';
ALTER TABLE public.players DROP CONSTRAINT IF EXISTS players_role_check;
ALTER TABLE public.players
  ADD CONSTRAINT players_role_check CHECK (role IN ('player', 'admin'));

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS screenshot_path TEXT;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_source_check CHECK (source IN ('manual', 'feedback', 'debug'));

-- Private bucket for debug-report screenshots: 5 MB per object, images only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('task-screenshots', 'task-screenshots', false, 5242880, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

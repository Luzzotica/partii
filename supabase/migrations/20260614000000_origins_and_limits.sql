-- =============================================
-- ORIGINS & LIMITS
-- Hardening for the signalling API. Two independent defences live on the
-- project row so they apply to every API key the project owns:
--
--   1. allowed_origins — per-project browser Origin allowlist. The token
--      exchange (/api/auth/token) rejects a browser request whose Origin
--      isn't listed. Empty array = no origin restriction (native-only
--      projects that authenticate via platform attestation instead).
--
--   2. quota columns — damage caps so a leaked key can't run up the bill.
--      Enforced in the room-create / signal-post paths (429 on exceed).
--      NULL or 0 on any column = "use the server default" / unlimited; we
--      seed conservative non-null defaults below.
-- =============================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS allowed_origins      TEXT[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS max_rooms_per_hour   INTEGER  NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS max_concurrent_rooms INTEGER  NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS max_signals_per_min  INTEGER  NOT NULL DEFAULT 600;

COMMENT ON COLUMN public.projects.allowed_origins IS
  'Browser Origins (scheme://host[:port]) allowed to exchange this project''s '
  'API key for a session token. Supports a leading-wildcard host like '
  'https://*.sterlinglong.me. Empty = no Origin restriction.';
COMMENT ON COLUMN public.projects.max_rooms_per_hour IS
  'Rolling 1h cap on room.create events for this project. 0 = unlimited.';
COMMENT ON COLUMN public.projects.max_concurrent_rooms IS
  'Cap on simultaneously-active (non-ended) rooms for this project. 0 = unlimited.';
COMMENT ON COLUMN public.projects.max_signals_per_min IS
  'Rolling 1min cap on room.signal.post events for this project. 0 = unlimited.';

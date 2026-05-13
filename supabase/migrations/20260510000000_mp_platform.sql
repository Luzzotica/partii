-- =============================================
-- MULTIPLAYER PLATFORM
-- Developer accounts, API keys, usage metering,
-- and screen↔screen multiplayer lobbies layered
-- on top of the existing party_sessions tier.
-- =============================================

-- ─────────────────────────────────────────────
-- developers
-- Account that owns api_keys and developer_games.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.developers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  -- PBKDF2-SHA256 hash + salt encoded as "salt:hash" base64.
  password_hash TEXT        NOT NULL,
  display_name  TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.developers ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- developer_sessions
-- Cookie-bound login sessions for the developer dashboard.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.developer_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id  UUID        NOT NULL REFERENCES public.developers(id) ON DELETE CASCADE,
  token_hash    TEXT        NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX idx_developer_sessions_expires_at
  ON public.developer_sessions (expires_at);

ALTER TABLE public.developer_sessions ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- api_keys
-- Caller credential. The full secret is shown once at creation.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_keys (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id  UUID        NOT NULL REFERENCES public.developers(id) ON DELETE CASCADE,
  -- Public prefix shown in the dashboard, e.g. "mpk_live_abcd1234".
  key_prefix    TEXT        NOT NULL,
  -- sha256 hex of the full secret.
  key_hash      TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_developer_id ON public.api_keys (developer_id);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- developer_games
-- A logical "game" identifier owned by a developer.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.developer_games (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id  UUID        NOT NULL REFERENCES public.developers(id) ON DELETE CASCADE,
  game_id       TEXT        NOT NULL,
  display_name  TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (developer_id, game_id)
);

ALTER TABLE public.developer_games ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- usage_events
-- Per-API-key event log for metering / future billing.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage_events (
  id          BIGSERIAL   PRIMARY KEY,
  api_key_id  UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL,
  session_id  UUID,
  lobby_id    UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_events_key_time
  ON public.usage_events (api_key_id, created_at DESC);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- Link existing party_sessions to the api_key that created them.
-- Nullable so legacy rows survive; new sessions must populate it.
-- ─────────────────────────────────────────────
ALTER TABLE public.party_sessions
  ADD COLUMN IF NOT EXISTS api_key_id UUID REFERENCES public.api_keys(id);

CREATE INDEX IF NOT EXISTS idx_party_sessions_api_key_id
  ON public.party_sessions (api_key_id);

-- ─────────────────────────────────────────────
-- mp_lobbies
-- A multiplayer match across multiple "screens" (each screen is a party_session).
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mp_lobbies (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  join_code                TEXT        NOT NULL,
  host_secret              TEXT        NOT NULL,
  host_screen_session_id   UUID        NOT NULL REFERENCES public.party_sessions(id) ON DELETE CASCADE,
  api_key_id               UUID        NOT NULL REFERENCES public.api_keys(id),
  game_id                  TEXT        NOT NULL,
  display_name             TEXT        NOT NULL DEFAULT '',
  -- PBKDF2 "salt:hash" base64 string. NULL = no password.
  password_hash            TEXT,
  is_password_protected    BOOLEAN     GENERATED ALWAYS AS (password_hash IS NOT NULL) STORED,
  max_screens              SMALLINT    NOT NULL DEFAULT 4,
  status                   TEXT        NOT NULL DEFAULT 'waiting'
                                       CHECK (status IN ('waiting', 'active', 'ended')),
  metadata                 JSONB       NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at                 TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours')
);

CREATE UNIQUE INDEX idx_mp_lobbies_join_code_active
  ON public.mp_lobbies (join_code)
  WHERE status <> 'ended';

CREATE INDEX idx_mp_lobbies_game_status
  ON public.mp_lobbies (api_key_id, game_id, status);

CREATE INDEX idx_mp_lobbies_expires_at
  ON public.mp_lobbies (expires_at);

ALTER TABLE public.mp_lobbies ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- mp_lobby_screens
-- A screen (an entire party_session) participating in an mp_lobby.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mp_lobby_screens (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id           UUID        NOT NULL REFERENCES public.mp_lobbies(id) ON DELETE CASCADE,
  party_session_id   UUID        NOT NULL UNIQUE REFERENCES public.party_sessions(id) ON DELETE CASCADE,
  screen_secret      TEXT        NOT NULL,
  display_name       TEXT        NOT NULL DEFAULT 'Screen',
  slot               SMALLINT    NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'joined'
                                  CHECK (status IN ('joined', 'connected', 'disconnected')),
  is_host            BOOLEAN     NOT NULL DEFAULT FALSE,
  joined_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mp_lobby_screens_lobby ON public.mp_lobby_screens (lobby_id);

ALTER TABLE public.mp_lobby_screens ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- mp_signaling
-- WebRTC signaling between screens within a lobby.
-- Same shape and TTL as party_signaling.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mp_signaling (
  id            BIGSERIAL   PRIMARY KEY,
  lobby_id      UUID        NOT NULL REFERENCES public.mp_lobbies(id) ON DELETE CASCADE,
  -- "host" or an mp_lobby_screens.id UUID string
  sender_id     TEXT        NOT NULL,
  recipient_id  TEXT        NOT NULL,
  signal_type   TEXT        NOT NULL
                            CHECK (signal_type IN ('offer', 'answer', 'ice_candidate')),
  payload       JSONB       NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mp_signaling_recipient_cursor
  ON public.mp_signaling (lobby_id, recipient_id, id);

CREATE INDEX idx_mp_signaling_created_at
  ON public.mp_signaling (created_at);

ALTER TABLE public.mp_signaling ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- mp_join_lobby()
-- Atomic slot assignment for concurrent screen joins.
-- Password verification is done in the API layer (PBKDF2 in app code).
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_join_lobby(
  p_lobby_id          UUID,
  p_party_session_id  UUID,
  p_display_name      TEXT,
  p_screen_secret     TEXT
)
RETURNS TABLE (screen_id UUID, screen_slot SMALLINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slot   SMALLINT;
  v_id     UUID;
  v_max    SMALLINT;
  v_count  INT;
BEGIN
  SELECT max_screens INTO v_max
  FROM public.mp_lobbies
  WHERE id = p_lobby_id
    AND status IN ('waiting', 'active')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lobby_not_found';
  END IF;

  -- Reject duplicate party_session join
  IF EXISTS (
    SELECT 1 FROM public.mp_lobby_screens
    WHERE lobby_id = p_lobby_id
      AND party_session_id = p_party_session_id
      AND status <> 'disconnected'
  ) THEN
    RAISE EXCEPTION 'already_joined';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.mp_lobby_screens
  WHERE lobby_id = p_lobby_id
    AND status <> 'disconnected';

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'lobby_full';
  END IF;

  v_slot := v_count + 1;
  v_id   := gen_random_uuid();

  INSERT INTO public.mp_lobby_screens
    (id, lobby_id, party_session_id, screen_secret, display_name, slot, is_host)
  VALUES
    (v_id, p_lobby_id, p_party_session_id, p_screen_secret, p_display_name, v_slot, FALSE);

  RETURN QUERY SELECT v_id, v_slot;
END;
$$;

-- ─────────────────────────────────────────────
-- Replace cleanup_party_data() to also handle mp_* tables.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_party_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.party_signaling
  WHERE created_at < NOW() - INTERVAL '60 seconds';

  DELETE FROM public.mp_signaling
  WHERE created_at < NOW() - INTERVAL '60 seconds';

  UPDATE public.party_sessions
  SET status = 'ended', ended_at = NOW()
  WHERE status <> 'ended'
    AND expires_at < NOW();

  UPDATE public.mp_lobbies
  SET status = 'ended', ended_at = NOW()
  WHERE status <> 'ended'
    AND expires_at < NOW();

  DELETE FROM public.party_sessions
  WHERE status = 'ended'
    AND COALESCE(ended_at, expires_at) < NOW() - INTERVAL '10 minutes';

  DELETE FROM public.mp_lobbies
  WHERE status = 'ended'
    AND COALESCE(ended_at, expires_at) < NOW() - INTERVAL '10 minutes';

  DELETE FROM public.developer_sessions
  WHERE expires_at < NOW();
END;
$$;

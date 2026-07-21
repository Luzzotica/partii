-- =============================================
-- PARTY SESSIONS (WebRTC Signaling Infrastructure)
-- Provides ephemeral session management for
-- phone-controller party games via REST polling.
-- =============================================

-- ─────────────────────────────────────────────
-- party_sessions
-- Created by external game host (PC/console/browser).
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.party_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-readable 6-character join code (e.g. "XKZMPQ").
  -- Letters only (A–Z minus I/L/O); no digits. See later migration for alphabet.
  join_code     TEXT        NOT NULL,
  -- Opaque token the host must supply on every mutating request.
  -- Generated server-side; never returned after initial creation response.
  host_secret   TEXT        NOT NULL,
  -- Arbitrary string the game host sends at creation (e.g. "godot-platformer").
  game_id       TEXT        NOT NULL DEFAULT '',
  -- "waiting" | "active" | "ended"
  status        TEXT        NOT NULL DEFAULT 'waiting'
                            CHECK (status IN ('waiting', 'active', 'ended')),
  -- Maximum number of controllers allowed to join.
  max_players   SMALLINT    NOT NULL DEFAULT 8,
  -- Arbitrary metadata the host can store (map name, game mode, etc.).
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Auto-set when status transitions to 'ended'.
  ended_at      TIMESTAMPTZ,
  -- Sessions older than this are garbage-collected.
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours')
);

-- join_code must be unique among non-ended sessions only.
-- Codes are recyclable once a session ends.
CREATE UNIQUE INDEX idx_party_sessions_join_code_active
  ON public.party_sessions (join_code)
  WHERE status <> 'ended';

CREATE INDEX idx_party_sessions_expires_at
  ON public.party_sessions (expires_at);

CREATE INDEX idx_party_sessions_status
  ON public.party_sessions (status);

-- RLS enabled; all access goes through the API (admin client).
ALTER TABLE public.party_sessions ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- party_players
-- One row per phone controller that joins a session.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.party_players (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID        NOT NULL
                              REFERENCES public.party_sessions(id) ON DELETE CASCADE,
  -- Display name chosen by the player on their phone.
  display_name    TEXT        NOT NULL DEFAULT 'Player',
  -- Opaque token the phone must supply on every mutating request.
  -- Generated server-side; never returned after initial join response.
  player_secret   TEXT        NOT NULL,
  -- "joined" | "connected" | "disconnected"
  status          TEXT        NOT NULL DEFAULT 'joined'
                              CHECK (status IN ('joined', 'connected', 'disconnected')),
  -- Player's numeric slot within the session (1-based, assigned at join time).
  slot            SMALLINT    NOT NULL,
  -- Arbitrary metadata the game host assigns after the player joins
  -- (e.g. team color, character selection).
  metadata        JSONB       NOT NULL DEFAULT '{}',
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_party_players_session_id
  ON public.party_players (session_id);

CREATE INDEX idx_party_players_session_status
  ON public.party_players (session_id, status);

ALTER TABLE public.party_players ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- party_signaling
-- Ephemeral WebRTC signaling rows.
-- Rows are never updated — only inserted and deleted.
-- Uses BIGSERIAL for a monotonic cursor (since_id pattern).
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.party_signaling (
  -- BIGSERIAL gives a monotonic sequence safe for cursor use:
  -- "give me all rows with id > :since_id"
  id            BIGSERIAL   PRIMARY KEY,
  session_id    UUID        NOT NULL
                            REFERENCES public.party_sessions(id) ON DELETE CASCADE,
  -- Who sent this signal: "host" or a player_id UUID string.
  sender_id     TEXT        NOT NULL,
  -- Who this signal is addressed to: "host" or a player_id UUID string.
  recipient_id  TEXT        NOT NULL,
  -- "offer" | "answer" | "ice_candidate"
  signal_type   TEXT        NOT NULL
                            CHECK (signal_type IN ('offer', 'answer', 'ice_candidate')),
  -- The raw SDP or ICE candidate payload. Stored as JSONB so it can hold
  -- arbitrary WebRTC structures from any engine (Godot, Unity, browser).
  payload       JSONB       NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot polling query: all rows for a recipient in a session after a cursor.
CREATE INDEX idx_party_signaling_recipient_cursor
  ON public.party_signaling (session_id, recipient_id, id);

-- Cleanup query: rows older than TTL.
CREATE INDEX idx_party_signaling_created_at
  ON public.party_signaling (created_at);

ALTER TABLE public.party_signaling ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- generate_join_code()
-- Returns a random 6-char string from an unambiguous alphabet.
-- Called from the API route with a retry loop to avoid conflicts.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_join_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  -- No 0/O, 1/I/L to avoid visual ambiguity
  alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..6 LOOP
    code := code || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
  END LOOP;
  RETURN code;
END;
$$;

-- ─────────────────────────────────────────────
-- party_join_session()
-- Atomic slot assignment for concurrent joins.
-- Uses SELECT ... FOR UPDATE to serialize concurrent inserts.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.party_join_session(
  p_session_id    UUID,
  p_display_name  TEXT,
  p_player_secret TEXT
)
RETURNS TABLE (player_id UUID, player_slot SMALLINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slot      SMALLINT;
  v_player_id UUID;
  v_max       SMALLINT;
  v_count     INT;
BEGIN
  -- Lock the session row to serialize concurrent joins
  SELECT max_players INTO v_max
  FROM public.party_sessions
  WHERE id = p_session_id
    AND status IN ('waiting', 'active')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.party_players
  WHERE session_id = p_session_id
    AND status <> 'disconnected';

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'session_full';
  END IF;

  v_slot      := v_count + 1;
  v_player_id := gen_random_uuid();

  INSERT INTO public.party_players
    (id, session_id, display_name, player_secret, slot)
  VALUES
    (v_player_id, p_session_id, p_display_name, p_player_secret, v_slot);

  RETURN QUERY SELECT v_player_id, v_slot;
END;
$$;

-- ─────────────────────────────────────────────
-- cleanup_party_data()
-- Call on a schedule (Vercel cron → /api/party/cleanup every 5 minutes).
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_party_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Purge stale signaling rows (60-second TTL)
  DELETE FROM public.party_signaling
  WHERE created_at < NOW() - INTERVAL '60 seconds';

  -- Mark sessions that passed expiry but were not cleanly ended
  UPDATE public.party_sessions
  SET status = 'ended', ended_at = NOW()
  WHERE status <> 'ended'
    AND expires_at < NOW();

  -- Purge ended sessions older than 10 minutes (cascades to players + signals)
  DELETE FROM public.party_sessions
  WHERE status = 'ended'
    AND COALESCE(ended_at, expires_at) < NOW() - INTERVAL '10 minutes';
END;
$$;

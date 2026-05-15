-- =============================================
-- ROOMS — unified WebRTC signaling
--
-- Collapses the previous two systems (party_sessions for phone↔screen and
-- mp_lobbies for screen↔screen) into a single primitive: a "room" with
-- arbitrary peers. Each peer declares its `kind` ('phone', 'screen', or
-- anything the app wants); the platform doesn't differentiate.
--
-- Destructive: drops the old tables + RPCs at the bottom. No prod users
-- on the old surface yet.
-- =============================================

-- ─────────────────────────────────────────────
-- rooms
-- One per active multiplayer session, host-owned.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rooms (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id            UUID        NOT NULL REFERENCES public.api_keys(id),
  -- Opaque token the host must supply on every mutating request.
  host_secret           TEXT        NOT NULL,
  game_id               TEXT        NOT NULL DEFAULT '',
  display_name          TEXT        NOT NULL DEFAULT '',
  -- Human-readable 6-char join code. Unique among non-ended rooms only.
  join_code             TEXT        NOT NULL,
  visibility            TEXT        NOT NULL DEFAULT 'private'
                                     CHECK (visibility IN ('public', 'private')),
  -- When false, /api/rooms/[id]/peers POST rejects new joiners even if there
  -- are free slots. Host flips this off mid-match to lock the room.
  joinable              BOOLEAN     NOT NULL DEFAULT TRUE,
  max_peers             SMALLINT    NOT NULL DEFAULT 8,
  password_hash         TEXT,
  is_password_protected BOOLEAN     GENERATED ALWAYS AS (password_hash IS NOT NULL) STORED,
  metadata              JSONB       NOT NULL DEFAULT '{}',
  status                TEXT        NOT NULL DEFAULT 'waiting'
                                     CHECK (status IN ('waiting', 'active', 'ended')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at              TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours')
);

CREATE UNIQUE INDEX idx_rooms_join_code_active
  ON public.rooms (join_code) WHERE status <> 'ended';
CREATE INDEX idx_rooms_game_status
  ON public.rooms (api_key_id, game_id, status);
CREATE INDEX idx_rooms_public_listing
  ON public.rooms (game_id, visibility, joinable, status, created_at DESC);
CREATE INDEX idx_rooms_expires_at ON public.rooms (expires_at);
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- room_peers
-- One row per participant in a room. The host has a row here too
-- (is_host=true), so signal routing is uniform across all peers.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.room_peers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  peer_secret   TEXT        NOT NULL,
  -- Application-defined: 'phone' | 'screen' | 'spectator' | ...
  -- The platform doesn't interpret this; downstream code reads it to
  -- decide what to do with each peer.
  kind          TEXT        NOT NULL,
  display_name  TEXT        NOT NULL DEFAULT '',
  -- Monotonic 1-based slot assigned by room_join(); spans all kinds.
  slot          SMALLINT    NOT NULL,
  is_host       BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Arbitrary app data (e.g. controller_config for phone peers,
  -- snapshot rate preferences for screen peers).
  metadata      JSONB       NOT NULL DEFAULT '{}',
  status        TEXT        NOT NULL DEFAULT 'joined'
                             CHECK (status IN ('joined', 'connected', 'disconnected')),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_room_peers_room ON public.room_peers (room_id);
-- Exactly one host per room.
CREATE UNIQUE INDEX idx_room_peers_one_host
  ON public.room_peers (room_id) WHERE is_host = TRUE;
ALTER TABLE public.room_peers ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- room_signals
-- BIGSERIAL cursor for since_id polling. 60s TTL via cleanup.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.room_signals (
  id                 BIGSERIAL   PRIMARY KEY,
  room_id            UUID        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  -- "host" or a room_peers.id UUID string. "host" is shorthand for the
  -- room's host peer — both forms route to the same destination.
  sender_peer_id     TEXT        NOT NULL,
  recipient_peer_id  TEXT        NOT NULL,
  signal_type        TEXT        NOT NULL
                                  CHECK (signal_type IN ('offer', 'answer', 'ice_candidate')),
  payload            JSONB       NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_room_signals_recipient_cursor
  ON public.room_signals (room_id, recipient_peer_id, id);
CREATE INDEX idx_room_signals_created_at
  ON public.room_signals (created_at);

ALTER TABLE public.room_signals ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- room_join()
-- Atomic peer-join: locks the room row, enforces joinable + max_peers,
-- assigns the next slot, inserts the peer. Replaces both
-- party_join_session and mp_join_lobby with a single shape.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.room_join(
  p_room_id       UUID,
  p_kind          TEXT,
  p_display_name  TEXT,
  p_peer_secret   TEXT,
  p_metadata      JSONB
)
RETURNS TABLE (peer_id UUID, peer_slot SMALLINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_max      SMALLINT;
  v_joinable BOOLEAN;
  v_count    INT;
  v_slot     SMALLINT;
  v_id       UUID;
BEGIN
  SELECT max_peers, joinable INTO v_max, v_joinable
  FROM public.rooms
  WHERE id = p_room_id
    AND status IN ('waiting', 'active')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found';
  END IF;

  IF NOT v_joinable THEN
    RAISE EXCEPTION 'room_not_joinable';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.room_peers
  WHERE room_id = p_room_id
    AND status <> 'disconnected';

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'room_full';
  END IF;

  v_slot := v_count + 1;
  v_id   := gen_random_uuid();

  INSERT INTO public.room_peers
    (id, room_id, peer_secret, kind, display_name, slot, is_host, metadata)
  VALUES
    (v_id, p_room_id, p_peer_secret, p_kind, p_display_name, v_slot, FALSE, COALESCE(p_metadata, '{}'::jsonb));

  RETURN QUERY SELECT v_id, v_slot;
END;
$$;

-- ─────────────────────────────────────────────
-- cleanup_room_data()
-- Called by Vercel cron → /api/rooms/cleanup. Replaces cleanup_party_data.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_room_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Purge stale signaling rows (60-second TTL).
  DELETE FROM public.room_signals
  WHERE created_at < NOW() - INTERVAL '60 seconds';

  -- Mark rooms past their TTL as ended.
  UPDATE public.rooms
  SET status = 'ended', ended_at = NOW()
  WHERE status <> 'ended'
    AND expires_at < NOW();

  -- Purge ended rooms older than 10 minutes (cascades to peers + signals).
  DELETE FROM public.rooms
  WHERE status = 'ended'
    AND COALESCE(ended_at, expires_at) < NOW() - INTERVAL '10 minutes';
END;
$$;

-- ─────────────────────────────────────────────
-- Destructive cut — drop the old party_* and mp_* surface.
-- Cascades clean up rows in the dependent tables and the FK from
-- mp_lobby_screens.party_session_id to party_sessions.
-- ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.mp_join_lobby(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.party_join_session(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.cleanup_party_data();

DROP TABLE IF EXISTS public.mp_signaling      CASCADE;
DROP TABLE IF EXISTS public.mp_lobby_screens  CASCADE;
DROP TABLE IF EXISTS public.mp_lobbies        CASCADE;
DROP TABLE IF EXISTS public.party_signaling   CASCADE;
DROP TABLE IF EXISTS public.party_players     CASCADE;
DROP TABLE IF EXISTS public.party_sessions    CASCADE;

-- generate_join_code() stays: it's generic and the new POST /api/rooms uses it.

-- ─────────────────────────────────────────────
-- usage_events: drop session_id/lobby_id refs (those tables are gone),
-- add a single room_id for metering. No FK constraint — it's analytics-only.
-- ─────────────────────────────────────────────
ALTER TABLE public.usage_events DROP COLUMN IF EXISTS session_id;
ALTER TABLE public.usage_events DROP COLUMN IF EXISTS lobby_id;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS room_id UUID;


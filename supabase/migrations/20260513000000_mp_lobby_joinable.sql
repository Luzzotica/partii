-- Add a `joinable` flag on mp_lobbies. When false, new screens are rejected
-- even if the lobby is public and has open slots. Hosts flip this off when
-- they leave the lobby/level-select screen and the match is in progress.

ALTER TABLE public.mp_lobbies
  ADD COLUMN IF NOT EXISTS joinable BOOLEAN NOT NULL DEFAULT TRUE;

-- Reject joins on non-joinable lobbies. Keep the existing slot/uniqueness
-- behavior; add the joinable check right after the lobby row is locked.
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
  v_slot       SMALLINT;
  v_id         UUID;
  v_max        SMALLINT;
  v_count      INT;
  v_joinable   BOOLEAN;
BEGIN
  SELECT max_screens, joinable INTO v_max, v_joinable
  FROM public.mp_lobbies
  WHERE id = p_lobby_id
    AND status IN ('waiting', 'active')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lobby_not_found';
  END IF;

  IF NOT v_joinable THEN
    RAISE EXCEPTION 'lobby_not_joinable';
  END IF;

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

-- Host's own peer row shouldn't count toward `max_peers`. Today the UI says
-- "3/4 connected" while the server thinks the room is at 4 (3 phones + 1
-- host peer), so the 4th phone gets a 409 it shouldn't. Exclude is_host=true
-- rows from the cap check. Slot numbering keeps incrementing across all
-- peers (so the host gets slot 1, first joiner gets slot 2, etc.) — slot
-- isn't unique-constrained and is just a stable display order.

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
  v_max          SMALLINT;
  v_joinable     BOOLEAN;
  v_total_count  INT;
  v_nonhost_cnt  INT;
  v_slot         SMALLINT;
  v_id           UUID;
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

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE NOT is_host)
  INTO v_total_count, v_nonhost_cnt
  FROM public.room_peers
  WHERE room_id = p_room_id
    AND status <> 'disconnected';

  IF v_nonhost_cnt >= v_max THEN
    RAISE EXCEPTION 'room_full';
  END IF;

  v_slot := v_total_count + 1;
  v_id   := gen_random_uuid();

  INSERT INTO public.room_peers
    (id, room_id, peer_secret, kind, display_name, slot, is_host, metadata)
  VALUES
    (v_id, p_room_id, p_peer_secret, p_kind, p_display_name, v_slot, FALSE, COALESCE(p_metadata, '{}'::jsonb));

  RETURN QUERY SELECT v_id, v_slot;
END;
$$;

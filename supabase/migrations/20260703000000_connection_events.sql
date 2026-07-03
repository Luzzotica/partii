-- ─────────────────────────────────────────────
-- connection_events
-- One row per WebRTC connection attempt/outcome, reported fire-and-forget by
-- game clients via POST /api/telemetry/connect. This is the measurement layer
-- for the connection-platform work: which failure class (signaling vs NAT/TURN
-- vs mid-session drop) actually hits real players, per game, over time.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connection_events (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id      UUID         REFERENCES public.api_keys(id) ON DELETE CASCADE,
  game_id         TEXT         NOT NULL DEFAULT '',
  room_id         UUID,
  role            TEXT         NOT NULL DEFAULT '',            -- host | peer
  outcome         TEXT         NOT NULL,                       -- connected | timeout | failed | recovered | gave_up
  connect_ms      INTEGER,                                     -- attempt start → connected (null for later outcomes)
  -- Selected ICE candidate info at the time of the event.
  candidate_type  TEXT,                                        -- host | srflx | prflx | relay
  relay_host      TEXT,                                        -- which TURN server relayed (when candidate_type=relay)
  ice_restarts    INTEGER      NOT NULL DEFAULT 0,
  signaling_path  TEXT,                                        -- poll | push
  ua_hint         TEXT,                                        -- coarse browser/platform tag, never full UA
  player_id       TEXT,                                        -- identity tag once the identity service lands
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connection_events_game_time
  ON public.connection_events (game_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connection_events_outcome_time
  ON public.connection_events (outcome, created_at DESC);

ALTER TABLE public.connection_events ENABLE ROW LEVEL SECURITY;
-- No policies: writes go through the service role only (the Vercel route).

-- ─────────────────────────────────────────────
-- connection_events_daily — monitoring rollup: outcome rates + connect-time
-- percentiles + candidate/signaling splits per game per UTC day.
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW public.connection_events_daily AS
SELECT
  game_id,
  date_trunc('day', created_at) AS day,
  COUNT(*)                                                       AS events,
  COUNT(*) FILTER (WHERE outcome = 'connected')                  AS connected,
  COUNT(*) FILTER (WHERE outcome IN ('timeout', 'failed', 'gave_up')) AS failures,
  COUNT(*) FILTER (WHERE outcome = 'recovered')                  AS recoveries,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY connect_ms) FILTER (WHERE outcome = 'connected') AS p50_connect_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY connect_ms) FILTER (WHERE outcome = 'connected') AS p95_connect_ms,
  COUNT(*) FILTER (WHERE candidate_type = 'relay')               AS relay_sessions,
  COUNT(*) FILTER (WHERE signaling_path = 'push')                AS push_signaled
FROM public.connection_events
GROUP BY game_id, day;

-- ─────────────────────────────────────────────
-- turn_usage
-- One row per closed TURN allocation. Bytes are coturn's session totals.
-- Populated by the arcade-turn Fly app via POST /api/turn/usage; the
-- api_key_id is authoritative because it's parsed from a coturn-validated
-- HMAC username (only Vercel can mint those).
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.turn_usage (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id      UUID         NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  -- Free-form tag from the TURN username (usually room_peers.id).
  peer_tag        TEXT,
  -- coturn's internal session id (string of digits). Useful for debugging
  -- and as a natural dedupe key if the reporter ever re-sends.
  session_id      TEXT,
  realm           TEXT,
  bytes_sent      BIGINT       NOT NULL DEFAULT 0,
  bytes_received  BIGINT       NOT NULL DEFAULT 0,
  packets_sent    BIGINT       NOT NULL DEFAULT 0,
  packets_received BIGINT      NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (api_key_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_turn_usage_api_key_time
  ON public.turn_usage (api_key_id, ended_at DESC);

CREATE INDEX IF NOT EXISTS idx_turn_usage_ended
  ON public.turn_usage (ended_at DESC);

ALTER TABLE public.turn_usage ENABLE ROW LEVEL SECURITY;
-- No policies: writes go through the service role only (the Vercel route);
-- reads in the dev portal use existing admin patterns.

-- ─────────────────────────────────────────────
-- turn_usage_daily — dev-portal rollup.
-- Sum bytes per api_key per UTC day.
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW public.turn_usage_daily AS
SELECT
  api_key_id,
  date_trunc('day', ended_at) AS day,
  COUNT(*)                    AS sessions,
  SUM(bytes_sent)             AS bytes_sent,
  SUM(bytes_received)         AS bytes_received,
  SUM(bytes_sent + bytes_received) AS bytes_total
FROM public.turn_usage
GROUP BY api_key_id, day;

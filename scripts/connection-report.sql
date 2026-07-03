-- Connection reliability report — run in the Supabase SQL editor (or psql).
-- Data source: connection_events, reported fire-and-forget by every game client
-- (see packages/party-kit PROTOCOL.md §6). The "wiped out" success metric:
-- outcome=connected ≥ 99%, p95 connect_ms < 4000, relay share visible & sane.

-- 1. Daily health per game (last 14 days)
SELECT
  game_id,
  day::date,
  events,
  connected,
  failures,
  recoveries,
  ROUND(100.0 * connected / NULLIF(connected + failures, 0), 1) AS connect_rate_pct,
  ROUND(p50_connect_ms) AS p50_ms,
  ROUND(p95_connect_ms) AS p95_ms,
  relay_sessions,
  push_signaled
FROM connection_events_daily
WHERE day > NOW() - INTERVAL '14 days'
ORDER BY day DESC, game_id;

-- 2. Failure-class breakdown (last 7 days) — which class hits real players?
SELECT
  game_id,
  outcome,
  signaling_path,
  candidate_type,
  COUNT(*) AS n,
  ROUND(AVG(ice_restarts), 2) AS avg_ice_restarts
FROM connection_events
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY game_id, outcome, signaling_path, candidate_type
ORDER BY n DESC;

-- 3. Relay share + which TURN host carries it (Cloudflare cost watch)
SELECT
  COALESCE(relay_host, '(direct/srflx)') AS relay_host,
  COUNT(*) AS sessions,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM connection_events
WHERE created_at > NOW() - INTERVAL '7 days'
  AND outcome = 'connected'
GROUP BY relay_host
ORDER BY sessions DESC;

-- 4. Platform breakdown — are failures concentrated on one browser/OS?
SELECT
  ua_hint,
  outcome,
  COUNT(*) AS n
FROM connection_events
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY ua_hint, outcome
ORDER BY ua_hint, n DESC;

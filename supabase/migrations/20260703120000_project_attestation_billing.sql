-- =============================================
-- PROJECT ATTESTATION (BYO) + BILLING
--
-- Attestation: our Cloudflare Turnstile widget and Steam publisher key are
-- scoped to OUR domains/apps, so customer projects bring their own. Secrets
-- are encrypted at rest (lib/api/secretBox.ts, AES-256-GCM, `v1:` prefix) —
-- the columns hold ciphertext, decrypted server-side only at attestation time.
-- Empty/NULL = fall back to the platform env credentials (our own games).
--
-- Enforcement becomes PER-PROJECT: flipping the global ENFORCE_SESSION_TOKENS
-- env would break customers who haven't wired the token exchange; the flag on
-- the project row lets each project opt in when ready.
--
-- Billing: one paid plan ("pro", $5/mo) + metered relay overage. Quota columns
-- (origins_and_limits migration) are WRITTEN on plan change by the Stripe
-- webhook, so the existing enforcement paths need no billing awareness.
-- =============================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS require_session_tokens BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS turnstile_secret_enc   TEXT,
  ADD COLUMN IF NOT EXISTS steam_publisher_key_enc TEXT,
  ADD COLUMN IF NOT EXISTS steam_app_id           TEXT,
  ADD COLUMN IF NOT EXISTS plan                   TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS relay_included_gb      INTEGER NOT NULL DEFAULT 5;

COMMENT ON COLUMN public.projects.require_session_tokens IS
  'When true, raw API keys are rejected on gameplay routes for THIS project — '
  'only short-lived session tokens from /api/auth/token are accepted. Opt-in.';
COMMENT ON COLUMN public.projects.turnstile_secret_enc IS
  'Customer''s own Cloudflare Turnstile secret, secretBox-encrypted (v1: prefix). '
  'NULL = platform default (first-party games only).';
COMMENT ON COLUMN public.projects.steam_publisher_key_enc IS
  'Customer''s Steam publisher Web API key, secretBox-encrypted. NULL = platform default.';
COMMENT ON COLUMN public.projects.plan IS 'Billing plan: free | pro.';
COMMENT ON COLUMN public.projects.relay_included_gb IS
  'Relay (TURN) GB included per month. Free tier: relay withheld beyond this '
  '(direct P2P unaffected). Pro: overage metered to Stripe at $/GB.';

-- Idempotency ledger for the daily metered-usage cron: one row per project per
-- billing period, tracking cumulative GB already reported to Stripe.
CREATE TABLE IF NOT EXISTS public.relay_usage_reports (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Billing period key, e.g. '2026-07' (subscription-month resolution is
  -- handled in code; the key just has to be stable per period).
  period       TEXT        NOT NULL,
  reported_gb  NUMERIC     NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, period)
);

ALTER TABLE public.relay_usage_reports ENABLE ROW LEVEL SECURITY;
-- No policies: service-role access only (the cron route).

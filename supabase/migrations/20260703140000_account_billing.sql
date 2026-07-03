-- =============================================
-- ACCOUNT-LEVEL BILLING
--
-- The Lobbii plan belongs to the USER, not the project:
--   free → one project, one API key (per project), free quotas
--   pro  → unlimited projects + keys; every project gets pro quotas
-- The per-project quota columns remain the runtime enforcement source —
-- they're (re)written for ALL of a user's projects when the account plan
-- changes, and stamped at project-create time from the account plan.
-- =============================================

CREATE TABLE IF NOT EXISTS public.billing_accounts (
  user_id                UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                   TEXT        NOT NULL DEFAULT 'free',
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
-- No policies: service-role access only (webhook, routes).

COMMENT ON TABLE public.billing_accounts IS
  'One row per user: their Lobbii plan + Stripe linkage. free = 1 project / '
  '1 key per project; pro ($5/mo) = unlimited projects and keys.';

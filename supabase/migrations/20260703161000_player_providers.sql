-- =============================================
-- BYO PLAYER-LOGIN PROVIDER CREDENTIALS (per project)
--
-- Bundle ids / client ids are public identifiers → plain columns (matching
-- steam_app_id). Only the Discord client secret is sensitive → secretBox.
-- Steam reuses the existing steam_publisher_key_enc / steam_app_id columns.
-- =============================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS apple_bundle_id          TEXT,
  ADD COLUMN IF NOT EXISTS google_web_client_id     TEXT,
  ADD COLUMN IF NOT EXISTS discord_client_id        TEXT,
  ADD COLUMN IF NOT EXISTS discord_client_secret_enc TEXT;

COMMENT ON COLUMN public.projects.apple_bundle_id IS
  'iOS bundle id — audience for Sign in with Apple tokens and the signed field '
  'in Game Center identity verification.';
COMMENT ON COLUMN public.projects.google_web_client_id IS
  'Web OAuth client id — audience for Sign in with Google ID tokens.';
COMMENT ON COLUMN public.projects.discord_client_secret_enc IS
  'Discord application client secret, secretBox-encrypted (v1: prefix).';

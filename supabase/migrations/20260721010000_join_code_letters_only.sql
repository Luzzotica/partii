-- =============================================
-- JOIN CODES: LETTERS ONLY
--
-- Owner (Tankii): multiplayer join codes must always use only letters,
-- never digits. Keep the existing ambiguous-glyph exclusions (I/L/O) so
-- codes stay easy to read aloud and type.
--
-- Lookup still accepts legacy digit-mixed codes until those rooms expire
-- (natural churn). New creates use letters only.
-- =============================================

CREATE OR REPLACE FUNCTION public.generate_join_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  -- Letters only. No digits. No I/L/O (look like 1/1/0).
  alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ';
  code TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..6 LOOP
    code := code || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
  END LOOP;
  RETURN code;
END;
$$;

COMMENT ON FUNCTION public.generate_join_code() IS
  'Random 6-char join code: uppercase letters only (A–Z minus I/L/O). No digits.';

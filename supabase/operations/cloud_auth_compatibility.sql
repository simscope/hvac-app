-- Compatibility for the verified 2026-11-16 Hvac Cloud snapshot and the pinned
-- self-hosted Auth platform. These nullable columns are present in that source.
-- This operation does not change any Auth migration ledger or invent its history.
BEGIN;
ALTER TABLE auth.one_time_tokens
  ADD COLUMN IF NOT EXISTS link_token_hash text;
ALTER TABLE auth.saml_providers
  ADD COLUMN IF NOT EXISTS dedicated_scope boolean;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='auth' AND table_name='one_time_tokens'
      AND column_name='link_token_hash' AND data_type='text'
      AND is_nullable='YES'
  ) THEN
    RAISE EXCEPTION 'SOURCE_AUTH_LINK_TOKEN_HASH_CONTRACT_MISMATCH';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='auth' AND table_name='saml_providers'
      AND column_name='dedicated_scope' AND data_type='boolean'
      AND is_nullable='YES'
  ) THEN
    RAISE EXCEPTION 'SOURCE_AUTH_DEDICATED_SCOPE_CONTRACT_MISMATCH';
  END IF;
END;
$$;
COMMIT;

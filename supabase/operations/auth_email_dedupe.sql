BEGIN;
CREATE TABLE hvac_guard.auth_email_deliveries (
  digest text PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('CLAIMED', 'SENT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE hvac_guard.auth_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hvac_guard.auth_email_deliveries FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA hvac_guard TO service_role;
GRANT SELECT, INSERT, UPDATE ON hvac_guard.auth_email_deliveries TO service_role;

CREATE FUNCTION public.hvac_auth_email_claim(p_digest text)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE inserted integer; existing_state text;
BEGIN
  IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_DELIVERY_DIGEST';
  END IF;
  INSERT INTO hvac_guard.auth_email_deliveries(digest,state)
    VALUES(p_digest,'CLAIMED') ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 1 THEN RETURN 'CLAIMED_NOW'; END IF;
  SELECT state INTO existing_state FROM hvac_guard.auth_email_deliveries WHERE digest=p_digest;
  RETURN CASE WHEN existing_state='SENT' THEN 'ALREADY_SENT' ELSE 'BUSY' END;
END;
$$;

CREATE FUNCTION public.hvac_auth_email_finish(p_digest text)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  UPDATE hvac_guard.auth_email_deliveries SET state='SENT',completed_at=now()
    WHERE digest=p_digest AND state='CLAIMED';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.hvac_auth_email_claim(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hvac_auth_email_finish(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hvac_auth_email_claim(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hvac_auth_email_finish(text) TO service_role;
COMMIT;

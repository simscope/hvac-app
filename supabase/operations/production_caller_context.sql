BEGIN;
CREATE OR REPLACE FUNCTION hvac_guard.live_caller_context() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('user',p.id,'session',s.id,'org',t.org_id,
    'role',CASE WHEN p.role::text='technician' THEN 'tech' ELSE p.role::text END)
  FROM public.profiles p
  JOIN public.technicians t ON t.id=p.technician_id
  JOIN auth.sessions s ON s.user_id=p.id
    AND s.id=(auth.jwt()->>'session_id')::uuid
  JOIN hvac_guard.oauth_mailboxes b ON b.name='hvac-gmail' AND b.org_id=t.org_id
  WHERE auth.uid() IS NOT NULL AND p.id=auth.uid()
    AND p.role::text IN ('admin','manager','tech','technician') AND coalesce(t.is_active,true)
    AND (s.not_after IS NULL OR s.not_after>clock_timestamp());
$$;
REVOKE ALL ON FUNCTION hvac_guard.live_caller_context() FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA hvac_guard TO authenticated;
GRANT EXECUTE ON FUNCTION hvac_guard.live_caller_context() TO authenticated;
CREATE OR REPLACE FUNCTION public.hvac_live_caller_context() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT hvac_guard.live_caller_context();
$$;
REVOKE ALL ON FUNCTION public.hvac_live_caller_context() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hvac_live_caller_context() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

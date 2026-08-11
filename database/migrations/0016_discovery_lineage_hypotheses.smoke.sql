DO $$
DECLARE
  v_security_definer boolean;
  v_execute_granted boolean;
BEGIN
  SELECT proc.prosecdef
  INTO v_security_definer
  FROM pg_proc proc
  JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
  WHERE
    namespace.nspname = 'dna'
    AND proc.proname = 'list_discovery_lineage_hypotheses'
    AND pg_get_function_identity_arguments(proc.oid) = 'p_owner_id uuid, p_limit integer';

  IF v_security_definer IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Discovery lineage read function must be SECURITY DEFINER';
  END IF;

  SELECT has_function_privilege(
    'dna_app_runtime',
    'dna.list_discovery_lineage_hypotheses(uuid, integer)',
    'EXECUTE'
  )
  INTO v_execute_granted;

  IF v_execute_granted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Discovery lineage read function is not granted to runtime';
  END IF;
END
$$;

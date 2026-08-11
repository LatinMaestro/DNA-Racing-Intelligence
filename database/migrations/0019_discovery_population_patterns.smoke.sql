DO $$
DECLARE
  v_definition text;
  v_security_definer boolean;
  v_execute_granted boolean;
BEGIN
  SELECT pg_get_functiondef(proc.oid), proc.prosecdef
  INTO v_definition, v_security_definer
  FROM pg_proc proc
  JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'dna'
    AND proc.proname = 'list_discovery_lineage_hypotheses'
    AND pg_get_function_identity_arguments(proc.oid) = 'p_owner_id uuid, p_limit integer';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Population-pattern Discovery function is missing';
  END IF;
  IF v_security_definer IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Population-pattern Discovery function must remain SECURITY DEFINER';
  END IF;
  IF position('population_pattern' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Population-pattern fallback is missing';
  END IF;
  IF position('peer.core_class = owned_details.core_class' IN v_definition) = 0
    OR position('peer.element = owned_details.element' IN v_definition) = 0
    OR position('peer.f_number = owned_details.f_number' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Population pattern must match class, element and F-number';
  END IF;
  IF position('peer.id <> owned.owned_core_id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Population pattern must exclude the target core';
  END IF;
  IF position('7 AS relation_rank' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Population pattern is not the last evidence fallback';
  END IF;
  IF position('direct_profile' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Direct-evidence precedence guard is missing';
  END IF;

  SELECT has_function_privilege(
    'dna_app_runtime',
    'dna.list_discovery_lineage_hypotheses(uuid, integer)',
    'EXECUTE'
  ) INTO v_execute_granted;
  IF v_execute_granted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Population-pattern Discovery function is not granted to runtime';
  END IF;
END
$$;

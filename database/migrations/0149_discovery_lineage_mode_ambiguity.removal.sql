DO $removal$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(proc.oid)
  INTO v_definition
  FROM pg_catalog.pg_proc proc
  JOIN pg_catalog.pg_namespace namespace
    ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'dna'
    AND proc.proname = 'list_discovery_lineage_hypotheses'
    AND pg_catalog.pg_get_function_identity_arguments(proc.oid) =
      'p_owner_id uuid, p_limit integer';

  IF v_definition IS NULL OR
     position('#variable_conflict use_column' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Discovery lineage ambiguity repair reversal failed';
  END IF;
END
$removal$;

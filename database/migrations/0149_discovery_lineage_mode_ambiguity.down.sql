BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_marker constant text := '#variable_conflict use_column';
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

  IF v_definition IS NULL OR position(v_marker IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Discovery lineage ambiguity repair is not installed';
  END IF;

  v_definition := replace(v_definition, E'#variable_conflict use_column\n', '');
  EXECUTE v_definition;
END
$migration$;

COMMIT;

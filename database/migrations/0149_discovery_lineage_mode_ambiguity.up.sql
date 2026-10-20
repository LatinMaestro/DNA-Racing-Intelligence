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

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Discovery lineage function is unavailable';
  END IF;
  IF position(v_marker IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Discovery lineage ambiguity repair is already installed';
  END IF;
  IF position(E'AS $function$\nDECLARE' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Discovery lineage function shape is not approved';
  END IF;

  v_definition := replace(
    v_definition,
    E'AS $function$\nDECLARE',
    E'AS $function$\n#variable_conflict use_column\nDECLARE'
  );
  EXECUTE v_definition;
END
$migration$;

REVOKE ALL ON FUNCTION dna.list_discovery_lineage_hypotheses(uuid, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.list_discovery_lineage_hypotheses(uuid, integer)
  TO dna_app_runtime;

COMMIT;

BEGIN;

DO $removal$
DECLARE
  v_function oid := to_regprocedure(
    'dna.list_race_archive_aggregate_refresh_versions(uuid,uuid,uuid,character,integer)'
  );
  v_definition text;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Race archive aggregate refresh plan function was removed';
  END IF;
  SELECT pg_get_functiondef(v_function) INTO STRICT v_definition;
  IF position('v_partition_count' in v_definition) <> 0
     OR position('total partition count exceeds its bound' in v_definition) <> 0 THEN
    RAISE EXCEPTION 'Race archive aggregate total-partition bound was not reversed';
  END IF;
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.list_race_archive_aggregate_refresh_versions(uuid,uuid,uuid,character,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime Race archive aggregate plan privilege was not restored';
  END IF;
END
$removal$;

ROLLBACK;
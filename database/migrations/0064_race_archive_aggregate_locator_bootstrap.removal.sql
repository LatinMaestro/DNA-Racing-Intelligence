DO $removal$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'dna.list_race_archive_aggregate_refresh_versions(uuid,uuid,uuid,character,integer)'::regprocedure
  ) INTO STRICT v_definition;

  IF position('race_archive_core_locator_receipt' in v_definition) = 0 THEN
    RAISE EXCEPTION 'Race archive locator prerequisite was not restored after rollback';
  END IF;
END
$removal$;

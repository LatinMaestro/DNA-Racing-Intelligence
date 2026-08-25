DO $removal$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure(
    'dna.begin_race_archive_aggregate_publication(uuid,uuid,uuid,text,character,timestamp with time zone)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Race archive aggregate publication function was not restored';
  END IF;

  SELECT pg_get_functiondef(
    'dna.begin_race_archive_aggregate_publication(uuid,uuid,uuid,text,character,timestamp with time zone)'::regprocedure
  ) INTO v_definition;

  IF position('INSERT INTO dna.dataset_version_evidence_receipt' IN v_definition) <> 0
     OR position('JOIN dna.dataset_evidence_object object' IN v_definition) <> 0 THEN
    RAISE EXCEPTION 'Race archive aggregate evidence bootstrap remains after rollback';
  END IF;

  IF position('complete sealed Race archive aggregate evidence is unavailable' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Race archive aggregate predecessor evidence gate was not restored';
  END IF;
END
$removal$;

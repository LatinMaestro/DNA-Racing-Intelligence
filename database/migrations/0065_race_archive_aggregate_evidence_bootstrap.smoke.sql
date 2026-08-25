DO $smoke$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure(
    'dna.begin_race_archive_aggregate_publication(uuid,uuid,uuid,text,character,timestamp with time zone)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Race archive aggregate bootstrap function is unavailable';
  END IF;

  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.begin_race_archive_aggregate_publication(uuid,uuid,uuid,text,character,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Race archive aggregate bootstrap runtime grant is unavailable';
  END IF;

  SELECT pg_get_functiondef(
    'dna.begin_race_archive_aggregate_publication(uuid,uuid,uuid,text,character,timestamp with time zone)'::regprocedure
  ) INTO v_definition;

  IF position('INSERT INTO dna.dataset_version_evidence_receipt' IN v_definition) = 0
     OR position('JOIN dna.dataset_evidence_object object' IN v_definition) = 0
     OR position('object.object_kind = ''staged_rows''' IN v_definition) = 0
     OR position('sum(object.row_count) = batch.source_rows' IN v_definition) = 0
     OR position('sum(object.byte_size) > 0' IN v_definition) = 0
     OR position('ON CONFLICT (owner_id, dataset_version_id) DO NOTHING' IN v_definition) = 0
     OR position('evidence.evidence_byte_size <= 0' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Race archive aggregate bootstrap no longer requires exact registered staged-row evidence coverage';
  END IF;

  IF position('FROM dna.compact_race_row_evidence' IN v_definition) <> 0
     OR position('PERFORM dna.compact_race_row_evidence' IN v_definition) <> 0 THEN
    RAISE EXCEPTION 'Race archive aggregate bootstrap unexpectedly authorizes relational Race-row compaction';
  END IF;
END
$smoke$;

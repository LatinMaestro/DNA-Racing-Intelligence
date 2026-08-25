DO $smoke$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure(
    'dna.bootstrap_race_archive_aggregate_evidence_receipts(uuid,uuid,uuid,character)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Race archive aggregate plan evidence bootstrap function is unavailable';
  END IF;

  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.bootstrap_race_archive_aggregate_evidence_receipts(uuid,uuid,uuid,character)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Race archive aggregate plan evidence bootstrap runtime grant is unavailable';
  END IF;

  SELECT pg_get_functiondef(
    'dna.bootstrap_race_archive_aggregate_evidence_receipts(uuid,uuid,uuid,character)'::regprocedure
  ) INTO v_definition;

  IF position('INSERT INTO dna.dataset_version_evidence_receipt' IN v_definition) = 0
     OR position('JOIN dna.dataset_evidence_object object' IN v_definition) = 0
     OR position('object.object_kind = ''staged_rows''' IN v_definition) = 0
     OR position('sum(object.row_count) = batch.source_rows' IN v_definition) = 0
     OR position('sum(object.byte_size) > 0' IN v_definition) = 0
     OR position('ON CONFLICT (owner_id, dataset_version_id) DO NOTHING' IN v_definition) = 0
     OR position('evidence.evidence_byte_size <= 0' IN v_definition) = 0
     OR position('aggregate_refresh_processing processing' IN v_definition) = 0
     OR position('active_pro_league_source_version_set_sha256' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Race archive aggregate plan evidence bootstrap no longer requires exact claimed registered archive coverage';
  END IF;

  IF position('compact_race_row_evidence' IN v_definition) <> 0
     OR position('race_archive_aggregate_publication_stage' IN v_definition) <> 0 THEN
    RAISE EXCEPTION 'Race archive aggregate plan evidence bootstrap exceeds its evidence-sealing boundary';
  END IF;
END
$smoke$;

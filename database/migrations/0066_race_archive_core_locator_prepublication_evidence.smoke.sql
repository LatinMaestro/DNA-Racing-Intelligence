BEGIN;

SET LOCAL app.owner_id = '66000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '66000000-0000-4000-8000-000000000001',
  'race-core-locator-prepublication-owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  '66000000-0000-4000-8000-000000000010',
  '66000000-0000-4000-8000-000000000001',
  'race_merge', 'race-core-locator-prepublication.csv', repeat('a', 64),
  'utf_8', 'race_merge_v1', 'accepted',
  '2026-08-26T01:00:00Z', '2026-08-26T01:01:00Z',
  '2026-08-25T22:00:00Z', '2026-08-25T23:00:00Z',
  '2026-08-25T23:00:00Z', 2, 2, 0, 0
);

INSERT INTO dna.dataset_evidence_object (
  id, owner_id, import_batch_id, source_type, object_kind,
  partition_number, object_format, object_key, checksum_sha256,
  byte_size, row_count, first_natural_key, last_natural_key, created_at
) VALUES
(
  '66000000-0000-4000-8000-000000000040',
  '66000000-0000-4000-8000-000000000001',
  '66000000-0000-4000-8000-000000000010',
  'race_merge', 'staged_rows', 0, 'ndjson_gzip',
  'synthetic/core-locator-prepublication/part-0.ndjson.gz', repeat('1', 64),
  100, 1, 'event-1:core-1', 'event-1:core-1',
  '2026-08-26T01:00:10Z'
),
(
  '66000000-0000-4000-8000-000000000041',
  '66000000-0000-4000-8000-000000000001',
  '66000000-0000-4000-8000-000000000010',
  'race_merge', 'staged_rows', 1, 'ndjson_gzip',
  'synthetic/core-locator-prepublication/part-1.ndjson.gz', repeat('2', 64),
  120, 1, 'event-2:core-2', 'event-2:core-2',
  '2026-08-26T01:00:11Z'
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES (
  '66000000-0000-4000-8000-000000000020',
  '66000000-0000-4000-8000-000000000001',
  'race_merge', 1,
  '66000000-0000-4000-8000-000000000010',
  '2026-08-26T01:02:00Z', '2026-08-25T23:00:00Z', NULL, true
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status
) VALUES (
  '66000000-0000-4000-8000-000000000030',
  '66000000-0000-4000-8000-000000000001',
  '66000000-0000-4000-8000-000000000020',
  'queued'
);

INSERT INTO dna.aggregate_refresh_processing (
  owner_id, refresh_id, dataset_version_id, worker_id, state,
  source_version_set_sha256, claimed_at, lease_expires_at
) VALUES (
  '66000000-0000-4000-8000-000000000001',
  '66000000-0000-4000-8000-000000000030',
  '66000000-0000-4000-8000-000000000020',
  'race-core-locator-prepublication-worker', 'processing',
  dna.active_pro_league_source_version_set_sha256(
    '66000000-0000-4000-8000-000000000001'
  ),
  '2026-08-26T01:03:00Z', '2099-08-26T01:03:00Z'
);

DO $prepublication_locator$
DECLARE
  v_hash character(64);
  v_plan record;
  v_locator record;
  v_replay record;
BEGIN
  SELECT source_version_set_sha256 INTO STRICT v_hash
  FROM dna.aggregate_refresh_processing
  WHERE owner_id = '66000000-0000-4000-8000-000000000001'
    AND refresh_id = '66000000-0000-4000-8000-000000000030';

  SELECT * INTO STRICT v_plan
  FROM dna.list_race_archive_aggregate_refresh_versions(
    '66000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000030',
    '66000000-0000-4000-8000-000000000020',
    v_hash,
    10
  );

  IF v_plan.evidence_partition_count <> 2 OR v_plan.evidence_row_count <> 2 THEN
    RAISE EXCEPTION 'Race archive pre-publication plan is incorrect';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dna.dataset_version_evidence_receipt receipt
    WHERE receipt.owner_id = '66000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'final evidence receipt exists before locator reconstruction';
  END IF;

  SELECT * INTO STRICT v_locator
  FROM dna.replace_race_archive_core_locators(
    '66000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000020',
    '66000000-0000-4000-8000-000000000010',
    repeat('3', 64),
    '[{"source_core_id":"core-1","partition_numbers":[0],"ready_row_count":1,"first_source_row_number":1,"last_source_row_number":1},{"source_core_id":"core-2","partition_numbers":[1],"ready_row_count":1,"first_source_row_number":2,"last_source_row_number":2}]'::jsonb,
    '2026-08-26T01:04:00Z'
  );

  IF v_locator.status <> 'sealed'
     OR v_locator.core_locator_count <> 2
     OR v_locator.ready_row_count <> 2
     OR v_locator.partition_reference_count <> 2 THEN
    RAISE EXCEPTION 'pre-publication Race archive Core locator build is incorrect';
  END IF;

  SELECT * INTO STRICT v_replay
  FROM dna.replace_race_archive_core_locators(
    '66000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000020',
    '66000000-0000-4000-8000-000000000010',
    repeat('3', 64),
    '[{"source_core_id":"core-1","partition_numbers":[0],"ready_row_count":1,"first_source_row_number":1,"last_source_row_number":1},{"source_core_id":"core-2","partition_numbers":[1],"ready_row_count":1,"first_source_row_number":2,"last_source_row_number":2}]'::jsonb,
    '2026-08-26T01:05:00Z'
  );

  IF v_replay.status <> 'existing' THEN
    RAISE EXCEPTION 'Race archive Core locator replay is not idempotent';
  END IF;
END
$prepublication_locator$;

DO $locator_drift_denied$
BEGIN
  BEGIN
    UPDATE dna.dataset_evidence_object
    SET checksum_sha256 = repeat('9', 64)
    WHERE owner_id = '66000000-0000-4000-8000-000000000001'
      AND id = '66000000-0000-4000-8000-000000000040';

    PERFORM * FROM dna.replace_race_archive_core_locators(
      '66000000-0000-4000-8000-000000000001',
      '66000000-0000-4000-8000-000000000020',
      '66000000-0000-4000-8000-000000000010',
      repeat('3', 64),
      '[{"source_core_id":"core-1","partition_numbers":[0],"ready_row_count":1,"first_source_row_number":1,"last_source_row_number":1},{"source_core_id":"core-2","partition_numbers":[1],"ready_row_count":1,"first_source_row_number":2,"last_source_row_number":2}]'::jsonb,
      '2026-08-26T01:05:30Z'
    );
    RAISE EXCEPTION 'changed locator evidence checksum was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'changed locator evidence checksum was accepted' THEN RAISE; END IF;
    IF position('Core locator evidence drift detected' in SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END
$locator_drift_denied$;

UPDATE dna.dataset_version
SET aggregate_refreshed_at = '2026-08-26T01:06:00Z'
WHERE owner_id = '66000000-0000-4000-8000-000000000001'
  AND id = '66000000-0000-4000-8000-000000000020';

UPDATE dna.aggregate_refresh_job
SET status = 'completed',
    started_at = '2026-08-26T01:03:00Z',
    completed_at = '2026-08-26T01:06:00Z',
    affected_record_count = 2
WHERE owner_id = '66000000-0000-4000-8000-000000000001'
  AND id = '66000000-0000-4000-8000-000000000030';

DO $final_receipt_binding$
DECLARE
  v_seal record;
  v_replay record;
BEGIN
  SELECT * INTO STRICT v_seal
  FROM dna.seal_dataset_version_evidence(
    '66000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000020',
    '2026-08-26T01:07:00Z'
  );

  IF v_seal.status <> 'sealed' THEN
    RAISE EXCEPTION 'post-aggregate evidence did not seal';
  END IF;

  SELECT * INTO STRICT v_replay
  FROM dna.replace_race_archive_core_locators(
    '66000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000020',
    '66000000-0000-4000-8000-000000000010',
    repeat('3', 64),
    '[{"source_core_id":"core-1","partition_numbers":[0],"ready_row_count":1,"first_source_row_number":1,"last_source_row_number":1},{"source_core_id":"core-2","partition_numbers":[1],"ready_row_count":1,"first_source_row_number":2,"last_source_row_number":2}]'::jsonb,
    '2026-08-26T01:08:00Z'
  );

  IF v_replay.status <> 'existing' THEN
    RAISE EXCEPTION 'sealed Race archive Core locator replay is not idempotent';
  END IF;

  BEGIN
    DELETE FROM dna.dataset_version_evidence_receipt
    WHERE owner_id = '66000000-0000-4000-8000-000000000001'
      AND dataset_version_id = '66000000-0000-4000-8000-000000000020';

    PERFORM * FROM dna.replace_race_archive_core_locators(
      '66000000-0000-4000-8000-000000000001',
      '66000000-0000-4000-8000-000000000020',
      '66000000-0000-4000-8000-000000000010',
      repeat('3', 64),
      '[{"source_core_id":"core-1","partition_numbers":[0],"ready_row_count":1,"first_source_row_number":1,"last_source_row_number":1},{"source_core_id":"core-2","partition_numbers":[1],"ready_row_count":1,"first_source_row_number":2,"last_source_row_number":2}]'::jsonb,
      '2026-08-26T01:09:00Z'
    );
    RAISE EXCEPTION 'missing required final receipt was accepted by Core locators';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'missing required final receipt was accepted by Core locators' THEN RAISE; END IF;
    IF position('complete sealed Race archive aggregate evidence is unavailable' in SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END
$final_receipt_binding$;

DO $privileges$
BEGIN
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.replace_race_archive_core_locators(uuid,uuid,uuid,character,jsonb,timestamp with time zone)',
    'EXECUTE'
  ) OR has_function_privilege(
    'dna_app_runtime',
    'dna.replace_race_archive_core_locators_pre_0066(uuid,uuid,uuid,character,jsonb,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Race archive Core locator migration privileges are incorrect';
  END IF;
END
$privileges$;

ROLLBACK;

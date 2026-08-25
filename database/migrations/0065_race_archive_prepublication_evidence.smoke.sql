BEGIN;

SET LOCAL app.owner_id = '65000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '65000000-0000-4000-8000-000000000001',
  'race-archive-prepublication-owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  '65000000-0000-4000-8000-000000000010',
  '65000000-0000-4000-8000-000000000001',
  'race_merge', 'race-prepublication.csv', repeat('a', 64),
  'utf_8', 'race_merge_v1', 'accepted',
  '2026-08-26T00:00:00Z', '2026-08-26T00:01:00Z',
  '2026-08-25T22:00:00Z', '2026-08-25T23:00:00Z',
  '2026-08-25T23:00:00Z', 2, 2, 0, 0
);

INSERT INTO dna.dataset_evidence_object (
  id, owner_id, import_batch_id, source_type, object_kind,
  partition_number, object_format, object_key, checksum_sha256,
  byte_size, row_count, first_natural_key, last_natural_key, created_at
) VALUES
(
  '65000000-0000-4000-8000-000000000040',
  '65000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000010',
  'race_merge', 'staged_rows', 0, 'ndjson_gzip',
  'synthetic/prepublication/part-0.ndjson.gz', repeat('1', 64),
  100, 1, 'event-1:core-1', 'event-1:core-1',
  '2026-08-26T00:00:10Z'
),
(
  '65000000-0000-4000-8000-000000000041',
  '65000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000010',
  'race_merge', 'staged_rows', 1, 'ndjson_gzip',
  'synthetic/prepublication/part-1.ndjson.gz', repeat('2', 64),
  120, 1, 'event-2:core-2', 'event-2:core-2',
  '2026-08-26T00:00:11Z'
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES (
  '65000000-0000-4000-8000-000000000020',
  '65000000-0000-4000-8000-000000000001',
  'race_merge', 1,
  '65000000-0000-4000-8000-000000000010',
  '2026-08-26T00:02:00Z', '2026-08-25T23:00:00Z', NULL, true
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status
) VALUES (
  '65000000-0000-4000-8000-000000000030',
  '65000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000020',
  'queued'
);

INSERT INTO dna.aggregate_refresh_processing (
  owner_id, refresh_id, dataset_version_id, worker_id, state,
  source_version_set_sha256, claimed_at, lease_expires_at
) VALUES (
  '65000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000030',
  '65000000-0000-4000-8000-000000000020',
  'race-prepublication-worker', 'processing',
  dna.active_pro_league_source_version_set_sha256(
    '65000000-0000-4000-8000-000000000001'
  ),
  '2026-08-26T00:03:00Z', '2099-08-26T00:03:00Z'
);

DO $prepublication$
DECLARE
  v_hash character(64);
  v_plan record;
  v_replay record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM dna.dataset_version_evidence_receipt receipt
    WHERE receipt.owner_id = '65000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'post-aggregate evidence receipt exists before reconstruction';
  END IF;

  SELECT source_version_set_sha256 INTO STRICT v_hash
  FROM dna.aggregate_refresh_processing
  WHERE owner_id = '65000000-0000-4000-8000-000000000001'
    AND refresh_id = '65000000-0000-4000-8000-000000000030';

  SELECT * INTO STRICT v_plan
  FROM dna.list_race_archive_aggregate_refresh_versions(
    '65000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000030',
    '65000000-0000-4000-8000-000000000020',
    v_hash,
    10
  );

  IF v_plan.dataset_version_id <>
       '65000000-0000-4000-8000-000000000020'::uuid
     OR v_plan.evidence_partition_count <> 2
     OR v_plan.evidence_row_count <> 2 THEN
    RAISE EXCEPTION 'pre-publication Race archive plan is incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_archive_prepublication_evidence_receipt receipt
    WHERE receipt.owner_id = '65000000-0000-4000-8000-000000000001'
      AND receipt.dataset_version_id = '65000000-0000-4000-8000-000000000020'
      AND receipt.import_batch_id = '65000000-0000-4000-8000-000000000010'
      AND receipt.source_type = 'race_merge'
      AND receipt.source_row_count = 2
      AND receipt.accepted_row_count = 2
      AND receipt.evidence_kind = 'staged_rows'
      AND receipt.evidence_partition_count = 2
      AND receipt.evidence_row_count = 2
      AND receipt.evidence_byte_size = 220
      AND NOT receipt.final_receipt_required
  ) THEN
    RAISE EXCEPTION 'pre-publication Race archive evidence was not locked';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dna.dataset_version_evidence_receipt receipt
    WHERE receipt.owner_id = '65000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'pre-publication planning falsely created a final receipt';
  END IF;

  SELECT * INTO STRICT v_replay
  FROM dna.prepare_race_archive_prepublication_evidence(
    '65000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000030',
    '65000000-0000-4000-8000-000000000020',
    v_hash,
    '65000000-0000-4000-8000-000000000020',
    '2026-08-26T00:04:00Z'
  );

  IF v_replay.status <> 'existing'
     OR v_replay.evidence_partition_count <> 2
     OR v_replay.evidence_row_count <> 2
     OR v_replay.evidence_byte_size <> 220 THEN
    RAISE EXCEPTION 'pre-publication Race archive replay is not idempotent';
  END IF;
END
$prepublication$;

DO $preaggregate_seal_denied$
BEGIN
  BEGIN
    PERFORM * FROM dna.seal_dataset_version_evidence(
      '65000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000020',
      '2026-08-26T00:05:00Z'
    );
    RAISE EXCEPTION 'post-aggregate evidence sealed before aggregate completion';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'post-aggregate evidence sealed before aggregate completion' THEN
      RAISE;
    END IF;
    IF position('analytical read models are not refreshed' in SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM dna.dataset_version_evidence_receipt receipt
    WHERE receipt.owner_id = '65000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'failed early seal left a post-aggregate receipt';
  END IF;
END
$preaggregate_seal_denied$;

DO $drift_denied$
DECLARE
  v_hash character(64);
BEGIN
  SELECT source_version_set_sha256 INTO STRICT v_hash
  FROM dna.aggregate_refresh_processing
  WHERE owner_id = '65000000-0000-4000-8000-000000000001'
    AND refresh_id = '65000000-0000-4000-8000-000000000030';

  BEGIN
    UPDATE dna.dataset_evidence_object
    SET checksum_sha256 = repeat('9', 64)
    WHERE owner_id = '65000000-0000-4000-8000-000000000001'
      AND id = '65000000-0000-4000-8000-000000000040';

    PERFORM * FROM dna.list_race_archive_aggregate_refresh_versions(
      '65000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000030',
      '65000000-0000-4000-8000-000000000020',
      v_hash,
      10
    );
    RAISE EXCEPTION 'changed pre-publication checksum was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'changed pre-publication checksum was accepted' THEN RAISE; END IF;
    IF position('pre-publication evidence replay conflict' in SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  BEGIN
    INSERT INTO dna.dataset_evidence_object (
      id, owner_id, import_batch_id, source_type, object_kind,
      partition_number, object_format, object_key, checksum_sha256,
      byte_size, row_count, first_natural_key, last_natural_key, created_at
    ) VALUES (
      '65000000-0000-4000-8000-000000000042',
      '65000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000010',
      'race_merge', 'normalized_partition', 0, 'ndjson_gzip',
      'synthetic/prepublication/normalized-0.ndjson.gz', repeat('8', 64),
      220, 2, 'event-1:core-1', 'event-2:core-2',
      '2026-08-26T00:04:30Z'
    );

    PERFORM * FROM dna.list_race_archive_aggregate_refresh_versions(
      '65000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000030',
      '65000000-0000-4000-8000-000000000020',
      v_hash,
      10
    );
    RAISE EXCEPTION 'ambiguous staged and normalized evidence was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ambiguous staged and normalized evidence was accepted' THEN RAISE; END IF;
    IF position('pre-publication evidence coverage is ambiguous' in SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END
$drift_denied$;

UPDATE dna.dataset_version
SET aggregate_refreshed_at = '2026-08-26T00:06:00Z'
WHERE owner_id = '65000000-0000-4000-8000-000000000001'
  AND id = '65000000-0000-4000-8000-000000000020';

UPDATE dna.aggregate_refresh_job
SET status = 'completed',
    started_at = '2026-08-26T00:03:00Z',
    completed_at = '2026-08-26T00:06:00Z',
    affected_record_count = 2
WHERE owner_id = '65000000-0000-4000-8000-000000000001'
  AND id = '65000000-0000-4000-8000-000000000030';

DO $final_seal$
DECLARE
  v_seal record;
  v_replay record;
BEGIN
  SELECT * INTO STRICT v_seal
  FROM dna.seal_dataset_version_evidence(
    '65000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000020',
    '2026-08-26T00:07:00Z'
  );

  IF v_seal.status <> 'sealed'
     OR v_seal.evidence_kind <> 'staged_rows'
     OR v_seal.evidence_partition_count <> 2
     OR v_seal.evidence_row_count <> 2
     OR v_seal.evidence_byte_size <> 220 THEN
    RAISE EXCEPTION 'post-aggregate Race evidence seal is incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_archive_prepublication_evidence_receipt receipt
    WHERE receipt.owner_id = '65000000-0000-4000-8000-000000000001'
      AND receipt.dataset_version_id = '65000000-0000-4000-8000-000000000020'
      AND receipt.final_receipt_required
  ) OR NOT EXISTS (
    SELECT 1
    FROM dna.dataset_version_evidence_receipt receipt
    WHERE receipt.owner_id = '65000000-0000-4000-8000-000000000001'
      AND receipt.dataset_version_id = '65000000-0000-4000-8000-000000000020'
      AND receipt.import_batch_id = '65000000-0000-4000-8000-000000000010'
      AND receipt.evidence_partition_count = 2
      AND receipt.evidence_row_count = 2
      AND receipt.evidence_byte_size = 220
  ) THEN
    RAISE EXCEPTION 'final Race evidence did not bind to pre-publication authority';
  END IF;

  SELECT * INTO STRICT v_replay
  FROM dna.seal_dataset_version_evidence(
    '65000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000020',
    '2026-08-26T00:08:00Z'
  );

  IF v_replay.status <> 'existing' THEN
    RAISE EXCEPTION 'post-aggregate Race evidence replay is not idempotent';
  END IF;

  BEGIN
    DELETE FROM dna.dataset_version_evidence_receipt
    WHERE owner_id = '65000000-0000-4000-8000-000000000001'
      AND dataset_version_id = '65000000-0000-4000-8000-000000000020';

    PERFORM * FROM dna.list_race_archive_aggregate_refresh_versions(
      '65000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000030',
      '65000000-0000-4000-8000-000000000020',
      (SELECT source_version_set_sha256
       FROM dna.aggregate_refresh_processing
       WHERE owner_id = '65000000-0000-4000-8000-000000000001'
         AND refresh_id = '65000000-0000-4000-8000-000000000030'),
      10
    );
    RAISE EXCEPTION 'required final Race receipt disappearance was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'required final Race receipt disappearance was accepted' THEN RAISE; END IF;
    IF position('complete sealed Race archive aggregate evidence is unavailable' in SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END
$final_seal$;

DO $privileges$
BEGIN
  IF NOT has_table_privilege(
    'dna_app_runtime',
    'dna.race_archive_prepublication_evidence_receipt',
    'SELECT'
  ) OR has_table_privilege(
    'dna_app_runtime',
    'dna.race_archive_prepublication_evidence_receipt',
    'INSERT,UPDATE,DELETE'
  ) THEN
    RAISE EXCEPTION 'pre-publication Race evidence table privileges are not least privileged';
  END IF;

  IF has_function_privilege(
    'dna_app_runtime',
    'dna.prepare_race_archive_prepublication_evidence(uuid,uuid,uuid,character,uuid,timestamp with time zone)',
    'EXECUTE'
  ) OR has_function_privilege(
    'dna_app_runtime',
    'dna.race_archive_prepublication_evidence_summary(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'private pre-publication helper privileges are too broad';
  END IF;
END
$privileges$;

ROLLBACK;

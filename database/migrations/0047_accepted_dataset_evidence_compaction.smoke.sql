BEGIN;

SET LOCAL app.owner_id = '47000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '47000000-0000-4000-8000-000000000001',
  'synthetic_accepted_evidence_compaction_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES (
  '47000000-0000-4000-8000-000000000101',
  '47000000-0000-4000-8000-000000000001',
  'race_merge', 'synthetic-race-merge.csv', repeat('1', 64),
  'utf_8', 'race-merge/v1', 'accepted',
  '2026-08-23T08:00:00Z', '2026-08-23T08:05:00Z',
  '2026-08-23T07:00:00Z', '2026-08-23T07:01:00Z',
  '2026-08-23T07:01:00Z', 2, 2, 0, 0
);

INSERT INTO dna.dataset_staged_record (
  owner_id, import_batch_id, source_row_number, natural_key,
  fingerprint_sha256, status
)
VALUES
  (
    '47000000-0000-4000-8000-000000000001',
    '47000000-0000-4000-8000-000000000101',
    1, 'race-1', repeat('2', 64), 'ready'
  ),
  (
    '47000000-0000-4000-8000-000000000001',
    '47000000-0000-4000-8000-000000000101',
    2, 'race-2', repeat('3', 64), 'ready'
  );

INSERT INTO dna.dataset_record_contribution (
  owner_id, source_type, natural_key, import_batch_id, fingerprint_sha256
)
VALUES
  (
    '47000000-0000-4000-8000-000000000001',
    'race_merge', 'race-1',
    '47000000-0000-4000-8000-000000000101', repeat('2', 64)
  ),
  (
    '47000000-0000-4000-8000-000000000001',
    'race_merge', 'race-2',
    '47000000-0000-4000-8000-000000000101', repeat('3', 64)
  );

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, is_active
)
VALUES (
  '47000000-0000-4000-8000-000000000201',
  '47000000-0000-4000-8000-000000000001',
  'race_merge', 1,
  '47000000-0000-4000-8000-000000000101',
  '2026-08-23T08:06:00Z', '2026-08-23T07:01:00Z', true
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status
)
VALUES (
  '47000000-0000-4000-8000-000000000301',
  '47000000-0000-4000-8000-000000000001',
  '47000000-0000-4000-8000-000000000201', 'queued'
);

SELECT * FROM dna.register_dataset_evidence_object(
  '47000000-0000-4000-8000-000000000001',
  '47000000-0000-4000-8000-000000000101',
  'race_merge', 'normalized_partition', 0, 'ndjson_gzip',
  'owners/47000000-0000-4000-8000-000000000001/evidence/accepted-part-0000.ndjson.gz',
  repeat('4', 64), 512, 2, 'race-1', 'race-2',
  '2026-08-23T08:04:00Z'
);

DO $compaction_assertions$
DECLARE
  v_result record;
  v_replay record;
  v_wrong_owner_blocked boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM dna.compact_accepted_dataset_evidence(
      '47000000-0000-4000-8000-000000000999',
      '47000000-0000-4000-8000-000000000101',
      '2026-08-23T08:07:00Z'
    );
  EXCEPTION WHEN OTHERS THEN
    v_wrong_owner_blocked :=
      SQLERRM = 'owner-scoped accepted evidence compaction denied';
  END;

  IF NOT v_wrong_owner_blocked THEN
    RAISE EXCEPTION 'accepted evidence compaction did not enforce owner scope';
  END IF;

  SELECT * INTO STRICT v_result
  FROM dna.compact_accepted_dataset_evidence(
    '47000000-0000-4000-8000-000000000001',
    '47000000-0000-4000-8000-000000000101',
    '2026-08-23T08:07:00Z'
  );

  IF v_result.status <> 'compacted'
     OR v_result.deleted_staged_record_count <> 2
     OR v_result.deleted_contribution_count <> 2 THEN
    RAISE EXCEPTION 'accepted evidence compaction counts are incorrect';
  END IF;

  SELECT * INTO STRICT v_replay
  FROM dna.compact_accepted_dataset_evidence(
    '47000000-0000-4000-8000-000000000001',
    '47000000-0000-4000-8000-000000000101',
    '2026-08-23T08:08:00Z'
  );

  IF v_replay.status <> 'existing'
     OR v_replay.deleted_staged_record_count <> 2
     OR v_replay.deleted_contribution_count <> 2 THEN
    RAISE EXCEPTION 'accepted evidence compaction replay is not idempotent';
  END IF;
END
$compaction_assertions$;

DO $retention_assertions$
BEGIN
  IF (
    SELECT count(*) FROM dna.dataset_staged_record
    WHERE owner_id = '47000000-0000-4000-8000-000000000001'
      AND import_batch_id = '47000000-0000-4000-8000-000000000101'
  ) <> 0
  OR (
    SELECT count(*) FROM dna.dataset_record_contribution
    WHERE owner_id = '47000000-0000-4000-8000-000000000001'
      AND import_batch_id = '47000000-0000-4000-8000-000000000101'
  ) <> 0
  OR (
    SELECT count(*) FROM dna.import_batch
    WHERE owner_id = '47000000-0000-4000-8000-000000000001'
      AND id = '47000000-0000-4000-8000-000000000101'
      AND status = 'accepted'
  ) <> 1
  OR (
    SELECT count(*) FROM dna.dataset_version
    WHERE owner_id = '47000000-0000-4000-8000-000000000001'
      AND import_batch_id = '47000000-0000-4000-8000-000000000101'
      AND is_active
  ) <> 1
  OR (
    SELECT count(*) FROM dna.aggregate_refresh_job
    WHERE owner_id = '47000000-0000-4000-8000-000000000001'
      AND dataset_version_id = '47000000-0000-4000-8000-000000000201'
      AND status = 'queued'
  ) <> 1
  OR (
    SELECT count(*) FROM dna.dataset_evidence_object
    WHERE owner_id = '47000000-0000-4000-8000-000000000001'
      AND import_batch_id = '47000000-0000-4000-8000-000000000101'
      AND object_kind = 'normalized_partition'
      AND row_count = 2
  ) <> 1
  OR (
    SELECT count(*) FROM dna.dataset_evidence_compaction_receipt
    WHERE owner_id = '47000000-0000-4000-8000-000000000001'
      AND import_batch_id = '47000000-0000-4000-8000-000000000101'
      AND source_row_count = 2
      AND evidence_row_count = 2
      AND deleted_staged_record_count = 2
      AND deleted_contribution_count = 2
  ) <> 1 THEN
    RAISE EXCEPTION 'accepted evidence compaction removed durable state';
  END IF;
END
$retention_assertions$;

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES (
  '47000000-0000-4000-8000-000000000102',
  '47000000-0000-4000-8000-000000000001',
  'core_details', 'synthetic-core-details.csv', repeat('5', 64),
  'utf_8', 'core-details/v1', 'accepted',
  '2026-08-23T08:10:00Z', '2026-08-23T08:11:00Z',
  2, 2, 0, 0
);

INSERT INTO dna.dataset_staged_record (
  owner_id, import_batch_id, source_row_number, natural_key,
  fingerprint_sha256, status
)
VALUES (
  '47000000-0000-4000-8000-000000000001',
  '47000000-0000-4000-8000-000000000102',
  1, 'core-1', repeat('6', 64), 'ready'
);

INSERT INTO dna.dataset_record_contribution (
  owner_id, source_type, natural_key, import_batch_id, fingerprint_sha256
)
VALUES (
  '47000000-0000-4000-8000-000000000001',
  'core_details', 'core-1',
  '47000000-0000-4000-8000-000000000102', repeat('6', 64)
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, is_active
)
VALUES (
  '47000000-0000-4000-8000-000000000202',
  '47000000-0000-4000-8000-000000000001',
  'core_details', 1,
  '47000000-0000-4000-8000-000000000102',
  '2026-08-23T08:12:00Z', true
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status
)
VALUES (
  '47000000-0000-4000-8000-000000000302',
  '47000000-0000-4000-8000-000000000001',
  '47000000-0000-4000-8000-000000000202', 'queued'
);

SELECT * FROM dna.register_dataset_evidence_object(
  '47000000-0000-4000-8000-000000000001',
  '47000000-0000-4000-8000-000000000102',
  'core_details', 'normalized_partition', 0, 'ndjson_gzip',
  'owners/47000000-0000-4000-8000-000000000001/evidence/mismatch-part-0000.ndjson.gz',
  repeat('7', 64), 256, 1, 'core-1', 'core-1',
  '2026-08-23T08:11:30Z'
);

DO $coverage_assertions$
DECLARE
  v_coverage_blocked boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM dna.compact_accepted_dataset_evidence(
      '47000000-0000-4000-8000-000000000001',
      '47000000-0000-4000-8000-000000000102',
      '2026-08-23T08:13:00Z'
    );
  EXCEPTION WHEN OTHERS THEN
    v_coverage_blocked :=
      SQLERRM = 'normalized evidence coverage does not match accepted source rows';
  END;

  IF NOT v_coverage_blocked
     OR (
       SELECT count(*) FROM dna.dataset_staged_record
       WHERE owner_id = '47000000-0000-4000-8000-000000000001'
         AND import_batch_id = '47000000-0000-4000-8000-000000000102'
     ) <> 1
     OR (
       SELECT count(*) FROM dna.dataset_record_contribution
       WHERE owner_id = '47000000-0000-4000-8000-000000000001'
         AND import_batch_id = '47000000-0000-4000-8000-000000000102'
     ) <> 1
     OR EXISTS (
       SELECT 1 FROM dna.dataset_evidence_compaction_receipt
       WHERE owner_id = '47000000-0000-4000-8000-000000000001'
         AND import_batch_id = '47000000-0000-4000-8000-000000000102'
     ) THEN
    RAISE EXCEPTION 'accepted evidence coverage mismatch did not fail closed';
  END IF;
END
$coverage_assertions$;

DO $security_assertions$
BEGIN
  IF NOT has_table_privilege(
    'dna_app_runtime', 'dna.dataset_evidence_compaction_receipt', 'SELECT'
  )
  OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.compact_accepted_dataset_evidence(uuid,uuid,timestamp with time zone)',
    'EXECUTE'
  )
  OR has_table_privilege(
    'dna_app_runtime', 'dna.dataset_staged_record', 'DELETE'
  )
  OR has_table_privilege(
    'dna_app_runtime', 'dna.dataset_record_contribution', 'DELETE'
  )
  OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) privilege
    WHERE routine.oid =
      'dna.compact_accepted_dataset_evidence(uuid,uuid,timestamp with time zone)'::regprocedure
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'accepted evidence compaction security boundary is unsafe';
  END IF;
END
$security_assertions$;

ROLLBACK;

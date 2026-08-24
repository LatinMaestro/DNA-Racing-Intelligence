BEGIN;

SET LOCAL app.owner_id = '49000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '49000000-0000-4000-8000-000000000001',
  'synthetic_staged_evidence_compaction_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES
  (
    '49000000-0000-4000-8000-000000000101',
    '49000000-0000-4000-8000-000000000001',
    'core_details', 'Core Details.csv', repeat('1', 64),
    'utf_8', 'core-details/v1', 'accepted',
    '2026-08-23T10:00:00Z', '2026-08-23T10:01:00Z',
    2, 2, 0, 0
  ),
  (
    '49000000-0000-4000-8000-000000000102',
    '49000000-0000-4000-8000-000000000001',
    'current_arena', 'Current Arena.csv', repeat('2', 64),
    'utf_8', 'current-arena/v1', 'accepted',
    '2026-08-23T10:02:00Z', '2026-08-23T10:03:00Z',
    2, 2, 0, 0
  );

INSERT INTO dna.dataset_staged_record (
  owner_id, import_batch_id, source_row_number, natural_key,
  fingerprint_sha256, status
)
VALUES
  (
    '49000000-0000-4000-8000-000000000001',
    '49000000-0000-4000-8000-000000000101',
    1, 'core-1', repeat('3', 64), 'ready'
  ),
  (
    '49000000-0000-4000-8000-000000000001',
    '49000000-0000-4000-8000-000000000101',
    2, 'core-2', repeat('4', 64), 'ready'
  ),
  (
    '49000000-0000-4000-8000-000000000001',
    '49000000-0000-4000-8000-000000000102',
    1, 'arena-1', repeat('5', 64), 'ready'
  );

INSERT INTO dna.dataset_record_contribution (
  owner_id, source_type, natural_key, import_batch_id, fingerprint_sha256
)
VALUES
  (
    '49000000-0000-4000-8000-000000000001',
    'core_details', 'core-1',
    '49000000-0000-4000-8000-000000000101', repeat('3', 64)
  ),
  (
    '49000000-0000-4000-8000-000000000001',
    'core_details', 'core-2',
    '49000000-0000-4000-8000-000000000101', repeat('4', 64)
  ),
  (
    '49000000-0000-4000-8000-000000000001',
    'current_arena', 'arena-1',
    '49000000-0000-4000-8000-000000000102', repeat('5', 64)
  );

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, is_active
)
VALUES
  (
    '49000000-0000-4000-8000-000000000201',
    '49000000-0000-4000-8000-000000000001',
    'core_details', 1,
    '49000000-0000-4000-8000-000000000101',
    '2026-08-23T10:04:00Z', true
  ),
  (
    '49000000-0000-4000-8000-000000000202',
    '49000000-0000-4000-8000-000000000001',
    'current_arena', 1,
    '49000000-0000-4000-8000-000000000102',
    '2026-08-23T10:05:00Z', true
  );

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status
)
VALUES
  (
    '49000000-0000-4000-8000-000000000301',
    '49000000-0000-4000-8000-000000000001',
    '49000000-0000-4000-8000-000000000201', 'queued'
  ),
  (
    '49000000-0000-4000-8000-000000000302',
    '49000000-0000-4000-8000-000000000001',
    '49000000-0000-4000-8000-000000000202', 'queued'
  );

SELECT * FROM dna.register_dataset_evidence_object(
  '49000000-0000-4000-8000-000000000001',
  '49000000-0000-4000-8000-000000000101',
  'core_details', 'staged_rows', 0, 'ndjson_gzip',
  'owners/49000000-0000-4000-8000-000000000001/evidence/staged-complete.ndjson.gz',
  repeat('6', 64), 512, 2, 'core-1', 'core-2',
  '2026-08-23T10:01:30Z'
);

SELECT * FROM dna.register_dataset_evidence_object(
  '49000000-0000-4000-8000-000000000001',
  '49000000-0000-4000-8000-000000000102',
  'current_arena', 'staged_rows', 0, 'ndjson_gzip',
  'owners/49000000-0000-4000-8000-000000000001/evidence/staged-incomplete.ndjson.gz',
  repeat('7', 64), 256, 1, 'arena-1', 'arena-1',
  '2026-08-23T10:03:30Z'
);

DO $staged_coverage_assertions$
DECLARE
  v_result record;
  v_replay record;
  v_mismatch_blocked boolean := false;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.compact_accepted_dataset_evidence(
    '49000000-0000-4000-8000-000000000001',
    '49000000-0000-4000-8000-000000000101',
    '2026-08-23T10:06:00Z'
  );
  IF v_result.status <> 'compacted'
     OR v_result.deleted_staged_record_count <> 2
     OR v_result.deleted_contribution_count <> 2 THEN
    RAISE EXCEPTION 'complete staged evidence did not compact exactly';
  END IF;

  SELECT * INTO STRICT v_replay
  FROM dna.compact_accepted_dataset_evidence(
    '49000000-0000-4000-8000-000000000001',
    '49000000-0000-4000-8000-000000000101',
    '2026-08-23T10:07:00Z'
  );
  IF v_replay.status <> 'existing'
     OR v_replay.deleted_staged_record_count <> 2
     OR v_replay.deleted_contribution_count <> 2 THEN
    RAISE EXCEPTION 'staged evidence compaction replay is not stable';
  END IF;

  BEGIN
    PERFORM * FROM dna.compact_accepted_dataset_evidence(
      '49000000-0000-4000-8000-000000000001',
      '49000000-0000-4000-8000-000000000102',
      '2026-08-23T10:08:00Z'
    );
  EXCEPTION WHEN OTHERS THEN
    v_mismatch_blocked :=
      SQLERRM = 'accepted evidence coverage does not match source rows';
  END;

  IF NOT v_mismatch_blocked
     OR NOT EXISTS (
       SELECT 1 FROM dna.dataset_staged_record
       WHERE owner_id = '49000000-0000-4000-8000-000000000001'
         AND import_batch_id = '49000000-0000-4000-8000-000000000102'
     )
     OR EXISTS (
       SELECT 1 FROM dna.dataset_evidence_compaction_receipt
       WHERE owner_id = '49000000-0000-4000-8000-000000000001'
         AND import_batch_id = '49000000-0000-4000-8000-000000000102'
     ) THEN
    RAISE EXCEPTION 'incomplete staged evidence did not fail closed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.dataset_evidence_object
    WHERE owner_id = '49000000-0000-4000-8000-000000000001'
      AND import_batch_id = '49000000-0000-4000-8000-000000000101'
      AND object_kind = 'staged_rows'
      AND row_count = 2
  )
  OR NOT EXISTS (
    SELECT 1 FROM dna.dataset_evidence_compaction_receipt
    WHERE owner_id = '49000000-0000-4000-8000-000000000001'
      AND import_batch_id = '49000000-0000-4000-8000-000000000101'
      AND source_row_count = 2
      AND evidence_row_count = 2
  ) THEN
    RAISE EXCEPTION 'durable staged evidence was not retained';
  END IF;
END
$staged_coverage_assertions$;

DO $security_assertions$
BEGIN
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.compact_accepted_dataset_evidence(uuid,uuid,timestamp with time zone)',
    'EXECUTE'
  )
  OR has_table_privilege(
    'dna_app_runtime', 'dna.dataset_staged_record', 'DELETE'
  )
  OR has_table_privilege(
    'dna_app_runtime', 'dna.dataset_record_contribution', 'DELETE'
  ) THEN
    RAISE EXCEPTION 'staged evidence compaction security boundary is unsafe';
  END IF;
END
$security_assertions$;

ROLLBACK;

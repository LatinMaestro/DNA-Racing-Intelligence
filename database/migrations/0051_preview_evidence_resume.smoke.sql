BEGIN;

SET LOCAL app.owner_id = '51000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '51000000-0000-4000-8000-000000000001',
  'synthetic_preview_evidence_resume_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES
  (
    '51000000-0000-4000-8000-000000000101',
    '51000000-0000-4000-8000-000000000001',
    'core_details', 'Core Details.csv', repeat('1', 64),
    'utf_8', 'core-details/v1', 'validating', '2026-08-24T00:00:00Z',
    1, 1, 0, 0
  ),
  (
    '51000000-0000-4000-8000-000000000102',
    '51000000-0000-4000-8000-000000000001',
    'current_arena', 'Current Arena.csv', repeat('2', 64),
    'utf_8', 'current-arena/v1', 'validating', '2026-08-24T00:00:00Z',
    1, 1, 0, 0
  );

DO $record_receipts$
DECLARE
  v_count integer;
BEGIN
  SELECT dna.record_import_preview_evidence_receipts(
    '51000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000101',
    jsonb_build_array(jsonb_build_object(
      'ownerId', 'synthetic_preview_evidence_resume_owner',
      'importBatchId', '51000000-0000-4000-8000-000000000101',
      'sourceType', 'core_details',
      'objectKind', 'staged_rows',
      'partitionNumber', 0,
      'objectFormat', 'ndjson_gzip',
      'objectKey', 'evidence/synthetic/core/staged_rows/part-0000.ndjson.gz',
      'checksumSha256', repeat('3', 64),
      'byteSize', 100,
      'rowCount', 1,
      'firstNaturalKey', 'core-1',
      'lastNaturalKey', 'core-1',
      'createdAt', '2026-08-24T00:00:01Z'
    ))
  ) INTO v_count;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'core evidence receipt was not recorded';
  END IF;

  SELECT dna.record_import_preview_evidence_receipts(
    '51000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000102',
    jsonb_build_array(jsonb_build_object(
      'ownerId', 'synthetic_preview_evidence_resume_owner',
      'importBatchId', '51000000-0000-4000-8000-000000000102',
      'sourceType', 'current_arena',
      'objectKind', 'staged_rows',
      'partitionNumber', 0,
      'objectFormat', 'ndjson_gzip',
      'objectKey', 'evidence/synthetic/arena/staged_rows/part-0000.ndjson.gz',
      'checksumSha256', repeat('4', 64),
      'byteSize', 110,
      'rowCount', 1,
      'firstNaturalKey', 'core-2',
      'lastNaturalKey', 'core-2',
      'createdAt', '2026-08-24T00:00:02Z'
    ))
  ) INTO v_count;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'arena evidence receipt was not recorded';
  END IF;
END
$record_receipts$;

DO $finalize_receipts$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.finalize_import_preview_evidence_receipts(
    '51000000-0000-4000-8000-000000000001',
    ARRAY[
      '51000000-0000-4000-8000-000000000101'::uuid,
      '51000000-0000-4000-8000-000000000102'::uuid
    ],
    '2026-08-24T00:01:00Z'
  );
  IF v_result.staged_batch_count <> 2
     OR v_result.receipt_count <> 2
     OR v_result.registered_manifest_count <> 2 THEN
    RAISE EXCEPTION 'Preview evidence finalization counts are invalid';
  END IF;

  SELECT * INTO STRICT v_result
  FROM dna.finalize_import_preview_evidence_receipts(
    '51000000-0000-4000-8000-000000000001',
    ARRAY[
      '51000000-0000-4000-8000-000000000101'::uuid,
      '51000000-0000-4000-8000-000000000102'::uuid
    ],
    '2026-08-24T00:02:00Z'
  );
  IF v_result.registered_manifest_count <> 2 THEN
    RAISE EXCEPTION 'Preview evidence finalization replay is not idempotent';
  END IF;
END
$finalize_receipts$;

DO $assertions$
BEGIN
  IF (
    SELECT count(*)
    FROM dna.dataset_evidence_object
    WHERE owner_id = '51000000-0000-4000-8000-000000000001'
      AND object_kind = 'staged_rows'
  ) <> 2 THEN
    RAISE EXCEPTION 'Preview evidence manifests were not materialized';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.import_preview_evidence_receipt
    WHERE owner_id = '51000000-0000-4000-8000-000000000001'
      AND registered_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Preview evidence receipts were not marked registered';
  END IF;
END
$assertions$;

DO $conflict_guard$
BEGIN
  BEGIN
    PERFORM dna.record_import_preview_evidence_receipts(
      '51000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000101',
      jsonb_build_array(jsonb_build_object(
        'ownerId', 'synthetic_preview_evidence_resume_owner',
        'importBatchId', '51000000-0000-4000-8000-000000000101',
        'sourceType', 'core_details',
        'objectKind', 'staged_rows',
        'partitionNumber', 0,
        'objectFormat', 'ndjson_gzip',
        'objectKey', 'evidence/synthetic/core/staged_rows/part-0000.ndjson.gz',
        'checksumSha256', repeat('9', 64),
        'byteSize', 100,
        'rowCount', 1,
        'firstNaturalKey', 'core-1',
        'lastNaturalKey', 'core-1',
        'createdAt', '2026-08-24T00:00:01Z'
      ))
    );
    RAISE EXCEPTION 'Preview evidence receipt conflict was not rejected';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Preview evidence receipt conflict was not rejected' THEN
        RAISE;
      END IF;
  END;
END
$conflict_guard$;

ROLLBACK;

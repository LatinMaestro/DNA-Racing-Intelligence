BEGIN;

SET LOCAL app.owner_id = '52000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '52000000-0000-4000-8000-000000000001',
  'synthetic_preview_identity_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES (
  '52000000-0000-4000-8000-000000000101',
  '52000000-0000-4000-8000-000000000001',
  'core_details', 'Core Details.csv', repeat('1', 64),
  'utf_8', 'core-details/v1', 'validating', '2026-08-24T00:00:00Z',
  1, 1, 0, 0
);

DO $authenticated_identity$
DECLARE
  v_count integer;
BEGIN
  SELECT dna.record_import_preview_evidence_receipts(
    '52000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000101',
    jsonb_build_array(jsonb_build_object(
      'ownerId', 'synthetic_preview_identity_owner',
      'importBatchId', '52000000-0000-4000-8000-000000000101',
      'sourceType', 'core_details',
      'objectKind', 'staged_rows',
      'partitionNumber', 0,
      'objectFormat', 'ndjson_gzip',
      'objectKey', 'evidence/synthetic/identity/staged_rows/part-0000.ndjson.gz',
      'checksumSha256', repeat('2', 64),
      'byteSize', 100,
      'rowCount', 1,
      'firstNaturalKey', 'core-identity-1',
      'lastNaturalKey', 'core-identity-1',
      'createdAt', '2026-08-24T00:00:01Z'
    ))
  ) INTO v_count;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'authenticated Preview evidence identity was not accepted';
  END IF;
END
$authenticated_identity$;

DO $database_identity_rejected$
BEGIN
  BEGIN
    PERFORM dna.record_import_preview_evidence_receipts(
      '52000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000101',
      jsonb_build_array(jsonb_build_object(
        'ownerId', '52000000-0000-4000-8000-000000000001',
        'importBatchId', '52000000-0000-4000-8000-000000000101',
        'sourceType', 'core_details',
        'objectKind', 'staged_rows',
        'partitionNumber', 1,
        'objectFormat', 'ndjson_gzip',
        'objectKey', 'evidence/synthetic/identity/staged_rows/part-0001.ndjson.gz',
        'checksumSha256', repeat('3', 64),
        'byteSize', 100,
        'rowCount', 1,
        'firstNaturalKey', 'core-identity-2',
        'lastNaturalKey', 'core-identity-2',
        'createdAt', '2026-08-24T00:00:02Z'
      ))
    );
    RAISE EXCEPTION 'database owner UUID was incorrectly accepted as authenticated owner identity';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'database owner UUID was incorrectly accepted as authenticated owner identity' THEN
        RAISE;
      END IF;
  END;
END
$database_identity_rejected$;

DO $wrong_authenticated_identity_rejected$
BEGIN
  BEGIN
    PERFORM dna.record_import_preview_evidence_receipts(
      '52000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000101',
      jsonb_build_array(jsonb_build_object(
        'ownerId', 'synthetic_other_owner',
        'importBatchId', '52000000-0000-4000-8000-000000000101',
        'sourceType', 'core_details',
        'objectKind', 'staged_rows',
        'partitionNumber', 1,
        'objectFormat', 'ndjson_gzip',
        'objectKey', 'evidence/synthetic/identity/staged_rows/part-0001.ndjson.gz',
        'checksumSha256', repeat('3', 64),
        'byteSize', 100,
        'rowCount', 1,
        'firstNaturalKey', 'core-identity-2',
        'lastNaturalKey', 'core-identity-2',
        'createdAt', '2026-08-24T00:00:02Z'
      ))
    );
    RAISE EXCEPTION 'wrong authenticated owner identity was not rejected';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'wrong authenticated owner identity was not rejected' THEN
        RAISE;
      END IF;
  END;
END
$wrong_authenticated_identity_rejected$;

ROLLBACK;

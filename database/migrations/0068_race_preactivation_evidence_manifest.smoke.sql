BEGIN;

SET LOCAL app.owner_id = '68000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('68000000-0000-4000-8000-000000000001', 'synthetic_race_preactivation_owner'),
  ('68000000-0000-4000-8000-000000000002', 'synthetic_other_owner');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES (
  '68000000-0000-4000-8000-000000000101',
  '68000000-0000-4000-8000-000000000001',
  'race_merge', 'Race Merge.csv', repeat('1', 64),
  'utf_8', 'race-merge/v1', 'validating', '2026-08-26T00:00:00Z',
  3, 2, 1, 1
);

INSERT INTO dna.import_preview_evidence_receipt (
  owner_id, import_batch_id, source_type, object_kind, partition_number,
  object_format, object_key, checksum_sha256, byte_size, row_count,
  first_natural_key, last_natural_key, object_created_at, registered_at
)
VALUES
  (
    '68000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000101',
    'race_merge', 'staged_rows', 0, 'ndjson_gzip',
    'evidence/synthetic/race/staged_rows/part-0000.ndjson.gz',
    repeat('a', 64), 100, 2,
    'event-1:core-1', 'event-2:core-2',
    '2026-08-26T00:00:01Z', '2026-08-26T00:01:00Z'
  ),
  (
    '68000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000101',
    'race_merge', 'staged_rows', 1, 'ndjson_gzip',
    'evidence/synthetic/race/staged_rows/part-0001.ndjson.gz',
    repeat('b', 64), 120, 1,
    'event-3:core-3', 'event-3:core-3',
    '2026-08-26T00:00:02Z', '2026-08-26T00:01:00Z'
  );

INSERT INTO dna.dataset_evidence_object (
  id, owner_id, import_batch_id, source_type, object_kind,
  partition_number, object_format, object_key, checksum_sha256,
  byte_size, row_count, first_natural_key, last_natural_key, created_at
)
VALUES
  (
    '68000000-0000-4000-8000-000000000201',
    '68000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000101',
    'race_merge', 'staged_rows', 0, 'ndjson_gzip',
    'evidence/synthetic/race/staged_rows/part-0000.ndjson.gz',
    repeat('a', 64), 100, 2,
    'event-1:core-1', 'event-2:core-2', '2026-08-26T00:00:01Z'
  ),
  (
    '68000000-0000-4000-8000-000000000202',
    '68000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000101',
    'race_merge', 'staged_rows', 1, 'ndjson_gzip',
    'evidence/synthetic/race/staged_rows/part-0001.ndjson.gz',
    repeat('b', 64), 120, 1,
    'event-3:core-3', 'event-3:core-3', '2026-08-26T00:00:02Z'
  );

DO $positive$
DECLARE
  v_count integer;
  v_rows bigint;
  v_bytes bigint;
  v_min integer;
  v_max integer;
BEGIN
  SELECT count(*)::integer, sum(row_count), max(evidence_byte_size),
    min(partition_number), max(partition_number)
  INTO v_count, v_rows, v_bytes, v_min, v_max
  FROM dna.list_race_preactivation_evidence_manifest(
    '68000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000101',
    10
  );

  IF v_count <> 2 OR v_rows <> 3 OR v_bytes <> 220
     OR v_min <> 0 OR v_max <> 1 THEN
    RAISE EXCEPTION 'Race preactivation evidence manifest is incorrect';
  END IF;
END
$positive$;

DO $bound_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.list_race_preactivation_evidence_manifest(
      '68000000-0000-4000-8000-000000000001',
      '68000000-0000-4000-8000-000000000101',
      1
    );
    RAISE EXCEPTION 'Race preactivation partition bound was not enforced';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Race preactivation partition bound was not enforced' THEN
        RAISE;
      END IF;
  END;
END
$bound_guard$;

UPDATE dna.import_preview_evidence_receipt
SET registered_at = NULL
WHERE owner_id = '68000000-0000-4000-8000-000000000001'
  AND import_batch_id = '68000000-0000-4000-8000-000000000101'
  AND partition_number = 1;

DO $registration_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.list_race_preactivation_evidence_manifest(
      '68000000-0000-4000-8000-000000000001',
      '68000000-0000-4000-8000-000000000101',
      10
    );
    RAISE EXCEPTION 'unregistered Race preactivation evidence was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'unregistered Race preactivation evidence was accepted' THEN
        RAISE;
      END IF;
  END;
END
$registration_guard$;

UPDATE dna.import_preview_evidence_receipt
SET registered_at = '2026-08-26T00:01:00Z'
WHERE owner_id = '68000000-0000-4000-8000-000000000001'
  AND import_batch_id = '68000000-0000-4000-8000-000000000101'
  AND partition_number = 1;

UPDATE dna.dataset_evidence_object
SET checksum_sha256 = repeat('c', 64)
WHERE owner_id = '68000000-0000-4000-8000-000000000001'
  AND import_batch_id = '68000000-0000-4000-8000-000000000101'
  AND object_kind = 'staged_rows'
  AND partition_number = 1;

DO $drift_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.list_race_preactivation_evidence_manifest(
      '68000000-0000-4000-8000-000000000001',
      '68000000-0000-4000-8000-000000000101',
      10
    );
    RAISE EXCEPTION 'Race preactivation manifest drift was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Race preactivation manifest drift was accepted' THEN
        RAISE;
      END IF;
  END;
END
$drift_guard$;

UPDATE dna.dataset_evidence_object
SET checksum_sha256 = repeat('b', 64)
WHERE owner_id = '68000000-0000-4000-8000-000000000001'
  AND import_batch_id = '68000000-0000-4000-8000-000000000101'
  AND object_kind = 'staged_rows'
  AND partition_number = 1;

INSERT INTO dna.dataset_evidence_object (
  id, owner_id, import_batch_id, source_type, object_kind,
  partition_number, object_format, object_key, checksum_sha256,
  byte_size, row_count, first_natural_key, last_natural_key, created_at
) VALUES (
  '68000000-0000-4000-8000-000000000203',
  '68000000-0000-4000-8000-000000000001',
  '68000000-0000-4000-8000-000000000101',
  'race_merge', 'accepted_contributions', 0, 'ndjson_gzip',
  'evidence/synthetic/race/accepted_contributions/part-0000.ndjson.gz',
  repeat('d', 64), 10, 1,
  'event-1:core-1', 'event-1:core-1', '2026-08-26T00:02:00Z'
);

DO $ambiguity_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.list_race_preactivation_evidence_manifest(
      '68000000-0000-4000-8000-000000000001',
      '68000000-0000-4000-8000-000000000101',
      10
    );
    RAISE EXCEPTION 'ambiguous Race preactivation evidence was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ambiguous Race preactivation evidence was accepted' THEN
        RAISE;
      END IF;
  END;
END
$ambiguity_guard$;

DELETE FROM dna.dataset_evidence_object
WHERE owner_id = '68000000-0000-4000-8000-000000000001'
  AND import_batch_id = '68000000-0000-4000-8000-000000000101'
  AND object_kind = 'accepted_contributions';

SET LOCAL app.owner_id = '68000000-0000-4000-8000-000000000002';

DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.list_race_preactivation_evidence_manifest(
      '68000000-0000-4000-8000-000000000001',
      '68000000-0000-4000-8000-000000000101',
      10
    );
    RAISE EXCEPTION 'cross-owner Race preactivation evidence was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-owner Race preactivation evidence was accepted' THEN
        RAISE;
      END IF;
  END;
END
$owner_guard$;

ROLLBACK;

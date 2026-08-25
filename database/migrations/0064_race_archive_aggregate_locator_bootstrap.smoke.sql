BEGIN;

SET LOCAL app.owner_id = '64000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES ('64000000-0000-4000-8000-000000000001', 'race-archive-bootstrap-owner');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES
(
  '64000000-0000-4000-8000-000000000010',
  '64000000-0000-4000-8000-000000000001',
  'race_merge', 'race-bootstrap-1.csv', repeat('a',64), 'utf_8', 'race_merge_v1',
  'accepted', '2026-08-25T13:00:00Z', '2026-08-25T13:01:00Z',
  '2026-08-20T00:00:00Z', '2026-08-20T23:00:00Z',
  '2026-08-20T23:00:00Z', 1, 1, 0, 0
),
(
  '64000000-0000-4000-8000-000000000011',
  '64000000-0000-4000-8000-000000000001',
  'race_merge', 'race-bootstrap-2.csv', repeat('b',64), 'utf_8', 'race_merge_v1',
  'accepted', '2026-08-25T14:00:00Z', '2026-08-25T14:01:00Z',
  '2026-08-21T00:00:00Z', '2026-08-21T23:00:00Z',
  '2026-08-21T23:00:00Z', 1, 1, 0, 0
);

INSERT INTO dna.dataset_evidence_object (
  id, owner_id, import_batch_id, source_type, object_kind,
  partition_number, object_format, object_key, checksum_sha256,
  byte_size, row_count, first_natural_key, last_natural_key, created_at
) VALUES
(
  '64000000-0000-4000-8000-000000000040',
  '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000010', 'race_merge', 'staged_rows',
  0, 'ndjson_gzip', 'synthetic/bootstrap/race-1/part-0.ndjson.gz', repeat('1',64),
  100, 1, NULL, NULL, '2026-08-25T13:02:00Z'
),
(
  '64000000-0000-4000-8000-000000000041',
  '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000011', 'race_merge', 'staged_rows',
  0, 'ndjson_gzip', 'synthetic/bootstrap/race-2/part-0.ndjson.gz', repeat('2',64),
  100, 1, NULL, NULL, '2026-08-25T14:02:00Z'
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES
(
  '64000000-0000-4000-8000-000000000020',
  '64000000-0000-4000-8000-000000000001', 'race_merge', 1,
  '64000000-0000-4000-8000-000000000010',
  '2026-08-25T13:03:00Z', '2026-08-20T23:00:00Z', NULL, false
),
(
  '64000000-0000-4000-8000-000000000021',
  '64000000-0000-4000-8000-000000000001', 'race_merge', 2,
  '64000000-0000-4000-8000-000000000011',
  '2026-08-25T14:03:00Z', '2026-08-21T23:00:00Z', NULL, true
);

INSERT INTO dna.dataset_version_evidence_receipt (
  owner_id, dataset_version_id, import_batch_id, source_type, evidence_kind,
  evidence_partition_count, evidence_row_count, evidence_byte_size, sealed_at
) VALUES
(
  '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000020',
  '64000000-0000-4000-8000-000000000010', 'race_merge', 'staged_rows',
  1, 1, 100, '2026-08-25T13:04:00Z'
),
(
  '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000021',
  '64000000-0000-4000-8000-000000000011', 'race_merge', 'staged_rows',
  1, 1, 100, '2026-08-25T14:04:00Z'
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status
) VALUES (
  '64000000-0000-4000-8000-000000000030',
  '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000021', 'queued'
);

INSERT INTO dna.aggregate_refresh_processing (
  owner_id, refresh_id, dataset_version_id, worker_id, state,
  source_version_set_sha256, claimed_at, lease_expires_at
) VALUES (
  '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000030',
  '64000000-0000-4000-8000-000000000021',
  'race-archive-bootstrap-worker', 'processing',
  dna.active_pro_league_source_version_set_sha256(
    '64000000-0000-4000-8000-000000000001'
  ),
  '2026-08-25T14:05:00Z', '2099-08-25T14:05:00Z'
);

DO $bootstrap$
DECLARE
  v_hash character(64);
  v_versions bigint[];
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.race_archive_core_locator_receipt receipt
    WHERE receipt.owner_id = '64000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'locator bootstrap fixture unexpectedly has locator receipts';
  END IF;

  SELECT source_version_set_sha256 INTO STRICT v_hash
  FROM dna.aggregate_refresh_processing
  WHERE owner_id = '64000000-0000-4000-8000-000000000001'
    AND refresh_id = '64000000-0000-4000-8000-000000000030';

  SELECT array_agg(plan.version_number ORDER BY plan.version_number)
  INTO STRICT v_versions
  FROM dna.list_race_archive_aggregate_refresh_versions(
    '64000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000030',
    '64000000-0000-4000-8000-000000000021', v_hash, 10
  ) plan;

  IF v_versions <> ARRAY[1,2]::bigint[] THEN
    RAISE EXCEPTION 'sealed Race versions cannot bootstrap locator traversal';
  END IF;

  BEGIN
    PERFORM * FROM dna.list_race_archive_aggregate_refresh_versions(
      '64000000-0000-4000-8000-000000000001',
      '64000000-0000-4000-8000-000000000030',
      '64000000-0000-4000-8000-000000000021', v_hash, 1
    );
    RAISE EXCEPTION 'historical Race version bound was not enforced';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'historical Race version bound was not enforced' THEN RAISE; END IF;
    IF position('version count exceeds its bound' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM dna.dataset_version_evidence_receipt
    WHERE owner_id = '64000000-0000-4000-8000-000000000001'
      AND dataset_version_id = '64000000-0000-4000-8000-000000000020';
    PERFORM * FROM dna.list_race_archive_aggregate_refresh_versions(
      '64000000-0000-4000-8000-000000000001',
      '64000000-0000-4000-8000-000000000030',
      '64000000-0000-4000-8000-000000000021', v_hash, 10
    );
    RAISE EXCEPTION 'unsealed Race evidence was accepted during locator bootstrap';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unsealed Race evidence was accepted during locator bootstrap' THEN RAISE; END IF;
    IF position('complete sealed Race archive aggregate evidence is unavailable' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END
$bootstrap$;

ROLLBACK;

BEGIN;

SET LOCAL app.owner_id = '64000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES ('64000000-0000-4000-8000-000000000001', 'race-archive-total-partition-owner');

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
  'race_merge', 'race-1.csv', repeat('a',64), 'utf_8', 'race_merge_v1',
  'accepted', '2026-08-25T14:00:00Z', '2026-08-25T14:01:00Z',
  '2026-08-20T00:00:00Z', '2026-08-20T23:00:00Z',
  '2026-08-20T23:00:00Z', 1, 1, 0, 0
),
(
  '64000000-0000-4000-8000-000000000011',
  '64000000-0000-4000-8000-000000000001',
  'race_merge', 'race-2.csv', repeat('b',64), 'utf_8', 'race_merge_v1',
  'accepted', '2026-08-25T14:02:00Z', '2026-08-25T14:03:00Z',
  '2026-08-21T00:00:00Z', '2026-08-21T23:00:00Z',
  '2026-08-21T23:00:00Z', 1, 1, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES
(
  '64000000-0000-4000-8000-000000000020',
  '64000000-0000-4000-8000-000000000001', 'race_merge', 1,
  '64000000-0000-4000-8000-000000000010',
  '2026-08-25T14:01:30Z', '2026-08-20T23:00:00Z',
  '2026-08-25T14:01:45Z', false
),
(
  '64000000-0000-4000-8000-000000000021',
  '64000000-0000-4000-8000-000000000001', 'race_merge', 2,
  '64000000-0000-4000-8000-000000000011',
  '2026-08-25T14:03:30Z', '2026-08-21T23:00:00Z', NULL, true
);

INSERT INTO dna.dataset_version_evidence_receipt (
  owner_id, dataset_version_id, import_batch_id, source_type, evidence_kind,
  evidence_partition_count, evidence_row_count, evidence_byte_size, sealed_at
) VALUES
(
  '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000020',
  '64000000-0000-4000-8000-000000000010', 'race_merge', 'staged_rows',
  6000, 1, 100, '2026-08-25T14:01:50Z'
),
(
  '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000021',
  '64000000-0000-4000-8000-000000000011', 'race_merge', 'staged_rows',
  6000, 1, 100, '2026-08-25T14:03:50Z'
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
  'race-archive-partition-worker', 'processing',
  dna.active_pro_league_source_version_set_sha256(
    '64000000-0000-4000-8000-000000000001'
  ),
  '2026-08-25T14:04:00Z', '2099-08-25T14:04:00Z'
);

DO $bound$
DECLARE
  v_hash character(64);
  v_versions bigint[];
  v_locator_count bigint;
BEGIN
  SELECT count(*) INTO STRICT v_locator_count
  FROM dna.race_archive_core_locator_receipt
  WHERE owner_id = '64000000-0000-4000-8000-000000000001';
  IF v_locator_count <> 0 THEN
    RAISE EXCEPTION 'partition-bound smoke unexpectedly has Core locator receipts';
  END IF;

  SELECT source_version_set_sha256 INTO STRICT v_hash
  FROM dna.aggregate_refresh_processing
  WHERE owner_id = '64000000-0000-4000-8000-000000000001'
    AND refresh_id = '64000000-0000-4000-8000-000000000030';

  BEGIN
    PERFORM * FROM dna.list_race_archive_aggregate_refresh_versions(
      '64000000-0000-4000-8000-000000000001',
      '64000000-0000-4000-8000-000000000030',
      '64000000-0000-4000-8000-000000000021', v_hash, 10
    );
    RAISE EXCEPTION 'aggregate partition overflow was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'aggregate partition overflow was accepted' THEN RAISE; END IF;
    IF position('total partition count exceeds its bound' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  UPDATE dna.dataset_version_evidence_receipt
  SET evidence_partition_count = 4000
  WHERE owner_id = '64000000-0000-4000-8000-000000000001'
    AND dataset_version_id = '64000000-0000-4000-8000-000000000020';

  SELECT array_agg(plan.version_number ORDER BY plan.version_number)
  INTO STRICT v_versions
  FROM dna.list_race_archive_aggregate_refresh_versions(
    '64000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000030',
    '64000000-0000-4000-8000-000000000021', v_hash, 10
  ) plan;

  IF v_versions <> ARRAY[1,2]::bigint[] THEN
    RAISE EXCEPTION 'exact 10000-partition boundary did not preserve the ordered plan';
  END IF;
END
$bound$;

ROLLBACK;
BEGIN;

SET LOCAL app.owner_id = '54000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '54000000-0000-4000-8000-000000000001',
  'synthetic_race_identity_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  minimum_accepted_event_at, maximum_accepted_event_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES
  (
    '54000000-0000-4000-8000-000000000101',
    '54000000-0000-4000-8000-000000000001',
    'race_merge', 'race-identity-1.csv', repeat('1', 64),
    'utf_8', 'race-merge/v1', 'validating',
    '2026-08-24T11:00:00Z', '2026-08-24T10:00:00Z',
    '2026-08-24T10:00:00Z', 1, 0, 1, 0
  ),
  (
    '54000000-0000-4000-8000-000000000102',
    '54000000-0000-4000-8000-000000000001',
    'race_merge', 'race-identity-2.csv', repeat('2', 64),
    'utf_8', 'race-merge/v1', 'validating',
    '2026-08-24T12:00:00Z', '2026-08-24T10:00:00Z',
    '2026-08-24T10:00:00Z', 1, 0, 1, 0
  ),
  (
    '54000000-0000-4000-8000-000000000103',
    '54000000-0000-4000-8000-000000000001',
    'race_merge', 'race-identity-3.csv', repeat('3', 64),
    'utf_8', 'race-merge/v1', 'validating',
    '2026-08-24T13:00:00Z', '2026-08-24T10:00:00Z',
    '2026-08-24T10:00:00Z', 1, 0, 1, 0
  );

INSERT INTO dna.dataset_staged_record (
  owner_id, import_batch_id, source_row_number, natural_key,
  fingerprint_sha256, status, issue_codes
) VALUES
  (
    '54000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000101',
    1, 'identity-event:identity-core', repeat('a', 64), 'ready', '{}'
  ),
  (
    '54000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000102',
    1, 'identity-event:identity-core', repeat('a', 64), 'ready', '{}'
  ),
  (
    '54000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000103',
    1, 'identity-event:identity-core', repeat('a', 64), 'ready', '{}'
  );

INSERT INTO dna.normalized_race_staged_fact (
  owner_id, import_batch_id, source_row_number, source_event_id, event_at,
  mode, distance, source_core_id, gate_count, gold_star, blue_star,
  raw_gold_star, raw_blue_star, star_data_status, finish_position,
  elapsed_time_source_value
) VALUES
  (
    '54000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000101', 1,
    'identity-event', '2026-08-24T10:00:00Z', 'bike', 1000,
    'identity-core', 4, true, false, 'TRUE', 'FALSE', 'complete', 1, '50.000'
  ),
  (
    '54000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000102', 1,
    'identity-event', '2026-08-24T10:00:00Z', 'bike', 1000,
    'identity-core', 4, true, false, 'TRUE', 'FALSE', 'complete', 1, '50.000'
  ),
  (
    '54000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000103', 1,
    'identity-event', '2026-08-24T10:00:00Z', 'bike', 1000,
    'identity-core', 4, true, false, 'TRUE', 'FALSE', 'complete', 1, '50.000'
  );

SELECT * FROM dna.accept_staged_race_dataset(
  '54000000-0000-4000-8000-000000000101',
  '54000000-0000-4000-8000-000000000201',
  '2026-08-24T11:01:00Z', '2026-08-24T11:02:00Z',
  '2026-08-24T10:00:00Z'
);

DO $first_binding$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    WHERE entry.owner_id = '54000000-0000-4000-8000-000000000001'
      AND entry.source_core_id = 'identity-core'
      AND entry.source_import_batch_id =
        '54000000-0000-4000-8000-000000000101'
      AND encode(entry.source_fingerprint_sha256, 'hex') = repeat('a', 64)
      AND entry.active_in_dataset
  ) THEN
    RAISE EXCEPTION 'first Race Merge identity was not bound compactly';
  END IF;
END
$first_binding$;

SELECT * FROM dna.accept_staged_race_dataset(
  '54000000-0000-4000-8000-000000000102',
  '54000000-0000-4000-8000-000000000202',
  '2026-08-24T12:01:00Z', '2026-08-24T12:02:00Z',
  '2026-08-24T10:00:00Z'
);

DO $duplicate_binding$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    WHERE entry.owner_id = '54000000-0000-4000-8000-000000000001'
      AND entry.source_core_id = 'identity-core'
      AND entry.source_import_batch_id =
        '54000000-0000-4000-8000-000000000101'
      AND encode(entry.source_fingerprint_sha256, 'hex') = repeat('a', 64)
  ) THEN
    RAISE EXCEPTION 'duplicate Race Merge import changed first active identity';
  END IF;
END
$duplicate_binding$;

SELECT * FROM dna.rollback_active_dataset(
  'race_merge', 'synthetic duplicate rollback', '2026-08-24T12:10:00Z'
);
SELECT * FROM dna.rollback_active_dataset(
  'race_merge', 'synthetic first lineage rollback', '2026-08-24T12:11:00Z'
);

SELECT * FROM dna.accept_staged_race_dataset(
  '54000000-0000-4000-8000-000000000103',
  '54000000-0000-4000-8000-000000000203',
  '2026-08-24T13:01:00Z', '2026-08-24T13:02:00Z',
  '2026-08-24T10:00:00Z'
);

DO $rebound_identity$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    WHERE entry.owner_id = '54000000-0000-4000-8000-000000000001'
      AND entry.source_core_id = 'identity-core'
      AND entry.source_import_batch_id =
        '54000000-0000-4000-8000-000000000103'
      AND encode(entry.source_fingerprint_sha256, 'hex') = repeat('a', 64)
      AND entry.active_in_dataset
  ) THEN
    RAISE EXCEPTION 'rolled-back Race Merge identity was not safely rebound';
  END IF;
END
$rebound_identity$;

ROLLBACK;

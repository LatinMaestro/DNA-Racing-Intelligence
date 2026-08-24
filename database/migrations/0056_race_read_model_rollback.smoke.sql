BEGIN;

SET LOCAL app.owner_id = '56000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '56000000-0000-4000-8000-000000000001',
  'synthetic_read_model_rollback_owner'
);

INSERT INTO dna.dataset_stream (owner_id, source_type)
VALUES (
  '56000000-0000-4000-8000-000000000001',
  'race_merge'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES
  (
    '56000000-0000-4000-8000-000000000101',
    '56000000-0000-4000-8000-000000000001',
    'race_merge', 'rollback-v1.csv', repeat('1', 64),
    'utf_8', 'race-merge/v1', 'accepted',
    '2026-08-24T15:00:00Z', '2026-08-24T15:01:00Z',
    '2026-08-24T14:00:00Z', '2026-08-24T14:00:00Z',
    '2026-08-24T14:00:00Z', 1, 1, 0, 0
  ),
  (
    '56000000-0000-4000-8000-000000000102',
    '56000000-0000-4000-8000-000000000001',
    'race_merge', 'rollback-v2.csv', repeat('2', 64),
    'utf_8', 'race-merge/v1', 'accepted',
    '2026-08-24T16:00:00Z', '2026-08-24T16:01:00Z',
    '2026-08-24T14:00:00Z', '2026-08-24T15:00:00Z',
    '2026-08-24T15:00:00Z', 2, 2, 0, 0
  );

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, is_active
) VALUES
  (
    '56000000-0000-4000-8000-000000000201',
    '56000000-0000-4000-8000-000000000001',
    'race_merge', 1,
    '56000000-0000-4000-8000-000000000101',
    '2026-08-24T15:02:00Z', '2026-08-24T14:00:00Z', false
  ),
  (
    '56000000-0000-4000-8000-000000000202',
    '56000000-0000-4000-8000-000000000001',
    'race_merge', 2,
    '56000000-0000-4000-8000-000000000102',
    '2026-08-24T16:02:00Z', '2026-08-24T15:00:00Z', true
  );

INSERT INTO dna.race_event (
  id, owner_id, source_event_id, event_at, mode, distance, gate_count,
  source_import_batch_id, active_in_dataset
) VALUES
  (
    '56000000-0000-4000-8000-000000000301',
    '56000000-0000-4000-8000-000000000001',
    'read-model-event-v1', '2026-08-24T14:00:00Z',
    'bike', 1000, 4,
    '56000000-0000-4000-8000-000000000101', true
  ),
  (
    '56000000-0000-4000-8000-000000000302',
    '56000000-0000-4000-8000-000000000001',
    'read-model-event-v2', '2026-08-24T15:00:00Z',
    'bike', 1000, 4,
    '56000000-0000-4000-8000-000000000102', true
  );

INSERT INTO dna.race_entry (
  id, owner_id, race_event_id, source_core_id, gate_count,
  gold_star, blue_star, star_data_status, finish_position,
  economic_data_status, source_import_batch_id, active_in_dataset,
  source_fingerprint_sha256
) VALUES
  (
    '56000000-0000-4000-8000-000000000401',
    '56000000-0000-4000-8000-000000000001',
    '56000000-0000-4000-8000-000000000301',
    'read-model-core-a', 4, true, false, 'complete', 1,
    'unvalidated', '56000000-0000-4000-8000-000000000101', true,
    decode(repeat('a', 64), 'hex')
  ),
  (
    '56000000-0000-4000-8000-000000000402',
    '56000000-0000-4000-8000-000000000001',
    '56000000-0000-4000-8000-000000000302',
    'read-model-core-b', 4, false, true, 'complete', 1,
    'unvalidated', '56000000-0000-4000-8000-000000000102', true,
    decode(repeat('b', 64), 'hex')
  );

INSERT INTO dna.race_entry_source (
  id, owner_id, race_entry_id, import_batch_id, source_row_number,
  source_row_checksum, is_selected_fact
) VALUES
  (
    '56000000-0000-4000-8000-000000000501',
    '56000000-0000-4000-8000-000000000001',
    '56000000-0000-4000-8000-000000000401',
    '56000000-0000-4000-8000-000000000101', 1,
    repeat('a', 64), true
  ),
  (
    '56000000-0000-4000-8000-000000000502',
    '56000000-0000-4000-8000-000000000001',
    '56000000-0000-4000-8000-000000000401',
    '56000000-0000-4000-8000-000000000102', 1,
    repeat('a', 64), true
  ),
  (
    '56000000-0000-4000-8000-000000000503',
    '56000000-0000-4000-8000-000000000001',
    '56000000-0000-4000-8000-000000000402',
    '56000000-0000-4000-8000-000000000102', 2,
    repeat('b', 64), true
  );

DELETE FROM dna.race_entry_source
WHERE owner_id = '56000000-0000-4000-8000-000000000001';

DO $rollback_latest_without_sources$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.rollback_active_dataset(
    'race_merge',
    'synthetic compacted-source rollback',
    '2026-08-24T17:00:00Z'
  );

  IF v_result.rolled_back_version_number <> 2
     OR v_result.restored_version_number <> 1 THEN
    RAISE EXCEPTION 'latest Race Merge rollback returned wrong versions';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    WHERE entry.id = '56000000-0000-4000-8000-000000000401'
      AND entry.active_in_dataset
  ) OR EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    WHERE entry.id = '56000000-0000-4000-8000-000000000402'
      AND entry.active_in_dataset
  ) THEN
    RAISE EXCEPTION 'Race Merge read-model activity was not restored safely';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_event event
    WHERE event.id = '56000000-0000-4000-8000-000000000301'
      AND event.active_in_dataset
  ) OR EXISTS (
    SELECT 1
    FROM dna.race_event event
    WHERE event.id = '56000000-0000-4000-8000-000000000302'
      AND event.active_in_dataset
  ) THEN
    RAISE EXCEPTION 'Race Merge event activity was not restored safely';
  END IF;
END
$rollback_latest_without_sources$;

DO $rollback_first_without_sources$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.rollback_active_dataset(
    'race_merge',
    'synthetic final compacted-source rollback',
    '2026-08-24T17:01:00Z'
  );

  IF v_result.rolled_back_version_number <> 1
     OR v_result.restored_version_number IS NOT NULL THEN
    RAISE EXCEPTION 'first Race Merge rollback returned wrong versions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    WHERE entry.owner_id = '56000000-0000-4000-8000-000000000001'
      AND entry.active_in_dataset
  ) OR EXISTS (
    SELECT 1
    FROM dna.race_event event
    WHERE event.owner_id = '56000000-0000-4000-8000-000000000001'
      AND event.active_in_dataset
  ) THEN
    RAISE EXCEPTION 'final Race Merge rollback left active read-model rows';
  END IF;
END
$rollback_first_without_sources$;

ROLLBACK;

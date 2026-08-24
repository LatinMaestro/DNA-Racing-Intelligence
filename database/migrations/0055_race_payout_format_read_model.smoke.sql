BEGIN;

SET LOCAL app.owner_id = '55000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '55000000-0000-4000-8000-000000000001',
  'synthetic_payout_read_model_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  '55000000-0000-4000-8000-000000000101',
  '55000000-0000-4000-8000-000000000001',
  'race_merge', 'payout-read-model.csv', repeat('1', 64),
  'utf_8', 'race-merge/v1', 'accepted',
  '2026-08-24T14:00:00Z', '2026-08-24T14:01:00Z',
  '2026-08-24T13:00:00Z', '2026-08-24T13:00:00Z',
  '2026-08-24T13:00:00Z', 1, 1, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, is_active
) VALUES (
  '55000000-0000-4000-8000-000000000201',
  '55000000-0000-4000-8000-000000000001',
  'race_merge', 1,
  '55000000-0000-4000-8000-000000000101',
  '2026-08-24T14:02:00Z', '2026-08-24T13:00:00Z', true
);

INSERT INTO dna.race_event (
  id, owner_id, source_event_id, event_at, mode, distance, gate_count,
  source_import_batch_id, active_in_dataset
) VALUES (
  '55000000-0000-4000-8000-000000000301',
  '55000000-0000-4000-8000-000000000001',
  'synthetic-payout-event', '2026-08-24T13:00:00Z',
  'bike', 1000, 4,
  '55000000-0000-4000-8000-000000000101', true
);

INSERT INTO dna.race_entry (
  id, owner_id, race_event_id, source_core_id, gate_count,
  gold_star, blue_star, star_data_status, elapsed_time_milliseconds,
  speed_microunits, finish_position, economic_data_status,
  source_import_batch_id, active_in_dataset,
  source_fingerprint_sha256
) VALUES (
  '55000000-0000-4000-8000-000000000401',
  '55000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000301',
  'synthetic-payout-core', 4, true, false, 'complete',
  50000, 20000000, 1, 'validated',
  '55000000-0000-4000-8000-000000000101', true,
  decode(repeat('a', 64), 'hex')
);

INSERT INTO dna.race_entry_source (
  id, owner_id, race_entry_id, import_batch_id, source_row_number,
  source_row_checksum, raw_payout, is_selected_fact
) VALUES (
  '55000000-0000-4000-8000-000000000501',
  '55000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000401',
  '55000000-0000-4000-8000-000000000101', 1,
  repeat('a', 64), '  Winner   Takes All  ', true
);

DO $first_refresh$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.refresh_core_payout_format_profiles('2026-08-24T14:03:00Z');

  IF v_result.accepted_format_entry_count <> 1
     OR v_result.payout_format_profile_count <> 1 THEN
    RAISE EXCEPTION 'payout read-model first refresh counts are incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    WHERE entry.owner_id = '55000000-0000-4000-8000-000000000001'
      AND entry.id = '55000000-0000-4000-8000-000000000401'
      AND entry.payout_format_label = 'Winner Takes All'
  ) THEN
    RAISE EXCEPTION 'payout format was not persisted on the race read model';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.core_payout_format_profile profile
    WHERE profile.owner_id = '55000000-0000-4000-8000-000000000001'
      AND profile.source_core_id = 'synthetic-payout-core'
      AND profile.mode = 'bike'
      AND profile.payout_format_key = 'winner takes all'
      AND profile.payout_format_label = 'Winner Takes All'
      AND profile.race_count = 1
      AND profile.win_count = 1
      AND profile.top_three_count = 1
      AND profile.exact_distance_count = 1
      AND profile.timed_race_count = 1
  ) THEN
    RAISE EXCEPTION 'payout format profile was not materialized correctly';
  END IF;
END
$first_refresh$;

DELETE FROM dna.race_entry_source
WHERE owner_id = '55000000-0000-4000-8000-000000000001'
  AND import_batch_id = '55000000-0000-4000-8000-000000000101';

DO $refresh_after_source_compaction$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.refresh_core_payout_format_profiles('2026-08-24T14:04:00Z');

  IF v_result.accepted_format_entry_count <> 1
     OR v_result.payout_format_profile_count <> 1 THEN
    RAISE EXCEPTION 'source compaction changed payout refresh counts';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.core_payout_format_profile profile
    WHERE profile.owner_id = '55000000-0000-4000-8000-000000000001'
      AND profile.source_core_id = 'synthetic-payout-core'
      AND profile.payout_format_key = 'winner takes all'
      AND profile.payout_format_label = 'Winner Takes All'
      AND profile.race_count = 1
      AND profile.refreshed_at = '2026-08-24T14:04:00Z'
  ) THEN
    RAISE EXCEPTION 'payout intelligence did not survive source compaction';
  END IF;
END
$refresh_after_source_compaction$;

ROLLBACK;

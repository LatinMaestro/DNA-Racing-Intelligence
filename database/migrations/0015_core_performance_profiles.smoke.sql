BEGIN;

SET LOCAL app.owner_id = '15000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('15000000-0000-4000-8000-000000000001', 'synthetic_performance_owner'),
  ('15000000-0000-4000-8000-000000000002', 'synthetic_performance_other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at, maximum_accepted_event_at,
  dataset_current_through_after_import, source_rows, accepted_rows,
  rejected_rows, warning_rows
)
VALUES (
  '15000000-0000-4000-8000-000000000101',
  '15000000-0000-4000-8000-000000000001',
  'race_merge',
  'synthetic-performance.csv',
  repeat('1', 64),
  'utf_8',
  'race-merge/v1',
  'accepted',
  '2026-08-11T00:00:00Z',
  '2026-08-11T00:05:00Z',
  '2026-08-11T00:01:00Z',
  '2026-08-11T00:02:00Z',
  '2026-08-11T00:02:00Z',
  2, 2, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, is_active
)
VALUES (
  '15000000-0000-4000-8000-000000000201',
  '15000000-0000-4000-8000-000000000001',
  'race_merge',
  1,
  '15000000-0000-4000-8000-000000000101',
  '2026-08-11T00:06:00Z',
  '2026-08-11T00:02:00Z',
  true
);

INSERT INTO dna.race_event (
  id, owner_id, source_event_id, event_at, mode, distance, gate_count,
  source_import_batch_id, active_in_dataset
)
VALUES
  ('15000000-0000-4000-8000-000000000301', '15000000-0000-4000-8000-000000000001', 'event-one', '2026-08-11T00:01:00Z', 'bike', 1050, 4, '15000000-0000-4000-8000-000000000101', true),
  ('15000000-0000-4000-8000-000000000302', '15000000-0000-4000-8000-000000000001', 'event-two', '2026-08-11T00:02:00Z', 'bike', 1050, 4, '15000000-0000-4000-8000-000000000101', true);

INSERT INTO dna.race_entry (
  id, owner_id, race_event_id, source_core_id, gate_count,
  gold_star, blue_star, star_data_status, finish_position,
  source_import_batch_id, active_in_dataset
)
VALUES
  ('15000000-0000-4000-8000-000000000401', '15000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000301', 'core-seconds', 4, true, false, 'complete', 1, '15000000-0000-4000-8000-000000000101', true),
  ('15000000-0000-4000-8000-000000000402', '15000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000302', 'core-seconds', 4, false, true, 'complete', 2, '15000000-0000-4000-8000-000000000101', true);

INSERT INTO dna.race_entry_source (
  id, owner_id, race_entry_id, import_batch_id, source_row_number,
  source_row_checksum, raw_gold_star, raw_blue_star, raw_elapsed_time,
  is_selected_fact
)
VALUES
  ('15000000-0000-4000-8000-000000000501', '15000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000401', '15000000-0000-4000-8000-000000000101', 1, repeat('2', 64), 'true', 'false', '52.500', true),
  ('15000000-0000-4000-8000-000000000502', '15000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000402', '15000000-0000-4000-8000-000000000101', 2, repeat('3', 64), 'false', 'true', '50.000', true);

INSERT INTO dna.core (id, owner_id, source_core_id, display_name, source_import_batch_id)
VALUES (
  '15000000-0000-4000-8000-000000000601',
  '15000000-0000-4000-8000-000000000001',
  'core-seconds',
  'Seconds',
  '15000000-0000-4000-8000-000000000101'
);

INSERT INTO dna.owner_vault_core (
  id, owner_id, core_id, in_my_vault, me_eligible, version, created_at, updated_at
)
VALUES (
  '15000000-0000-4000-8000-000000000701',
  '15000000-0000-4000-8000-000000000001',
  '15000000-0000-4000-8000-000000000601',
  true,
  false,
  1,
  '2026-08-11T00:07:00Z',
  '2026-08-11T00:07:00Z'
);

SELECT * FROM dna.refresh_core_performance_profiles('2026-08-11T00:10:00Z');

DO $performance_assertions$
BEGIN
  IF dna.elapsed_seconds_to_milliseconds('52.500') <> 52500 THEN
    RAISE EXCEPTION 'seconds were not converted to milliseconds exactly';
  END IF;

  BEGIN
    PERFORM dna.elapsed_seconds_to_milliseconds('52.5001');
    RAISE EXCEPTION 'sub-millisecond source precision was silently rounded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'sub-millisecond source precision was silently rounded' THEN
      RAISE;
    END IF;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_entry
    WHERE
      id = '15000000-0000-4000-8000-000000000401'
      AND elapsed_time_milliseconds = 52500
      AND speed_microunits = 20000000
  ) THEN
    RAISE EXCEPTION 'normalized race time or metres-per-second speed is wrong';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.core_performance_profile
    WHERE
      source_core_id = 'core-seconds'
      AND mode = 'bike'
      AND distance = 1050
      AND race_count = 2
      AND best_milliseconds = 50000
      AND median_milliseconds = 51250
      AND mean_milliseconds = 51250
      AND trimmed_mean_milliseconds = 51250
      AND round(best_metres_per_second, 3) = 21.000
      AND round(median_metres_per_second, 3) = 20.488
  ) THEN
    RAISE EXCEPTION 'compact Core Intelligence profile is wrong';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.list_core_performance_profiles(
      '15000000-0000-4000-8000-000000000001',
      NULL,
      5000
    )
  ) <> 1 THEN
    RAISE EXCEPTION 'owner Vault performance read did not return one profile';
  END IF;
END
$performance_assertions$;

CREATE ROLE dna_ci_performance NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_performance;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_performance;
GRANT EXECUTE ON FUNCTION dna.list_core_performance_profiles(
  uuid,
  text,
  integer
) TO dna_ci_performance;

SET LOCAL ROLE dna_ci_performance;
SET LOCAL app.owner_id = '15000000-0000-4000-8000-000000000002';

DO $isolation_assertions$
BEGIN
  BEGIN
    PERFORM *
    FROM dna.list_core_performance_profiles(
      '15000000-0000-4000-8000-000000000001',
      'core-seconds',
      10
    );
    RAISE EXCEPTION 'cross-owner Core Intelligence read was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Core Intelligence read was allowed' THEN
      RAISE;
    END IF;
  END;
END
$isolation_assertions$;

RESET ROLE;
ROLLBACK;

BEGIN;

SET LOCAL app.owner_id = '20000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'synthetic_benchmark_owner'),
  ('20000000-0000-4000-8000-000000000002', 'synthetic_benchmark_other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at, maximum_accepted_event_at,
  dataset_current_through_after_import, source_rows, accepted_rows,
  rejected_rows, warning_rows
)
VALUES (
  '20000000-0000-4000-8000-000000000101',
  '20000000-0000-4000-8000-000000000001',
  'race_merge',
  'synthetic-benchmark.csv',
  repeat('a', 64),
  'utf_8',
  'race-merge/v1',
  'accepted',
  '2026-08-11T00:00:00Z',
  '2026-08-11T00:10:00Z',
  '2026-08-11T00:01:00Z',
  '2026-08-11T00:02:00Z',
  '2026-08-11T00:02:00Z',
  8, 8, 0, 0
);

INSERT INTO dna.race_event (
  id, owner_id, source_event_id, event_at, mode, distance, gate_count,
  source_import_batch_id, active_in_dataset
)
VALUES
  ('20000000-0000-4000-8000-000000000201', '20000000-0000-4000-8000-000000000001', 'benchmark-event-one', '2026-08-11T00:01:00Z', 'bike', 1400, 4, '20000000-0000-4000-8000-000000000101', true),
  ('20000000-0000-4000-8000-000000000202', '20000000-0000-4000-8000-000000000001', 'benchmark-event-two', '2026-08-11T00:02:00Z', 'bike', 1400, 4, '20000000-0000-4000-8000-000000000101', true);

INSERT INTO dna.race_entry (
  id, owner_id, race_event_id, source_core_id, gate_count,
  star_data_status, elapsed_time_milliseconds, finish_position,
  source_import_batch_id, active_in_dataset
)
VALUES
  ('20000000-0000-4000-8000-000000000301', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000201', 'core-a', 4, 'missing', 50000, 1, '20000000-0000-4000-8000-000000000101', true),
  ('20000000-0000-4000-8000-000000000302', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000201', 'core-b', 4, 'missing', 51000, 2, '20000000-0000-4000-8000-000000000101', true),
  ('20000000-0000-4000-8000-000000000303', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000201', 'core-c', 4, 'missing', 52000, 3, '20000000-0000-4000-8000-000000000101', true),
  ('20000000-0000-4000-8000-000000000304', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000201', 'core-d', 4, 'missing', 54000, 4, '20000000-0000-4000-8000-000000000101', true),
  ('20000000-0000-4000-8000-000000000305', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000202', 'core-e', 4, 'missing', 52000, 1, '20000000-0000-4000-8000-000000000101', true),
  ('20000000-0000-4000-8000-000000000306', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000202', 'core-f', 4, 'missing', 53000, 2, '20000000-0000-4000-8000-000000000101', true),
  ('20000000-0000-4000-8000-000000000307', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000202', 'core-g', 4, 'missing', 54000, 3, '20000000-0000-4000-8000-000000000101', true),
  ('20000000-0000-4000-8000-000000000308', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000202', 'core-h', 4, 'missing', 56000, 4, '20000000-0000-4000-8000-000000000101', true);

DO $benchmark_assertions$
DECLARE
  refreshed bigint;
BEGIN
  refreshed := dna.refresh_discovery_exact_distance_benchmarks('2026-08-11T00:20:00Z');
  IF refreshed <> 1 THEN
    RAISE EXCEPTION 'expected one exact-distance benchmark';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.discovery_exact_distance_benchmark benchmark
    WHERE
      benchmark.mode = 'bike'
      AND benchmark.distance = 1400
      AND benchmark.race_entry_count = 8
      AND benchmark.winning_entry_count = 2
      AND benchmark.top_three_entry_count = 6
      AND benchmark.winning_p25_milliseconds = 50500
      AND benchmark.winning_median_milliseconds = 51000
      AND benchmark.winning_p75_milliseconds = 51500
      AND benchmark.top_three_p25_milliseconds = 51250
      AND benchmark.top_three_median_milliseconds = 52000
      AND benchmark.top_three_p75_milliseconds = 52750
      AND benchmark.data_current_through = '2026-08-11T00:02:00Z'
  ) THEN
    RAISE EXCEPTION 'Discovery exact-distance benchmark values are wrong';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.list_discovery_exact_distance_benchmarks(
      '20000000-0000-4000-8000-000000000001',
      100
    )
  ) <> 1 THEN
    RAISE EXCEPTION 'Discovery benchmark read did not return one row';
  END IF;
END
$benchmark_assertions$;

CREATE ROLE dna_ci_benchmark NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_benchmark;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_benchmark;
GRANT EXECUTE ON FUNCTION dna.list_discovery_exact_distance_benchmarks(uuid, integer)
  TO dna_ci_benchmark;

SET LOCAL ROLE dna_ci_benchmark;
SET LOCAL app.owner_id = '20000000-0000-4000-8000-000000000002';

DO $isolation_assertions$
BEGIN
  BEGIN
    PERFORM *
    FROM dna.list_discovery_exact_distance_benchmarks(
      '20000000-0000-4000-8000-000000000001',
      100
    );
    RAISE EXCEPTION 'cross-owner Discovery benchmark read was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Discovery benchmark read was allowed' THEN
      RAISE;
    END IF;
  END;
END
$isolation_assertions$;

RESET ROLE;
ROLLBACK;

BEGIN;

-- Aggregate-publication schema is exercised by a separate migration workflow.
-- Recreate only the receipt columns consumed here when that workflow has not
-- run in this isolated CI database; this is a no-op on a fully migrated schema.
CREATE TABLE IF NOT EXISTS dna.race_archive_aggregate_publication_receipt (
  owner_id uuid NOT NULL,
  refresh_id uuid NOT NULL,
  target_dataset_version_id uuid NOT NULL,
  race_dataset_version_id uuid NOT NULL,
  source_version_set_sha256 character(64) NOT NULL,
  payload_sha256 character(64) NOT NULL,
  core_performance_profile_count bigint NOT NULL,
  validated_event_count bigint NOT NULL,
  core_star_profile_count bigint NOT NULL,
  discovery_benchmark_count bigint NOT NULL,
  accepted_format_entry_count bigint NOT NULL,
  payout_format_profile_count bigint NOT NULL,
  materialized_row_count bigint NOT NULL,
  refreshed_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, refresh_id)
);

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('a1460000-0000-4000-8000-000000000001', 'smoke_core_publication_owner'),
  ('a1460000-0000-4000-8000-000000000002', 'smoke_core_publication_other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  schema_version, status, uploaded_at, import_completed_at,
  minimum_accepted_event_at, maximum_accepted_event_at,
  dataset_current_through_after_import, source_rows, accepted_rows,
  rejected_rows, warning_rows
) VALUES (
  'a1460000-0000-4000-8000-000000000010',
  'a1460000-0000-4000-8000-000000000001',
  'race_merge', 'core-publication-smoke.csv', repeat('a', 64), 'smoke-v1',
  'accepted', '2026-10-20T00:00:00Z', '2026-10-20T00:01:00Z',
  '2026-10-19T00:00:00Z', '2026-10-19T00:00:00Z',
  '2026-10-19T00:00:00Z', 1, 1, 0, 0
);

INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, aggregate_refreshed_at, is_active
) VALUES (
  'a1460000-0000-4000-8000-000000000020',
  'a1460000-0000-4000-8000-000000000001',
  'race_merge', 1, 'a1460000-0000-4000-8000-000000000010',
  '2026-10-20T00:01:00Z', '2026-10-19T00:00:00Z',
  '2026-10-20T00:02:00Z', true
);

INSERT INTO dna.aggregate_refresh_job (
  id, owner_id, dataset_version_id, status, started_at, completed_at,
  affected_record_count
) VALUES (
  'a1460000-0000-4000-8000-000000000030',
  'a1460000-0000-4000-8000-000000000001',
  'a1460000-0000-4000-8000-000000000020',
  'completed', '2026-10-20T00:01:30Z', '2026-10-20T00:03:00Z', 1
);

INSERT INTO dna.core_performance_profile (
  owner_id, source_core_id, mode, distance, data_current_through, race_count,
  best_milliseconds, median_milliseconds, mean_milliseconds,
  trimmed_mean_milliseconds, standard_deviation_milliseconds,
  interquartile_range_milliseconds, best_metres_per_second,
  median_metres_per_second, refreshed_at
) VALUES (
  'a1460000-0000-4000-8000-000000000001', 'core-smoke', 'bike', 1000,
  '2026-10-19T00:00:00Z', 1, 50000, 50000, 50000, 50000, 0, 0, 20, 20,
  '2026-10-20T00:02:00Z'
);

INSERT INTO dna.race_archive_aggregate_publication_receipt (
  owner_id, refresh_id, target_dataset_version_id,
  race_dataset_version_id, source_version_set_sha256, payload_sha256,
  core_performance_profile_count, validated_event_count,
  core_star_profile_count, discovery_benchmark_count,
  accepted_format_entry_count, payout_format_profile_count,
  materialized_row_count, refreshed_at, published_at
) VALUES (
  'a1460000-0000-4000-8000-000000000001',
  'a1460000-0000-4000-8000-000000000030',
  'a1460000-0000-4000-8000-000000000020',
  'a1460000-0000-4000-8000-000000000020',
  repeat('b', 64), repeat('c', 64), 1, 0, 0, 0, 0, 0, 1,
  '2026-10-20T00:02:00Z', '2026-10-20T00:03:00Z'
);

DO $permissions$
BEGIN
  IF has_table_privilege('dna_app_runtime',
      'dna.race_archive_aggregate_publication_receipt', 'SELECT')
    OR has_table_privilege('dna_app_runtime',
      'dna.core_performance_profile', 'SELECT')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_core_performance_publication(uuid)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Core performance publication read privileges are unsafe';
  END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1460000-0000-4000-8000-000000000001';

DO $read$
DECLARE
  v_owner constant uuid := 'a1460000-0000-4000-8000-000000000001';
BEGIN
  IF (SELECT count(*) FROM dna.read_core_performance_publication(v_owner)
      WHERE refresh_id = 'a1460000-0000-4000-8000-000000000030'
        AND race_dataset_version_id = 'a1460000-0000-4000-8000-000000000020'
        AND source_version_set_sha256 = repeat('b', 64)
        AND payload_sha256 = repeat('c', 64)
        AND core_performance_profile_count = 1
        AND refreshed_at = '2026-10-20T00:02:00Z'
        AND published_at = '2026-10-20T00:03:00Z') <> 1 THEN
    RAISE EXCEPTION 'Core performance publication identity is invalid';
  END IF;

  BEGIN
    PERFORM dna.read_core_performance_publication(
      'a1460000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'Cross-owner Core performance publication read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-owner Core performance publication read accepted' THEN RAISE; END IF;
  END;
END
$read$;

RESET ROLE;
ROLLBACK;
